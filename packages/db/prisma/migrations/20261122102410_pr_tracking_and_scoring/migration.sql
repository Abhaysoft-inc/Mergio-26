-- CreateEnum
CREATE TYPE "SyncJobKind" AS ENUM ('PULL_REQUEST', 'ISSUE', 'REPO_RESYNC', 'INSTALLATION', 'REPOSITORY', 'USER_RESCORE');

-- CreateEnum
CREATE TYPE "SyncJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "PullRequestState" AS ENUM ('OPEN', 'CLOSED', 'MERGED');

-- CreateEnum
CREATE TYPE "PrLevel" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "PrScoreStatus" AS ENUM ('OPEN', 'CLOSED', 'AWAITING_LABEL', 'SCORED', 'NOT_ELIGIBLE', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "ScoreReason" AS ENUM ('NOT_REGISTERED', 'NO_PROGRAM_LABEL', 'NO_LEVEL_LABEL', 'MULTIPLE_LEVEL_LABELS', 'OUTSIDE_WINDOW', 'REPO_NOT_TRACKED', 'WRONG_BASE_BRANCH', 'SELF_MERGED', 'AUTHOR_IS_MENTOR', 'CAP_REACHED', 'INVALID_LABEL', 'SPAM_LABEL', 'REVERTED', 'AUTHOR_SANCTIONED');

-- CreateEnum
CREATE TYPE "LabelAction" AS ENUM ('ADDED', 'REMOVED');

-- CreateEnum
CREATE TYPE "ScoreEventKind" AS ENUM ('AWARD', 'REVERSAL', 'ADJUSTMENT', 'DISPUTE_CORRECTION');

-- CreateEnum
CREATE TYPE "IssueState" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "DisputeCategory" AS ENUM ('WRONG_LEVEL', 'MISSING_POINTS', 'WRONGLY_INELIGIBLE', 'WRONGLY_INVALIDATED', 'OTHER');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'UPHELD', 'REJECTED');

