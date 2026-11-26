-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('ORGANIZER', 'SUPER_ADMIN');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "banReason" TEXT,
ADD COLUMN     "bannedAt" TIMESTAMP(3),
ADD COLUMN     "staffRole" "StaffRole";

-- Everyone marked isAdmin so far was promoted through ADMIN_GITHUB_LOGINS (the people who
-- run the platform), so they keep full access as super admins while preserving isAdmin.
UPDATE "User" SET "staffRole" = 'SUPER_ADMIN' WHERE "isAdmin" = true;
