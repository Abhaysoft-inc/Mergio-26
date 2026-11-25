import { randomUUID } from "node:crypto";
import { prisma, Prisma, type SyncJobKind } from "@repo/db";

// Enqueueing for the GitHub sync queue (SyncJob). The web app enqueues from webhooks and sign-up;
// the worker in apps/backend runs the jobs. Jobs refetch the current state from GitHub, so a job
// that is already queued for the same key absorbs new ones (a partial unique index allows one
// QUEUED job per dedupeKey).

export type JobPayloads = {
  PULL_REQUEST: { githubRepoId: string; number: number };
  ISSUE: { githubRepoId: string; number: number };
  REPO_RESYNC: { githubRepoId: string };
  INSTALLATION: {
    installationId: string;
    action: string;
    /** Repos named in the event (added or removed); the worker lists the rest itself. */
    githubRepoIds: string[];
  };
  REPOSITORY: { githubRepoId: string; action: string };
  USER_RESCORE: { userId: string };
  /** Checks each mentor's GitHub role on the project's repos (they need triage to label). */
  MENTOR_ACCESS: { projectId: string };
};

export type Job = { [K in SyncJobKind]: { kind: K; payload: JobPayloads[K] } }[SyncJobKind];

export function dedupeKeyOf(job: Job): string {
  switch (job.kind) {
    case "PULL_REQUEST":
      return `pr:${job.payload.githubRepoId}:${job.payload.number}`;
    case "ISSUE":
      return `issue:${job.payload.githubRepoId}:${job.payload.number}`;
    case "REPO_RESYNC":
      return `resync:${job.payload.githubRepoId}`;
    case "INSTALLATION":
      // Different actions on one installation must not swallow each other (deleted after created).
      return `installation:${job.payload.installationId}:${job.payload.action}:${job.payload.githubRepoIds.join(",")}`;
    case "REPOSITORY":
      return `repository:${job.payload.githubRepoId}:${job.payload.action}`;
    case "USER_RESCORE":
      return `user:${job.payload.userId}`;
    case "MENTOR_ACCESS":
      return `mentor-access:${job.payload.projectId}`;
  }
}

type Client = Pick<typeof prisma, "$executeRaw">;

/** Queues jobs, merging each into an already queued job with the same key. */
export async function enqueueJobs(jobs: Job[], options: { runAt?: Date; client?: Client } = {}) {
  // Postgres rejects an upsert that touches the same row twice, so dedupe the batch first.
  const unique = [...new Map(jobs.map((job) => [dedupeKeyOf(job), job])).values()];
  if (unique.length === 0) return;
  const runAt = options.runAt ?? new Date();
  const rows = unique.map(
    (job) =>
      Prisma.sql`(${randomUUID()}, ${job.kind}::"SyncJobKind", ${dedupeKeyOf(job)}, ${JSON.stringify(job.payload)}::jsonb, 'QUEUED', ${runAt}, CURRENT_TIMESTAMP)`,
  );
  await (options.client ?? prisma).$executeRaw`
    INSERT INTO "SyncJob" ("id", "kind", "dedupeKey", "payload", "status", "runAt", "createdAt")
    VALUES ${Prisma.join(rows)}
    ON CONFLICT ("dedupeKey") WHERE "status" = 'QUEUED'
    DO UPDATE SET "runAt" = LEAST("SyncJob"."runAt", EXCLUDED."runAt")
  `;
}
