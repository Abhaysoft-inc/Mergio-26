import { prisma, type LeaderboardSnapshotKind, type Prisma } from "@repo/db";
import { boardKey, boardPhase, type BoardRef } from "../../leaderboard";
import { istWeekKey } from "../../time";
import type { LeaderboardSeason } from "./cache";
import { aggregateColleges, boardRowsSql, partitionedRowsSql, type RankedRow } from "./sql";

// Freeze and finalize (PRD §4.8). Both write a snapshot of every board to Postgres, the permanent
// record; Redis loads the snapshot back when it needs it. The ledger keeps growing while frozen.
// Finalizing locks it: scoring, mentor points and badges check seasonLocked() and write nothing.

export class LeaderboardStateError extends Error {}

/** All boards as of `now`, ranked. */
async function allBoards(seasonId: string, now: Date) {
  const [overall, weekly, projects, collegeMembers, mentors] = await Promise.all([
    boardRowsSql(seasonId, { family: "overall" }, now),
    boardRowsSql(seasonId, { family: "weekly", week: istWeekKey(now) }, now),
    partitionedRowsSql(seasonId, "project", now),
    partitionedRowsSql(seasonId, "college", now),
    boardRowsSql(seasonId, { family: "mentors" }, now),
  ]);
  const boards: { board: BoardRef; rows: RankedRow[] }[] = [
    { board: { family: "overall" }, rows: overall },
    { board: { family: "weekly", week: istWeekKey(now) }, rows: weekly },
    { board: { family: "colleges" }, rows: aggregateColleges(collegeMembers) },
    { board: { family: "mentors" }, rows: mentors },
  ];
  const group = (rows: RankedRow[]) => {
    const map = new Map<string, RankedRow[]>();
    for (const row of rows) map.set(row.partition, [...(map.get(row.partition) ?? []), row]);
    return map;
  };
  for (const [projectId, rows] of group(projects)) boards.push({ board: { family: "project", projectId }, rows });
  for (const [collegeId, rows] of group(collegeMembers)) boards.push({ board: { family: "college", collegeId }, rows });
  return boards;
}

export async function takeSnapshot(
  seasonId: string,
  kind: LeaderboardSnapshotKind,
  actorId: string | null,
  now: Date,
) {
  const boards = await allBoards(seasonId, now);
  const snapshot = await prisma.leaderboardSnapshot.create({
    data: { seasonId, kind, takenAt: now, takenById: actorId },
  });
  const entries = boards.flatMap(({ board, rows }) =>
    rows.map((row) => ({
      snapshotId: snapshot.id,
      board: boardKey(board),
      entityId: row.id,
      rank: row.rank,
      points: row.points,
      advanced: row.advanced,
      intermediate: row.intermediate,
      beginner: row.beginner,
      reachedAt: row.reachedAt,
    })),
  );
  for (let i = 0; i < entries.length; i += 5_000) {
    await prisma.leaderboardSnapshotEntry.createMany({ data: entries.slice(i, i + 5_000) });
  }
  return snapshot.id;
}

/** Freezes the public board. `actorId` null means the worker's automatic freeze. */
export async function freezeLeaderboard(seasonId: string, actorId: string | null, now = new Date()) {
  const season = await prisma.season.findUniqueOrThrow({ where: { id: seasonId } });
  if (season.finalizedAt) throw new LeaderboardStateError("The leaderboard is already finalized.");
  if (season.leaderboardFrozenAt) throw new LeaderboardStateError("The leaderboard is already frozen.");
  const snapshotId = await takeSnapshot(seasonId, "FREEZE", actorId, now);
  // Only one freeze wins if two organizers (or the worker) race.
  const { count } = await prisma.season.updateMany({
    where: { id: seasonId, leaderboardFrozenAt: null, finalizedAt: null },
    data: { leaderboardFrozenAt: now, leaderboardFrozenById: actorId, freezeSnapshotId: snapshotId },
  });
  if (count === 0) {
    await prisma.leaderboardSnapshot.delete({ where: { id: snapshotId } });
    throw new LeaderboardStateError("The leaderboard was frozen by someone else just now.");
  }
  return snapshotId;
}

