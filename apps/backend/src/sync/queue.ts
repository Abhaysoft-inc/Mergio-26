import { prisma, type SyncJob } from "@repo/db";

// Claiming and finishing SyncJob rows. Claims use FOR UPDATE SKIP LOCKED, so any number of
// workers can share the queue, and never take a job whose key is already running elsewhere
// (two refetches of one PR at once would race).

const MAX_ATTEMPTS = 8;
/** A RUNNING job older than this is assumed dead (crashed worker) and queued again. */
const STALE_AFTER_MS = 15 * 60_000;

export async function claimJob(): Promise<SyncJob | null> {
  const rows = await prisma.$queryRaw<SyncJob[]>`
    UPDATE "SyncJob" SET "status" = 'RUNNING', "lockedAt" = now(), "attempts" = "attempts" + 1
    WHERE "id" = (
      SELECT j."id" FROM "SyncJob" j
      WHERE j."status" = 'QUEUED' AND j."runAt" <= now()
        AND NOT EXISTS (
          SELECT 1 FROM "SyncJob" r WHERE r."dedupeKey" = j."dedupeKey" AND r."status" = 'RUNNING'
        )
      ORDER BY j."runAt"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *
  `;
  return rows[0] ?? null;
}

export async function completeJob(id: string) {
  await prisma.syncJob.update({
    where: { id },
    data: { status: "DONE", finishedAt: new Date(), lockedAt: null },
  });
}

/**
 * Puts a job back in the queue at `runAt`, or marks it done when a newer job for the same key is
 * already queued (that one refetches the same state). `countAttempt: false` is for rate limits.
 */
async function requeue(job: SyncJob, runAt: Date, error: string, countAttempt: boolean) {
  await prisma.$executeRaw`
    UPDATE "SyncJob" SET
      "status" = CASE WHEN EXISTS (
        SELECT 1 FROM "SyncJob" q WHERE q."dedupeKey" = ${job.dedupeKey} AND q."status" = 'QUEUED'
      ) THEN 'DONE'::"SyncJobStatus" ELSE 'QUEUED'::"SyncJobStatus" END,
      "runAt" = ${runAt},
      "lockedAt" = NULL,
      "lastError" = ${error},
      "attempts" = "attempts" - ${countAttempt ? 0 : 1}
    WHERE "id" = ${job.id}
  `;
}

/** Retries with exponential backoff (1, 2, 4 ... minutes), then gives up as FAILED. */
export async function failJob(job: SyncJob, error: unknown) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  if (job.attempts >= MAX_ATTEMPTS) {
    await prisma.syncJob.update({
      where: { id: job.id },
      data: { status: "FAILED", finishedAt: new Date(), lockedAt: null, lastError: message },
    });
    return;
  }
  const delay = 60_000 * 2 ** (job.attempts - 1);
  await requeue(job, new Date(Date.now() + delay), message, true);
}

export async function postponeJob(job: SyncJob, runAt: Date, reason: string) {
  await requeue(job, runAt, reason, false);
}

/** Requeues jobs whose worker died mid-run. */
export async function releaseStaleJobs() {
  const stale = await prisma.syncJob.findMany({
    where: { status: "RUNNING", lockedAt: { lt: new Date(Date.now() - STALE_AFTER_MS) } },
  });
  for (const job of stale) await requeue(job, new Date(), "Worker stopped mid-run", false);
  return stale.length;
}
