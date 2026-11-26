import { prisma } from "@repo/db";
import type { BadgeStats } from "../badges";
import { istWeekKey, istWeekStart } from "../time";
import { officialStanding, type LeaderboardSeason } from "./leaderboard/cache";
import { boardRowsSql } from "./leaderboard/sql";

// Ranks and stats straight from the ledger, the source of truth. The leaderboards (F-08) serve the
// same ranks from Redis; officialStanding() in ./leaderboard is what pages show.

export type Rank = { rank: number; points: number; ranked: number };

/**
 * A contributor's live rank by points effective in [from, now], from the same SQL the Redis
 * leaderboards are rebuilt from (./leaderboard/sql.ts), so the order is the app-wide one: points,
 * advanced PRs, intermediate PRs, reached first, then user id. `from` is a week's Monday 00:00 IST
 * for the weekly board. Null when unranked.
 */
export async function rankOf(
  seasonId: string,
  userId: string,
  now: Date,
  from: Date | null = null,
): Promise<Rank | null> {
  const rows = await boardRowsSql(
    seasonId,
    from ? { family: "weekly", week: istWeekKey(from) } : { family: "overall" },
    now,
  );
  const row = rows.find((entry) => entry.id === userId);
  return row ? { rank: row.rank, points: row.points, ranked: rows.length } : null;
}

/** Points effective now, and points written but held back by the daily cap. */
export async function pointsOf(seasonId: string, userId: string, now: Date) {
  const [effective, held] = await Promise.all([
    prisma.scoreEvent.aggregate({
      where: { seasonId, userId, effectiveAt: { lte: now } },
      _sum: { points: true },
    }),
    prisma.scoreEvent.aggregate({
      where: { seasonId, userId, effectiveAt: { gt: now } },
      _sum: { points: true },
    }),
  ]);
  return { points: effective._sum.points ?? 0, heldPoints: held._sum.points ?? 0 };
}

/** What the badge rules look at, for one contributor in one season. */
export async function badgeStatsOf(
  seasonId: string,
  userId: string,
  rank: number | null,
): Promise<BadgeStats> {
  const [scored, quality] = await Promise.all([
    prisma.pullRequest.findMany({
      where: { seasonId, authorId: userId, scoreStatus: "SCORED" },
      select: { level: true, mergedAt: true, repo: { select: { projectId: true } } },
    }),
    prisma.scoreEvent.groupBy({
      by: ["pullRequestId"],
      where: { seasonId, userId, ruleKey: "bonus:quality" },
      _sum: { points: true },
    }),
  ]);
  return {
    scoredPrs: scored.length,
    advancedPrs: scored.filter((pr) => pr.level === "ADVANCED").length,
    projects: new Set(scored.map((pr) => pr.repo.projectId)).size,
    weeks: scored.flatMap((pr) => (pr.mergedAt ? [istWeekKey(pr.mergedAt)] : [])),
    rank,
    qualityBonuses: quality.filter((group) => (group._sum.points ?? 0) > 0).length,
  };
}

/**
 * Live points (overall, held back by the daily cap, and this week's) with the official ranks: live
 * normally, the snapshot's while the leaderboard is frozen or final. Ranks come from the
 * leaderboard cache, so the dashboard and the boards always show the same number.
 */
export async function standingOf(season: LeaderboardSeason, userId: string, now: Date) {
  const weekStart = istWeekStart(now);
  const [points, weekly, official] = await Promise.all([
    pointsOf(season.id, userId, now),
    prisma.scoreEvent.aggregate({
      where: { seasonId: season.id, userId, effectiveAt: { gte: weekStart, lte: now } },
      _sum: { points: true },
    }),
    officialStanding(season, userId, now),
  ]);
  return {
    ...points,
    rank: official.rank,
    rankedContributors: official.rank ? official.rankedContributors : null,
    weeklyPoints: weekly._sum.points ?? 0,
    weeklyRank: official.weeklyRank,
    weekStart,
    leaderboardPhase: official.phase,
  };
}
