import { randomUUID } from "node:crypto";
import { prisma } from "@repo/db";
import { autoFreezeDue, istDay } from "@repo/scoring";
import {
  enqueueJobs,
  freezeLeaderboard,
  liveBoardsOf,
  rebuildLiveBoard,
  verifyBoard,
} from "@repo/scoring/server";
import { env, githubAppConfigured } from "./env";
import { NotConfiguredError, RateLimitError } from "./github/client";
import { awardBadgesForSeason, syncBadgeDefinitions } from "./scoring/badges";
import { scorePullRequest } from "./scoring/score-pr";
import { claimJob, completeJob, failJob, postponeJob, releaseStaleJobs } from "./sync/queue";
import { needsGitHub, runJob } from "./sync/run-job";

// The GitHub sync worker (F-06): drains the SyncJob queue and runs the periodic tasks.

const IDLE_MS = 1_000;
const TICK_MS = 60_000;
/** Nightly reconciliation runs at the first tick after this IST hour. */
const NIGHTLY_IST_HOUR = 3;
const HOUR_MS = 3_600_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function workLoop(shouldStop: () => boolean) {
  while (!shouldStop()) {
    let job;
    try {
      job = await claimJob();
    } catch (error) {
      console.error("Couldn't claim a job", error);
      await sleep(5_000);
      continue;
    }
    if (!job) {
      await sleep(IDLE_MS);
      continue;
    }
    try {
      if (needsGitHub(job) && !githubAppConfigured()) throw new NotConfiguredError();
      await runJob(job);
      await completeJob(job.id);
    } catch (error) {
      try {
        if (error instanceof RateLimitError) {
          await postponeJob(job, error.resetAt, error.message);
        } else if (error instanceof NotConfiguredError) {
          // Keep the job until the app is configured instead of burning its attempts.
          await postponeJob(job, new Date(Date.now() + HOUR_MS), error.message);
        } else {
          console.error(`Job ${job.kind} ${job.dedupeKey} failed (attempt ${job.attempts})`, error);
          await failJob(job, error);
        }
      } catch (bookkeeping) {
        // A throw here would end this loop, and with it (unhandled rejection) the whole process.
        // The job stays RUNNING and releaseStaleJobs() queues it again.
        console.error(`Couldn't record the outcome of job ${job.kind} ${job.dedupeKey}`, bookkeeping);
        await sleep(5_000);
      }
    }
  }
}

/** PRs whose label grace window ended get their final outcome (scored or NO_LEVEL_LABEL). */
async function finishExpiredGraceWindows(now: Date) {
  const due = await prisma.pullRequest.findMany({
    where: { scoreStatus: "AWAITING_LABEL", labelDeadline: { lte: now } },
    select: { id: true },
    take: 500,
  });
  for (const pr of due) await scorePullRequest(pr.id, now);
}

/**
 * Points held back by the daily cap count from a later 00:00 IST, with no new ledger entry then.
 * Once that moment passes, refresh those contributors' leaderboard entries.
 */
async function refreshDeferredPoints(since: Date, now: Date) {
  const due = await prisma.$queryRaw<{ seasonId: string; userId: string }[]>`
    SELECT DISTINCT "seasonId", "userId" FROM "ScoreEvent"
    WHERE "seasonId" IN (SELECT id FROM "Season" WHERE "isActive")
      AND "effectiveAt" > ${since} AND "effectiveAt" <= ${now} AND "createdAt" < "effectiveAt"
  `;
  await enqueueJobs(
    due.map((row) => ({
      kind: "LEADERBOARD_REFRESH" as const,
      payload: { seasonId: row.seasonId, kind: "user" as const, id: row.userId },
    })),
  );
}

/** The public board freezes by itself 48 hours before coding ends (PRD §4.8). */
async function autoFreeze(now: Date) {
  const season = await prisma.season.findFirst({ where: { isActive: true } });
  if (!season || !autoFreezeDue(season, now)) return;
  await freezeLeaderboard(season.id, null, now);
  console.log(`Leaderboard for ${season.slug} frozen automatically`);
}