/** Shows live ranks again, and stops the worker from freezing it automatically. */
export async function unfreezeLeaderboard(seasonId: string) {
  const { count } = await prisma.season.updateMany({
    where: { id: seasonId, leaderboardFrozenAt: { not: null }, finalizedAt: null },
    data: {
      leaderboardFrozenAt: null,
      leaderboardFrozenById: null,
      freezeSnapshotId: null,
      leaderboardAutoFreeze: false,
    },
  });
  if (count === 0) throw new LeaderboardStateError("The leaderboard isn't frozen (or is finalized).");
}

/**
 * For a transaction about to write to the season's ledger: takes a shared lock on the season row
 * and says whether writing is allowed (not finalized). Finalizing takes the row exclusively, so a
 * write either commits before the final snapshot is read, or waits and then sees it finalized.
 */
export async function ledgerOpen(tx: Prisma.TransactionClient, seasonId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ finalizedAt: Date | null }[]>`
    SELECT "finalizedAt" FROM "Season" WHERE id = ${seasonId} FOR SHARE
  `;
  return rows.length > 0 && rows[0]!.finalizedAt === null;
}

/** Locks the ledger and records the official ranks. Only after coding has ended. */
export async function finalizeLeaderboard(seasonId: string, actorId: string, now = new Date()) {
  return prisma.$transaction(
    async (tx) => {
      // Waits for ledger writes in flight (see ledgerOpen) and holds off new ones until commit.
      const [season] = await tx.$queryRaw<{ finalizedAt: Date | null; codingEndsAt: Date | null }[]>`
        SELECT "finalizedAt", "codingEndsAt" FROM "Season" WHERE id = ${seasonId} FOR UPDATE
      `;
      if (!season) throw new LeaderboardStateError("No such season.");
      if (season.finalizedAt) throw new LeaderboardStateError("The leaderboard is already finalized.");
      if (!season.codingEndsAt || now < season.codingEndsAt) {
        throw new LeaderboardStateError("Finalize after the contribution window has closed.");
      }
      // Read on another connection: everything committed before the lock is in it, nothing after.
      const snapshotId = await takeSnapshot(seasonId, "FINAL", actorId, now);
      try {
        await tx.season.update({
          where: { id: seasonId },
          data: { finalizedAt: now, finalizedById: actorId, finalSnapshotId: snapshotId },
        });
      } catch (error) {
        await prisma.leaderboardSnapshot.delete({ where: { id: snapshotId } });
        throw error;
      }
      return snapshotId;
    },
    { timeout: 300_000, maxWait: 10_000 },
  );
}

/** Super Admins only (checked by the caller). The final snapshot is kept as a record. */
export async function unfinalizeLeaderboard(seasonId: string) {
  const { count } = await prisma.season.updateMany({
    where: { id: seasonId, finalizedAt: { not: null } },
    data: { finalizedAt: null, finalizedById: null, finalSnapshotId: null },
  });
  if (count === 0) throw new LeaderboardStateError("The leaderboard isn't finalized.");
}

/** Whether the season's ledger is locked (finalized). */
export async function seasonLocked(seasonId: string) {
  const season = await prisma.season.findUnique({ where: { id: seasonId }, select: { finalizedAt: true } });
  return Boolean(season?.finalizedAt);
}

/**
 * The official overall rank straight from Postgres: the snapshot's while frozen or final, else
 * live. Badges use this, so a rank badge can't reveal a live rank during the freeze.
 */
export async function officialRankSql(season: LeaderboardSeason, userId: string, now = new Date()) {
  return (await officialRanksSql(season, now, userId)).get(userId) ?? null;
}

/** Every official overall rank (or one user's), by user id. One query for a whole season run. */
export async function officialRanksSql(
  season: LeaderboardSeason,
  now = new Date(),
  userId?: string,
): Promise<Map<string, number>> {
  const phase = boardPhase(season);
  if (phase.phase !== "live") {
    const entries = await prisma.leaderboardSnapshotEntry.findMany({
      where: { snapshotId: phase.snapshotId, board: "overall", ...(userId ? { entityId: userId } : {}) },
      select: { entityId: true, rank: true },
    });
    return new Map(entries.map((entry) => [entry.entityId, entry.rank]));
  }
  const all = await boardRowsSql(season.id, { family: "overall" }, now);
  return new Map(all.map((entry) => [entry.id, entry.rank]));
}