-- AlterTable
ALTER TABLE "ProjectRepo" ADD COLUMN     "defaultBranch" TEXT,
ADD COLUMN     "installationId" BIGINT,
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Season" ADD COLUMN     "codingEndsAt" TIMESTAMP(3),
ADD COLUMN     "codingStartsAt" TIMESTAMP(3),
ADD COLUMN     "scoringRules" JSONB;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "scoringSuspendedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "action" TEXT,
    "githubRepoId" BIGINT,
    "installationId" BIGINT,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "kind" "SyncJobKind" NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "SyncJobStatus" NOT NULL DEFAULT 'QUEUED',
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PullRequest" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "githubId" BIGINT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "authorGithubId" BIGINT NOT NULL,
    "authorLogin" TEXT NOT NULL,
    "authorId" TEXT,
    "state" "PullRequestState" NOT NULL,
    "isDraft" BOOLEAN NOT NULL DEFAULT false,
    "baseRef" TEXT NOT NULL,
    "labels" TEXT[],
    "linkedIssueNumbers" INTEGER[],
    "linkedIssueLabels" TEXT[],
    "additions" INTEGER NOT NULL DEFAULT 0,
    "deletions" INTEGER NOT NULL DEFAULT 0,
    "changedLines" INTEGER,
    "mergedAt" TIMESTAMP(3),
    "mergedByGithubId" BIGINT,
    "mergedByLogin" TEXT,
    "closedAt" TIMESTAMP(3),
    "revertsNumber" INTEGER,
    "approvedByGithubIds" BIGINT[],
    "githubCreatedAt" TIMESTAMP(3) NOT NULL,
    "githubUpdatedAt" TIMESTAMP(3) NOT NULL,
    "scoreStatus" "PrScoreStatus" NOT NULL DEFAULT 'OPEN',
    "scoreReason" "ScoreReason",
    "level" "PrLevel",
    "points" INTEGER NOT NULL DEFAULT 0,
    "labelDeadline" TIMESTAMP(3),
    "scoreNotes" TEXT[],
    "scoredAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PullRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrLabelEvent" (
    "id" TEXT NOT NULL,
    "pullRequestId" TEXT NOT NULL,
    "githubEventId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "action" "LabelAction" NOT NULL,
    "actorLogin" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrLabelEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreEvent" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pullRequestId" TEXT,
    "kind" "ScoreEventKind" NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "level" "PrLevel",
    "description" TEXT NOT NULL,
    "reason" "ScoreReason",
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BadgeDefinition" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BadgeDefinition_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "UserBadge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "badgeKey" TEXT NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBadge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramIssue" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "githubId" BIGINT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "state" "IssueState" NOT NULL,
    "labels" TEXT[],
    "level" "PrLevel",
    "assigneeCount" INTEGER NOT NULL DEFAULT 0,
    "githubCreatedAt" TIMESTAMP(3) NOT NULL,
    "githubUpdatedAt" TIMESTAMP(3) NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgramIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pullRequestId" TEXT NOT NULL,
    "category" "DisputeCategory" NOT NULL,
    "text" TEXT NOT NULL,
    "evidenceUrls" TEXT[],
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookDelivery_receivedAt_idx" ON "WebhookDelivery"("receivedAt");

-- CreateIndex
CREATE INDEX "SyncJob_status_runAt_idx" ON "SyncJob"("status", "runAt");

-- CreateIndex
CREATE INDEX "SyncJob_dedupeKey_idx" ON "SyncJob"("dedupeKey");

-- CreateIndex
CREATE INDEX "PullRequest_githubId_idx" ON "PullRequest"("githubId");

-- CreateIndex
CREATE INDEX "PullRequest_authorId_seasonId_idx" ON "PullRequest"("authorId", "seasonId");

-- CreateIndex
CREATE INDEX "PullRequest_authorGithubId_idx" ON "PullRequest"("authorGithubId");

-- CreateIndex
CREATE INDEX "PullRequest_scoreStatus_labelDeadline_idx" ON "PullRequest"("scoreStatus", "labelDeadline");

-- CreateIndex
CREATE UNIQUE INDEX "PullRequest_repoId_number_key" ON "PullRequest"("repoId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "PrLabelEvent_githubEventId_key" ON "PrLabelEvent"("githubEventId");

-- CreateIndex
CREATE INDEX "PrLabelEvent_pullRequestId_createdAt_idx" ON "PrLabelEvent"("pullRequestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScoreEvent_idempotencyKey_key" ON "ScoreEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ScoreEvent_seasonId_userId_effectiveAt_idx" ON "ScoreEvent"("seasonId", "userId", "effectiveAt");

-- CreateIndex
CREATE INDEX "ScoreEvent_seasonId_effectiveAt_idx" ON "ScoreEvent"("seasonId", "effectiveAt");

-- CreateIndex
CREATE INDEX "ScoreEvent_pullRequestId_idx" ON "ScoreEvent"("pullRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "UserBadge_userId_seasonId_badgeKey_key" ON "UserBadge"("userId", "seasonId", "badgeKey");

-- CreateIndex
CREATE INDEX "ProgramIssue_state_level_idx" ON "ProgramIssue"("state", "level");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramIssue_repoId_number_key" ON "ProgramIssue"("repoId", "number");

-- CreateIndex
CREATE INDEX "Dispute_userId_createdAt_idx" ON "Dispute"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Dispute_pullRequestId_idx" ON "Dispute"("pullRequestId");

-- CreateIndex
CREATE INDEX "Dispute_status_createdAt_idx" ON "Dispute"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "PullRequest" ADD CONSTRAINT "PullRequest_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "ProjectRepo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequest" ADD CONSTRAINT "PullRequest_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequest" ADD CONSTRAINT "PullRequest_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrLabelEvent" ADD CONSTRAINT "PrLabelEvent_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "PullRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreEvent" ADD CONSTRAINT "ScoreEvent_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreEvent" ADD CONSTRAINT "ScoreEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreEvent" ADD CONSTRAINT "ScoreEvent_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "PullRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_badgeKey_fkey" FOREIGN KEY ("badgeKey") REFERENCES "BadgeDefinition"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramIssue" ADD CONSTRAINT "ProgramIssue_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "ProjectRepo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "PullRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one queued job per dedupe key: webhooks for the same PR collapse into one refetch.
CREATE UNIQUE INDEX "SyncJob_queued_dedupeKey_key" ON "SyncJob"("dedupeKey") WHERE "status" = 'QUEUED';

-- At most one unresolved dispute per pull request.
CREATE UNIQUE INDEX "Dispute_open_pullRequestId_key" ON "Dispute"("pullRequestId") WHERE "status" IN ('OPEN', 'IN_REVIEW');

-- Badge definitions (BADGES in packages/scoring/src/badges.ts; the worker keeps them in sync).
INSERT INTO "BadgeDefinition" ("key", "name", "description", "ruleKey", "threshold", "sortOrder", "updatedAt") VALUES
  ('first-merge', 'First Merge', 'Your first scored pull request.', 'scored_prs', 1, 0, CURRENT_TIMESTAMP),
  ('prs-5', '5 PRs', 'Five scored pull requests.', 'scored_prs', 5, 1, CURRENT_TIMESTAMP),
  ('prs-10', '10 PRs', 'Ten scored pull requests.', 'scored_prs', 10, 2, CURRENT_TIMESTAMP),
  ('prs-25', '25 PRs', 'Twenty-five scored pull requests.', 'scored_prs', 25, 3, CURRENT_TIMESTAMP),
  ('advanced-slayer', 'Advanced Slayer', 'Three scored advanced pull requests.', 'advanced_prs', 3, 4, CURRENT_TIMESTAMP),
  ('explorer', 'Explorer', 'Scored pull requests on three or more projects.', 'projects', 3, 5, CURRENT_TIMESTAMP),
  ('streak', 'Streak', 'A scored pull request in four weeks in a row.', 'week_streak', 4, 6, CURRENT_TIMESTAMP),
  ('top-100', 'Top 100', 'Reached the top 100 of the season leaderboard.', 'rank_at_most', 100, 7, CURRENT_TIMESTAMP),
  ('top-10', 'Top 10', 'Reached the top 10 of the season leaderboard.', 'rank_at_most', 10, 8, CURRENT_TIMESTAMP),
  ('mentors-pick', 'Mentor''s Pick', 'A mentor gave one of your pull requests the quality bonus.', 'quality_bonus', 1, 9, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
