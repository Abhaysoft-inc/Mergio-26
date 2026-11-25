-- CreateEnum
CREATE TYPE "FlagCategory" AS ENUM ('SPAM', 'PLAGIARISM', 'LOW_QUALITY_AI', 'MULTIPLE_ACCOUNTS', 'OTHER');

-- CreateEnum
CREATE TYPE "FlagStatus" AS ENUM ('OPEN', 'ACTIONED', 'DISMISSED');

-- AlterEnum
ALTER TYPE "SyncJobKind" ADD VALUE 'MENTOR_ACCESS';

-- AlterTable
ALTER TABLE "ProjectRepo" ADD COLUMN     "labelsCheckedAt" TIMESTAMP(3),
ADD COLUMN     "missingLabels" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "PullRequest" ADD COLUMN     "linkedIssueLabelers" JSONB;

-- AlterTable
ALTER TABLE "Registration" ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT;

-- CreateTable
CREATE TABLE "ProjectMentor" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "githubLogin" TEXT NOT NULL,
    "userId" TEXT,
    "invitedById" TEXT,
    "repoAccess" JSONB,
    "accessCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMentor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MentorPointEvent" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pullRequestId" TEXT,
    "ruleKey" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MentorPointEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Flag" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "targetUserId" TEXT,
    "targetGithubLogin" TEXT NOT NULL,
    "pullRequestId" TEXT,
    "category" "FlagCategory" NOT NULL,
    "note" TEXT NOT NULL,
    "status" "FlagStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Flag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectMentor_userId_idx" ON "ProjectMentor"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMentor_projectId_githubLogin_key" ON "ProjectMentor"("projectId", "githubLogin");

-- CreateIndex
CREATE UNIQUE INDEX "MentorPointEvent_idempotencyKey_key" ON "MentorPointEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "MentorPointEvent_seasonId_userId_createdAt_idx" ON "MentorPointEvent"("seasonId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "MentorPointEvent_ruleKey_idx" ON "MentorPointEvent"("ruleKey");

-- CreateIndex
CREATE INDEX "Flag_status_createdAt_idx" ON "Flag"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Flag_targetUserId_idx" ON "Flag"("targetUserId");

-- CreateIndex
CREATE INDEX "Flag_reporterId_pullRequestId_idx" ON "Flag"("reporterId", "pullRequestId");

-- AddForeignKey
ALTER TABLE "ProjectMentor" ADD CONSTRAINT "ProjectMentor_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMentor" ADD CONSTRAINT "ProjectMentor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MentorPointEvent" ADD CONSTRAINT "MentorPointEvent_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MentorPointEvent" ADD CONSTRAINT "MentorPointEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MentorPointEvent" ADD CONSTRAINT "MentorPointEvent_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "PullRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flag" ADD CONSTRAINT "Flag_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flag" ADD CONSTRAINT "Flag_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flag" ADD CONSTRAINT "Flag_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flag" ADD CONSTRAINT "Flag_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "PullRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
