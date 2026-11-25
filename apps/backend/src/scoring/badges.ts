import { prisma } from "@repo/db";
import { BADGES, meetsBadge } from "@repo/scoring";
import { badgeStatsOf, enqueueJobs, officialRankSql } from "@repo/scoring/server";

// Badge evaluation (F-15): after every score event and nightly. Badges are never taken away and
// never awarded twice (unique per user, season and badge).

/** Keeps BadgeDefinition rows in step with BADGES in packages/scoring. */
export async function syncBadgeDefinitions() {
  await prisma.$transaction(
    BADGES.map((badge, sortOrder) =>
      prisma.badgeDefinition.upsert({
        where: { key: badge.key },
        create: {
          key: badge.key,
          name: badge.name,
          description: badge.description,
          ruleKey: badge.rule,
          threshold: badge.threshold,
          sortOrder,
        },
        update: {
          name: badge.name,
          description: badge.description,
          ruleKey: badge.rule,
          threshold: badge.threshold,
          sortOrder,
        },
      }),
    ),
  );
}

export async function awardBadges(seasonId: string, userId: string, now = new Date()) {
  const season = await prisma.season.findUnique({ where: { id: seasonId } });
  // Nothing is awarded once the season is finalized (PRD §4.8).
  if (!season || season.finalizedAt) return;
  // The official rank: while frozen, a rank badge can't give away the live standing.
  const rank = await officialRankSql(season, userId, now);
  const stats = await badgeStatsOf(seasonId, userId, rank);
  const earned = BADGES.filter((badge) => meetsBadge(badge, stats));
  if (earned.length === 0) return;
  const { count } = await prisma.userBadge.createMany({
    data: earned.map((badge) => ({ userId, seasonId, badgeKey: badge.key, earnedAt: now })),
    skipDuplicates: true,
  });
  // Leaderboard rows show the top three badges.
  if (count > 0) {
    await enqueueJobs([{ kind: "LEADERBOARD_REFRESH", payload: { seasonId, kind: "user", id: userId } }]);
  }
}

/** Everyone with points this season: catches rank badges earned when others lost points. */
export async function awardBadgesForSeason(seasonId: string, now = new Date()) {
  const users = await prisma.scoreEvent.findMany({
    where: { seasonId },
    distinct: ["userId"],
    select: { userId: true },
  });
  for (const { userId } of users) await awardBadges(seasonId, userId, now);
}
