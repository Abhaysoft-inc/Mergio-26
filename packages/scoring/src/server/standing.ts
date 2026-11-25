import { prisma, Prisma } from "@repo/db";
import type { BadgeStats } from "../badges";
import { istWeekKey, istWeekStart } from "../time";

// Ranks and stats straight from the ledger, the source of truth. F-08 puts a Redis cache in front
// of the leaderboards; these queries are what it is rebuilt from, so ranks always match them.

export type Rank = { rank: number; points: number; ranked: number };

/**
 * A contributor's rank by points effective in [from, now]. Ties (PRD §4.7): more advanced PRs,
 * then more intermediate PRs, then whoever reached their total first. Null when unranked.
 */
export async function rankOf(
  seasonId: string,
  userId: string,
  now: Date,
  from: Date | null = null,
): Promise<Rank | null> {
  const since = from ?? new Date(0);
  const rows = await prisma.$queryRaw<{ rank: bigint; points: number; ranked: bigint }[]>(
    Prisma.sql`
      WITH totals AS (
        SELECT "userId", SUM("points")::int AS points, MAX("effectiveAt") AS reached_at
        FROM "ScoreEvent"
        WHERE "seasonId" = ${seasonId} AND "effectiveAt" >= ${since} AND "effectiveAt" <= ${now}
        GROUP BY "userId"
      ),
      levels AS (
        SELECT "authorId" AS "userId",
               COUNT(*) FILTER (WHERE "level" = 'ADVANCED') AS advanced,
               COUNT(*) FILTER (WHERE "level" = 'INTERMEDIATE') AS intermediate
        FROM "PullRequest"
        WHERE "seasonId" = ${seasonId} AND "scoreStatus" = 'SCORED' AND "authorId" IS NOT NULL
          AND "mergedAt" >= ${since} AND "mergedAt" <= ${now}
        GROUP BY "authorId"
      ),
      ranked AS (
        SELECT t."userId", t.points,
               RANK() OVER (
                 ORDER BY t.points DESC,
                          COALESCE(l.advanced, 0) DESC,
                          COALESCE(l.intermediate, 0) DESC,
                          t.reached_at ASC
               ) AS rank
        FROM totals t LEFT JOIN levels l ON l."userId" = t."userId"
        WHERE t.points > 0
      )
      SELECT rank, points, (SELECT COUNT(*) FROM ranked) AS ranked
      FROM ranked WHERE "userId" = ${userId}
    `,
  );
  const row = rows[0];
  return row ? { rank: Number(row.rank), points: row.points, ranked: Number(row.ranked) } : null;
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

/** Overall and weekly (Monday 00:00 IST onwards) standing. */
export async function standingOf(seasonId: string, userId: string, now: Date) {
  const weekStart = istWeekStart(now);
  const [overall, weekly, points] = await Promise.all([
    rankOf(seasonId, userId, now),
    rankOf(seasonId, userId, now, weekStart),
    pointsOf(seasonId, userId, now),
  ]);
  return {
    ...points,
    rank: overall?.rank ?? null,
    rankedContributors: overall?.ranked ?? null,
    weeklyPoints: weekly?.points ?? 0,
    weeklyRank: weekly?.rank ?? null,
    weekStart,
  };
}
