import { prisma } from "@repo/db";
import { istDay } from "@repo/scoring";
import { enqueueJobs } from "@repo/scoring/server";
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
      if (error instanceof RateLimitError) {
        await postponeJob(job, error.resetAt, error.message);
      } else if (error instanceof NotConfiguredError) {
        // Keep the job until the app is configured instead of burning its attempts.
        await postponeJob(job, new Date(Date.now() + HOUR_MS), error.message);
      } else {
        console.error(`Job ${job.kind} ${job.dedupeKey} failed (attempt ${job.attempts})`, error);
        await failJob(job, error);
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
  // Housekeeping: finished jobs and raw deliveries aren't needed for long.
  await prisma.syncJob.deleteMany({
    where: { status: "DONE", finishedAt: { lt: new Date(now.getTime() - 14 * 24 * HOUR_MS) } },
  });
  await prisma.webhookDelivery.deleteMany({
    where: { receivedAt: { lt: new Date(now.getTime() - 30 * 24 * HOUR_MS) } },
  });
  console.log(`Nightly reconciliation queued for ${repos.length} repos`);
}

function istHour(date: Date) {
  return new Date(date.getTime() + 330 * 60_000).getUTCHours();
}

export function startWorker() {
  let stopping = false;
  let lastNightly: string | null = null;

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
      const today = istDay(now);
      if (lastNightly !== today && istHour(now) >= NIGHTLY_IST_HOUR && githubAppConfigured()) {
        lastNightly = today;
        await nightly(now);
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
