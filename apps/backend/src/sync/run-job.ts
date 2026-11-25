import { prisma, type SyncJob } from "@repo/db";
import type { JobPayloads } from "@repo/scoring/server";
import { scoreMentorPoints } from "../scoring/mentor-points";
import { scorePullRequest } from "../scoring/score-pr";
import { syncIssue } from "./issue";
import { checkMentorAccess } from "./mentor-access";
import { syncPullRequest } from "./pull-request";
import { resyncRepo, syncInstallation, syncRepository } from "./repository";

/**
 * Someone's roles changed: they registered as a contributor after their PRs merged, or became
 * (or stopped being) a mentor. Rescore their own PRs, and the mentor points on the projects they
 * are attached to.
 */
async function rescoreUser(userId: string) {
  const account = await prisma.account.findFirst({
    where: { userId, providerId: "github" },
    select: { accountId: true },
  });
  if (!account) return;
  const prs = await prisma.pullRequest.findMany({
    where: { authorGithubId: BigInt(account.accountId), season: { isActive: true } },
    select: { id: true },
  });
  for (const pr of prs) await scorePullRequest(pr.id);

  const reviewed = await prisma.pullRequest.findMany({
    where: {
      season: { isActive: true },
      scoreStatus: "SCORED",
      repo: { project: { mentors: { some: { userId } } } },
    },
    select: { id: true },
  });
  for (const pr of reviewed) await scoreMentorPoints(pr.id);
}

export async function runJob(job: SyncJob) {
  switch (job.kind) {
    case "PULL_REQUEST": {
      const payload = job.payload as JobPayloads["PULL_REQUEST"];
      return syncPullRequest(BigInt(payload.githubRepoId), payload.number);
    }
    case "ISSUE": {
      const payload = job.payload as JobPayloads["ISSUE"];
      return syncIssue(BigInt(payload.githubRepoId), payload.number);
    }
    case "REPO_RESYNC": {
      const payload = job.payload as JobPayloads["REPO_RESYNC"];
      return resyncRepo(BigInt(payload.githubRepoId));
    }
    case "INSTALLATION": {
      const payload = job.payload as JobPayloads["INSTALLATION"];
      return syncInstallation(
        BigInt(payload.installationId),
        payload.action,
        payload.githubRepoIds.map((id) => BigInt(id)),
      );
    }
    case "REPOSITORY": {
      const payload = job.payload as JobPayloads["REPOSITORY"];
      return syncRepository(BigInt(payload.githubRepoId), payload.action);
    }
    case "USER_RESCORE": {
      const payload = job.payload as JobPayloads["USER_RESCORE"];
      return rescoreUser(payload.userId);
    }
    case "MENTOR_ACCESS": {
      const payload = job.payload as JobPayloads["MENTOR_ACCESS"];
      return checkMentorAccess(payload.projectId);
    }
  }
}

/** Jobs that need the GitHub App (everything except rescoring stored PRs). */
export const needsGitHub = (job: SyncJob) => job.kind !== "USER_RESCORE";
