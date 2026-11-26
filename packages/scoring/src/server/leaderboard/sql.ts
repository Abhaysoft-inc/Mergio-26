import { prisma, Prisma } from "@repo/db";
import { compareStandings, type BoardRef, type Standing } from "../../leaderboard";
import { DAY_MS } from "../../time";

// The leaderboards computed straight from the ledger: the source of truth. Redis boards are
// rebuilt from these queries, and `leaderboard:verify` compares the two rank by rank. The ORDER BY
// here and compareStandings() in packages/scoring/src/leaderboard.ts are the same rule; the id
// uses the "C" collation so it compares bytes, like Redis does.

export type RankedRow = Standing & { rank: number; partition: string };

type RawRow = {
  partition: string;
  id: string;
  points: number;
  advanced: number;
  intermediate: number;
  beginner: number;
  reached_at: Date;
  rank: bigint;
};

const toRow = (row: RawRow): RankedRow => ({
  partition: row.partition,
  id: row.id,
  points: row.points,
  advanced: row.advanced,
  intermediate: row.intermediate,
  beginner: row.beginner,
  reachedAt: row.reached_at,
  rank: Number(row.rank),
});

const ORDER = Prisma.sql`ORDER BY points DESC, advanced DESC, intermediate DESC, reached_at ASC, id COLLATE "C" ASC`;

/** Prisma.join refuses an empty list. */
const joinAll = (parts: Prisma.Sql[]) => (parts.length ? Prisma.join(parts, " ") : Prisma.empty);

type Partitioning = "none" | "project" | "college";

type ContributorQuery = {
  seasonId: string;
  now: Date;
  /** Weekly boards: only points effective and PRs merged from here on. */
  from?: Date | null;
  partitionBy: Partitioning;
  /** Only this project or college. */
  partition?: string;
  /** Only these users (their rows' ranks are then meaningless). */
  users?: string[];
};

/** Contributor boards: one row per (partition, user) with positive points, ranked in order. */
async function contributorRows(query: ContributorQuery): Promise<RankedRow[]> {
  const since = query.from ?? new Date(0);
  const byProject = query.partitionBy === "project";
  const byCollege = query.partitionBy === "college";

  const eventPartition = byProject
    ? Prisma.sql`r."projectId"`
    : byCollege
      ? Prisma.sql`pf."collegeId"`
      : Prisma.sql`''`;
  const eventJoins = byProject
    ? Prisma.sql`JOIN "PullRequest" p ON p."id" = e."pullRequestId" JOIN "ProjectRepo" r ON r."id" = p."repoId"`
    : byCollege
      ? Prisma.sql`JOIN "Profile" pf ON pf."userId" = e."userId" AND pf."collegeId" IS NOT NULL`
      : Prisma.empty;
  const prPartition = byProject
    ? Prisma.sql`r."projectId"`
    : byCollege
      ? Prisma.sql`pf."collegeId"`
      : Prisma.sql`''`;
  const prJoins = byProject
    ? Prisma.sql`JOIN "ProjectRepo" r ON r."id" = p."repoId"`
    : byCollege
      ? Prisma.sql`JOIN "Profile" pf ON pf."userId" = p."authorId" AND pf."collegeId" IS NOT NULL`
      : Prisma.empty;

  const eventFilters: Prisma.Sql[] = [];
  const prFilters: Prisma.Sql[] = [];
  if (query.partition !== undefined) {
    eventFilters.push(Prisma.sql`AND ${eventPartition} = ${query.partition}`);
    prFilters.push(Prisma.sql`AND ${prPartition} = ${query.partition}`);
  }
  if (query.users) {
    if (query.users.length === 0) return [];
    eventFilters.push(Prisma.sql`AND e."userId" IN (${Prisma.join(query.users)})`);
    prFilters.push(Prisma.sql`AND p."authorId" IN (${Prisma.join(query.users)})`);
  }

  const rows = await prisma.$queryRaw<RawRow[]>`
    WITH totals AS (
      SELECT ${eventPartition} AS partition, e."userId" AS id,
             SUM(e."points")::int AS points, MAX(e."effectiveAt") AS reached_at
      FROM "ScoreEvent" e ${eventJoins}
      WHERE e."seasonId" = ${query.seasonId}
        AND e."effectiveAt" >= ${since} AND e."effectiveAt" <= ${query.now}
        ${joinAll(eventFilters)}
      GROUP BY 1, 2
    ),
    levels AS (
      SELECT ${prPartition} AS partition, p."authorId" AS id,
             COUNT(*) FILTER (WHERE p."level" = 'ADVANCED')::int AS advanced,
             COUNT(*) FILTER (WHERE p."level" = 'INTERMEDIATE')::int AS intermediate,
             COUNT(*) FILTER (WHERE p."level" = 'BEGINNER')::int AS beginner
      FROM "PullRequest" p ${prJoins}
      WHERE p."seasonId" = ${query.seasonId} AND p."scoreStatus" = 'SCORED' AND p."authorId" IS NOT NULL
        AND p."mergedAt" >= ${since} AND p."mergedAt" <= ${query.now}
        ${joinAll(prFilters)}
      GROUP BY 1, 2
    ),
    joined AS (
      SELECT t.partition, t.id, t.points, t.reached_at,
             COALESCE(l.advanced, 0) AS advanced,
             COALESCE(l.intermediate, 0) AS intermediate,
             COALESCE(l.beginner, 0) AS beginner
      FROM totals t LEFT JOIN levels l ON l.partition = t.partition AND l.id = t.id
      WHERE t.points > 0
    )
    SELECT *, ROW_NUMBER() OVER (PARTITION BY partition ${ORDER}) AS rank
    FROM joined
    ORDER BY partition, rank
  `;
  return rows.map(toRow);
}

