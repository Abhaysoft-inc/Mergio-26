-- CreateEnum
CREATE TYPE "CollegeMatch" AS ENUM ('USER', 'ALIAS');

-- CreateEnum
CREATE TYPE "CollegeSource" AS ENUM ('AICTE', 'UGC', 'ADMIN');

-- CreateEnum
CREATE TYPE "LeaderboardSnapshotKind" AS ENUM ('FREEZE', 'FINAL');

-- AlterEnum
ALTER TYPE "SyncJobKind" ADD VALUE 'LEADERBOARD_REFRESH';

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "collegeId" TEXT,
ADD COLUMN     "collegeMatch" "CollegeMatch";

-- AlterTable
ALTER TABLE "Season" ADD COLUMN     "finalSnapshotId" TEXT,
ADD COLUMN     "finalizedAt" TIMESTAMP(3),
ADD COLUMN     "finalizedById" TEXT,
ADD COLUMN     "freezeSnapshotId" TEXT,
ADD COLUMN     "leaderboardAutoFreeze" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "leaderboardFrozenAt" TIMESTAMP(3),
ADD COLUMN     "leaderboardFrozenById" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "College" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "city" TEXT,
    "source" "CollegeSource" NOT NULL,
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "College_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollegeAlias" (
    "id" TEXT NOT NULL,
    "collegeId" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollegeAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaderboardSnapshot" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "kind" "LeaderboardSnapshotKind" NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL,
    "takenById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaderboardSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaderboardSnapshotEntry" (
    "snapshotId" TEXT NOT NULL,
    "board" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "advanced" INTEGER NOT NULL,
    "intermediate" INTEGER NOT NULL,
    "beginner" INTEGER NOT NULL,
    "reachedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaderboardSnapshotEntry_pkey" PRIMARY KEY ("snapshotId","board","entityId")
);

-- CreateIndex
CREATE UNIQUE INDEX "College_slug_key" ON "College"("slug");

-- CreateIndex
CREATE INDEX "College_state_idx" ON "College"("state");

-- CreateIndex
CREATE UNIQUE INDEX "College_source_sourceId_key" ON "College"("source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "CollegeAlias_normalized_key" ON "CollegeAlias"("normalized");

-- CreateIndex
CREATE INDEX "CollegeAlias_collegeId_idx" ON "CollegeAlias"("collegeId");

-- CreateIndex
CREATE INDEX "LeaderboardSnapshot_seasonId_kind_idx" ON "LeaderboardSnapshot"("seasonId", "kind");

-- CreateIndex
CREATE INDEX "LeaderboardSnapshotEntry_snapshotId_board_rank_idx" ON "LeaderboardSnapshotEntry"("snapshotId", "board", "rank");

-- CreateIndex
CREATE INDEX "Profile_collegeId_idx" ON "Profile"("collegeId");

-- CreateIndex
CREATE INDEX "Profile_graduationYear_idx" ON "Profile"("graduationYear");

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollegeAlias" ADD CONSTRAINT "CollegeAlias_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollegeAlias" ADD CONSTRAINT "CollegeAlias_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderboardSnapshot" ADD CONSTRAINT "LeaderboardSnapshot_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderboardSnapshotEntry" ADD CONSTRAINT "LeaderboardSnapshotEntry_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "LeaderboardSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