/** Compares every live board in Redis with a fresh SQL computation; rebuilds any that differ. */
async function verifyLeaderboards(now: Date) {
  const season = await prisma.season.findFirst({ where: { isActive: true } });
  if (!season) return;
  for (const board of await liveBoardsOf(season.id, now)) {
    const result = await verifyBoard(season.id, board, now);
    if (result.ok) continue;
    console.warn(`Leaderboard ${result.board} differed from SQL; rebuilding`, result.differences);
    await rebuildLiveBoard(season.id, board);
  }
}

/**
 * Claims today's nightly run for this process: true for the first caller of an IST day, false for
 * any other (another worker, or this one after a restart). The claim is a row in `Verification`,
 * which is a general key/value table with an expiry; the advisory lock makes check-and-insert
 * atomic across processes.
 */
async function claimNightly(now: Date) {
  const identifier = `mergio:nightly:${istDay(now)}`;
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('mergio:nightly'))`;
    if (await tx.verification.findFirst({ where: { identifier }, select: { id: true } })) return false;
    await tx.verification.create({
      data: { id: randomUUID(), identifier, value: "claimed", expiresAt: new Date(now.getTime() + 36 * HOUR_MS) },
    });
    return true;
  });
}

async function nightly(now: Date) {
  const repos = await prisma.projectRepo.findMany({
    where: {
      project: { season: { isActive: true }, status: "APPROVED" },
      approval: "APPROVED",
      removedAt: null,
      trackingStatus: "ACTIVE",
    },
    select: { githubRepoId: true },
    distinct: ["githubRepoId"],
  });
  await enqueueJobs(
    repos.map((repo) => ({
      kind: "REPO_RESYNC" as const,
      payload: { githubRepoId: repo.githubRepoId.toString() },
    })),
  );
  // Mentors' GitHub roles change outside Mergio, so re-check them daily.
  const mentored = await prisma.project.findMany({
    where: { season: { isActive: true }, status: "APPROVED", mentors: { some: {} } },
    select: { id: true },
  });
  await enqueueJobs(
    mentored.map((project) => ({ kind: "MENTOR_ACCESS" as const, payload: { projectId: project.id } })),
  );
  const season = await prisma.season.findFirst({ where: { isActive: true } });
  if (season) await awardBadgesForSeason(season.id, now);
  await verifyLeaderboards(now).catch((error) => console.error("Leaderboard verification failed", error));
  // Housekeeping: finished jobs and raw deliveries aren't needed for long.
  await prisma.syncJob.deleteMany({
    where: { status: "DONE", finishedAt: { lt: new Date(now.getTime() - 14 * 24 * HOUR_MS) } },
  });
  await prisma.webhookDelivery.deleteMany({
    where: { receivedAt: { lt: new Date(now.getTime() - 30 * 24 * HOUR_MS) } },
  });
  await prisma.verification.deleteMany({
    where: { identifier: { startsWith: "mergio:nightly:" }, expiresAt: { lt: now } },
  });
  console.log(`Nightly reconciliation queued for ${repos.length} repos`);
}

function istHour(date: Date) {
  return new Date(date.getTime() + 330 * 60_000).getUTCHours();
}

export function startWorker() {
  let stopping = false;
  let lastNightly: string | null = null;
  // Look back a day on start, in case the worker was down at midnight.
  let deferredCheckedAt = new Date(Date.now() - 26 * HOUR_MS);

  if (!githubAppConfigured()) {
    console.warn(
      "GitHub App not configured (GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY): GitHub sync jobs wait until it is.",
    );
  }

  void syncBadgeDefinitions().catch((error) => console.error("Badge definition sync failed", error));

  const loops = Array.from({ length: env.workerConcurrency }, () => workLoop(() => stopping));

  const tick = async () => {
    const now = new Date();
    try {
      await releaseStaleJobs();
      await finishExpiredGraceWindows(now);
      await refreshDeferredPoints(deferredCheckedAt, now);
      deferredCheckedAt = now;
      await autoFreeze(now);
      const today = istDay(now);
      if (lastNightly !== today && istHour(now) >= NIGHTLY_IST_HOUR && githubAppConfigured()) {
        lastNightly = today;
        // Only one process runs it, once a day, however often workers restart.
        if (await claimNightly(now)) await nightly(now);
      }
    } catch (error) {
      console.error("Worker tick failed", error);
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), TICK_MS);

  console.log(`Sync worker started (${env.workerConcurrency} loops)`);
  return async function stop() {
    stopping = true;
    clearInterval(timer);
    await Promise.all(loops);
  };
}