/** Mentor board: mentor points, then reached first, then id. Mentor entries have no levels. */
async function mentorRows(seasonId: string, now: Date, users?: string[]): Promise<RankedRow[]> {
  if (users && users.length === 0) return [];
  const rows = await prisma.$queryRaw<RawRow[]>`
    WITH joined AS (
      SELECT '' AS partition, m."userId" AS id, SUM(m."points")::int AS points,
             MAX(m."createdAt") AS reached_at, 0 AS advanced, 0 AS intermediate, 0 AS beginner
      FROM "MentorPointEvent" m
      WHERE m."seasonId" = ${seasonId} AND m."createdAt" <= ${now}
        ${users ? Prisma.sql`AND m."userId" IN (${Prisma.join(users)})` : Prisma.empty}
      GROUP BY m."userId"
      HAVING SUM(m."points") > 0
    )
    SELECT *, ROW_NUMBER() OVER (${ORDER}) AS rank FROM joined ORDER BY rank
  `;
  return rows.map(toRow);
}

/**
 * The colleges board: each college's ranked members added up (points and PR counts), reached at
 * its latest member's total. Ranked by the same rule as everything else, the id being the college.
 */
export function aggregateColleges(members: RankedRow[]): RankedRow[] {
  const byCollege = new Map<string, Standing>();
  for (const row of members) {
    const college = byCollege.get(row.partition) ?? {
      id: row.partition,
      points: 0,
      advanced: 0,
      intermediate: 0,
      beginner: 0,
      reachedAt: new Date(0),
    };
    college.points += row.points;
    college.advanced += row.advanced;
    college.intermediate += row.intermediate;
    college.beginner += row.beginner;
    if (row.reachedAt > college.reachedAt) college.reachedAt = row.reachedAt;
    byCollege.set(row.partition, college);
  }
  return [...byCollege.values()]
    .filter((college) => college.points > 0)
    .sort(compareStandings)
    .map((college, index) => ({ ...college, partition: "", rank: index + 1 }));
}

/** Monday 00:00 IST of a week named "YYYY-MM-DD", and the end of that week. */
export function weekRange(week: string) {
  const start = new Date(Date.parse(`${week}T00:00:00.000Z`) - 330 * 60_000);
  return { start, end: new Date(start.getTime() + 7 * DAY_MS - 1) };
}

/** Every entry of one board, ranked, as of `now`. */
export async function boardRowsSql(
  seasonId: string,
  board: BoardRef,
  now: Date,
  users?: string[],
): Promise<RankedRow[]> {
  switch (board.family) {
    case "overall":
      return contributorRows({ seasonId, now, partitionBy: "none", users });
    case "weekly": {
      const { start, end } = weekRange(board.week);
      return contributorRows({
        seasonId,
        now: end < now ? end : now,
        from: start,
        partitionBy: "none",
        users,
      });
    }
    case "project":
      return contributorRows({ seasonId, now, partitionBy: "project", partition: board.projectId, users });
    case "college":
      return contributorRows({ seasonId, now, partitionBy: "college", partition: board.collegeId, users });
    case "colleges": {
      const members = await contributorRows({ seasonId, now, partitionBy: "college" });
      const colleges = aggregateColleges(members);
      return users ? colleges.filter((row) => users.includes(row.id)) : colleges;
    }
    case "mentors":
      return mentorRows(seasonId, now, users);
  }
}

/** One college's row on the colleges board (null when it has no ranked members). */
export async function collegeTotalSql(seasonId: string, collegeId: string, now: Date) {
  const members = await contributorRows({ seasonId, now, partitionBy: "college", partition: collegeId });
  return aggregateColleges(members)[0] ?? null;
}

/** Every per-project and per-college board at once, for snapshots. */
export async function partitionedRowsSql(seasonId: string, partitionBy: "project" | "college", now: Date) {
  return contributorRows({ seasonId, now, partitionBy });
}

/** The projects a user has ledger entries on this season (their per-project boards). */
export async function projectsOfUser(seasonId: string, userId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ projectId: string }[]>`
    SELECT DISTINCT r."projectId"
    FROM "ScoreEvent" e
    JOIN "PullRequest" p ON p."id" = e."pullRequestId"
    JOIN "ProjectRepo" r ON r."id" = p."repoId"
    WHERE e."seasonId" = ${seasonId} AND e."userId" = ${userId}
  `;
  return rows.map((row) => row.projectId);
}
