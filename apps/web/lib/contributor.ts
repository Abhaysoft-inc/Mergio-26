import "server-only";
import { prisma, type Prisma, type PrLevel, type PrScoreStatus } from "@repo/db";
import {
  BADGES,
  LEVEL_NAMES,
  nextBadge,
  reasonText,
  reasonTitle,
  resolveRules,
  type ReasonCode,
  type ScoringRules,
} from "@repo/scoring";
import { badgeStatsOf, standingOf } from "@repo/scoring/server";
import { activeSeason } from "./projects-server";

// The contributor dashboard's data (F-10): stats, PRs, the points ledger and recommendations.
// Shared by the dashboard pages and the /api/v1/me endpoints so both always agree.

const DAY_MS = 86_400_000;

export type SeasonInfo = NonNullable<Awaited<ReturnType<typeof activeSeason>>>;

export const seasonRules = (season: SeasonInfo) => resolveRules(season.scoringRules);

/** Whether the user holds an approved contributor registration. */
export async function isContributor(userId: string) {
  return Boolean(
    await prisma.registration.findFirst({
      where: { userId, role: "CONTRIBUTOR", status: "APPROVED" },
      select: { id: true },
    }),
  );
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export async function contributorStats(userId: string, season: SeasonInfo, now = new Date()) {
  const [standing, earned, counts] = await Promise.all([
    standingOf(season.id, userId, now),
    prisma.userBadge.findMany({
      where: { userId, seasonId: season.id },
      orderBy: { earnedAt: "asc" },
      include: { badge: true },
    }),
    prisma.pullRequest.groupBy({
      by: ["scoreStatus"],
      where: { authorId: userId, seasonId: season.id },
      _count: { _all: true },
    }),
  ]);
  const badgeStats = await badgeStatsOf(season.id, userId, standing.rank);
  const progress = nextBadge(badgeStats, new Set(earned.map((badge) => badge.badgeKey)));
  const byStatus = Object.fromEntries(counts.map((row) => [row.scoreStatus, row._count._all]));

  return {
    season: { slug: season.slug, name: season.name },
    points: standing.points,
    heldPoints: standing.heldPoints,
    rank: standing.rank,
    rankedContributors: standing.rankedContributors,
    weeklyPoints: standing.weeklyPoints,
    weeklyRank: standing.weeklyRank,
    weekStart: standing.weekStart,
    pullRequests: {
      scored: badgeStats.scoredPrs,
      advanced: badgeStats.advancedPrs,
      open: byStatus.OPEN ?? 0,
      awaitingLabel: byStatus.AWAITING_LABEL ?? 0,
      notEligible: byStatus.NOT_ELIGIBLE ?? 0,
      invalidated: byStatus.INVALIDATED ?? 0,
    },
    badges: earned.map((award) => ({
      key: award.badgeKey,
      name: award.badge.name,
      description: award.badge.description,
      earnedAt: award.earnedAt,
    })),
    nextBadge: progress
      ? {
          key: progress.badge.key,
          name: progress.badge.name,
          description: progress.badge.description,
          current: progress.current,
          target: progress.target,
        }
      : null,
    totalBadges: BADGES.length,
  };
}

export type ContributorStats = Awaited<ReturnType<typeof contributorStats>>;

// ---------------------------------------------------------------------------
// Pull requests
// ---------------------------------------------------------------------------

/** The dashboard's four PR states (F-10), plus the in-between ones. */
export const PR_FILTERS = {
  open: { label: "Open", statuses: ["OPEN"] },
  scored: { label: "Scored", statuses: ["SCORED"] },
  awaiting: { label: "Awaiting label", statuses: ["AWAITING_LABEL"] },
  "not-eligible": { label: "Not eligible", statuses: ["NOT_ELIGIBLE"] },
  invalidated: { label: "Invalidated", statuses: ["INVALIDATED"] },
  closed: { label: "Closed", statuses: ["CLOSED"] },
} as const satisfies Record<string, { label: string; statuses: PrScoreStatus[] }>;
export type PrFilter = keyof typeof PR_FILTERS;

export const LEVEL_FILTERS = {
  beginner: "BEGINNER",
  intermediate: "INTERMEDIATE",
  advanced: "ADVANCED",
} as const satisfies Record<string, PrLevel>;
export type LevelFilter = keyof typeof LEVEL_FILTERS;

export const parsePrFilter = (value: string | null | undefined) =>
  value && value in PR_FILTERS ? (value as PrFilter) : null;
export const parseLevelFilter = (value: string | null | undefined) =>
  value && value in LEVEL_FILTERS ? (value as LevelFilter) : null;

const prInclude = {
  repo: {
    select: {
      owner: true,
      name: true,
      project: { select: { id: true, slug: true, name: true } },
    },
  },
  disputes: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { id: true, status: true, createdAt: true },
  },
  scoreEvents: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { createdAt: true },
  },
} satisfies Prisma.PullRequestInclude;

type PrRow = Prisma.PullRequestGetPayload<{ include: typeof prInclude }>;

export type StatusTone = "muted" | "ice" | "gold" | "green" | "red";

function statusDisplay(pr: PrRow): { label: string; tone: StatusTone } {
  switch (pr.scoreStatus) {
    case "OPEN":
      return { label: pr.isDraft ? "Draft" : "Open", tone: "ice" };
    case "CLOSED":
      return { label: "Closed", tone: "muted" };
    case "AWAITING_LABEL":
      return { label: "Merged · awaiting label", tone: "gold" };
    case "SCORED":
      return { label: "Merged · scored", tone: "green" };
    case "NOT_ELIGIBLE":
      return { label: "Merged · not eligible", tone: "red" };
    case "INVALIDATED":
      return { label: "Invalidated", tone: "red" };
  }
}

/**
 * Whether the contributor may dispute the PR now: it merged, nothing is under review for it, and
 * it is within the dispute window from the merge or its latest score change.
 */
function disputeWindow(pr: PrRow, rules: ScoringRules, now: Date) {
  const open = pr.disputes[0] && ["OPEN", "IN_REVIEW"].includes(pr.disputes[0].status);
  if (!pr.mergedAt || pr.scoreStatus === "AWAITING_LABEL" || open) {
    return { canDispute: false, disputeUntil: null };
  }
  const anchor = Math.max(pr.mergedAt.getTime(), pr.scoreEvents[0]?.createdAt.getTime() ?? 0);
  const until = new Date(anchor + rules.disputeWindowDays * DAY_MS);
  return { canDispute: now < until, disputeUntil: until };
}

export function presentPullRequest(pr: PrRow, rules: ScoringRules, now = new Date()) {
  const reason = pr.scoreReason as ReasonCode | null;
  const dispute = pr.disputes[0] ?? null;
  return {
    id: pr.id,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    repo: `${pr.repo.owner}/${pr.repo.name}`,
    project: pr.repo.project,
    state: pr.state,
    status: pr.scoreStatus,
    display: statusDisplay(pr),
    level: pr.level,
    levelName: pr.level ? LEVEL_NAMES[pr.level] : null,
    points: pr.points,
    reason: reason
      ? { code: reason, title: reasonTitle(reason), text: reasonText(reason, rules) }
      : null,
    notes: pr.scoreNotes,
    labelDeadline: pr.labelDeadline,
    openedAt: pr.githubCreatedAt,
    mergedAt: pr.mergedAt,
    closedAt: pr.closedAt,
    dispute: dispute ? { id: dispute.id, status: dispute.status, createdAt: dispute.createdAt } : null,
    ...disputeWindow(pr, rules, now),
  };
}

export type PullRequestView = ReturnType<typeof presentPullRequest>;

export const PAGE_SIZE = 25;

export async function contributorPullRequests(
  userId: string,
  season: SeasonInfo,
  options: {
    status?: PrFilter | null;
    level?: LevelFilter | null;
    project?: string | null;
    page?: number;
    pageSize?: number;
  } = {},
) {
  const pageSize = options.pageSize ?? PAGE_SIZE;
  const page = Math.max(1, options.page ?? 1);
  const where: Prisma.PullRequestWhereInput = {
    authorId: userId,
    seasonId: season.id,
    ...(options.status ? { scoreStatus: { in: [...PR_FILTERS[options.status].statuses] } } : {}),
    ...(options.level ? { level: LEVEL_FILTERS[options.level] } : {}),
    ...(options.project ? { repo: { project: { slug: options.project } } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.pullRequest.findMany({
      where,
      include: prInclude,
      // Latest activity first: merge time for merged PRs, otherwise when GitHub last updated it.
      orderBy: [{ githubUpdatedAt: "desc" }, { number: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.pullRequest.count({ where }),
  ]);
  const rules = seasonRules(season);
  const now = new Date();
  return {
    pullRequests: rows.map((row) => presentPullRequest(row, rules, now)),
    page,
    pageSize,
    total,
    pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Projects the contributor has PRs on, for the filter. */
export async function contributorProjects(userId: string, season: SeasonInfo) {
  return prisma.project.findMany({
    where: { seasonId: season.id, repos: { some: { pullRequests: { some: { authorId: userId } } } } },
    select: { slug: true, name: true },
    orderBy: { name: "asc" },
  });
}

/** One of the contributor's own PRs; null when it isn't theirs (no other user's PR leaks). */
export async function contributorPullRequest(userId: string, pullRequestId: string) {
  const row = await prisma.pullRequest.findFirst({
    where: { id: pullRequestId, authorId: userId },
    include: { ...prInclude, season: true },
  });
  if (!row) return null;
  return { pr: presentPullRequest(row, resolveRules(row.season.scoringRules)), seasonId: row.seasonId };
}

// ---------------------------------------------------------------------------
// Points ledger
// ---------------------------------------------------------------------------

export async function contributorLedger(
  userId: string,
  season: SeasonInfo,
  options: { page?: number; pageSize?: number } = {},
) {
  const pageSize = options.pageSize ?? PAGE_SIZE;
  const page = Math.max(1, options.page ?? 1);
  const where = { userId, seasonId: season.id };
  const [rows, total] = await Promise.all([
    prisma.scoreEvent.findMany({
      where,
      orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        pullRequest: {
          select: {
            id: true,
            number: true,
            title: true,
            url: true,
            repo: { select: { owner: true, name: true } },
          },
        },
      },
    }),
    prisma.scoreEvent.count({ where }),
  ]);
  const rules = seasonRules(season);
  const now = new Date();
  return {
    entries: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      ruleKey: row.ruleKey,
      points: row.points,
      level: row.level,
      description: row.description,
      reason: row.reason
        ? {
            code: row.reason,
            title: reasonTitle(row.reason as ReasonCode),
            text: reasonText(row.reason as ReasonCode, rules),
          }
        : null,
      effectiveAt: row.effectiveAt,
      // Held back by the daily cap: written already, counts from effectiveAt.
      held: row.effectiveAt > now,
      createdAt: row.createdAt,
      pullRequest: row.pullRequest
        ? {
            id: row.pullRequest.id,
            number: row.pullRequest.number,
            title: row.pullRequest.title,
            url: row.pullRequest.url,
            repo: `${row.pullRequest.repo.owner}/${row.pullRequest.repo.name}`,
          }
        : null,
    })),
    page,
    pageSize,
    total,
    pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

// ---------------------------------------------------------------------------
// Recommended issues
// ---------------------------------------------------------------------------

const LEVEL_ORDER: PrLevel[] = ["BEGINNER", "INTERMEDIATE", "ADVANCED"];

/**
 * The level to suggest next: beginner for newcomers, then one step up once the contributor has
 * two scored PRs at their current best level.
 */
function suggestedLevel(levels: (PrLevel | null)[]): PrLevel {
  const scored = levels.filter((level): level is PrLevel => level !== null);
  if (scored.length === 0) return "BEGINNER";
  const best = Math.max(...scored.map((level) => LEVEL_ORDER.indexOf(level)));
  const atBest = scored.filter((level) => LEVEL_ORDER.indexOf(level) === best).length;
  return LEVEL_ORDER[Math.min(best + (atBest >= 2 ? 1 : 0), LEVEL_ORDER.length - 1)]!;
}

/** Open, unassigned program issues on live, tracked repos, at the suggested level first. */
export async function recommendedIssues(userId: string, season: SeasonInfo, take = 5) {
  const scored = await prisma.pullRequest.findMany({
    where: { authorId: userId, seasonId: season.id, scoreStatus: "SCORED" },
    select: { level: true },
  });
  const level = suggestedLevel(scored.map((pr) => pr.level));
  const where: Prisma.ProgramIssueWhereInput = {
    state: "OPEN",
    assigneeCount: 0,
    repo: {
      approval: "APPROVED",
      removedAt: null,
      trackingStatus: "ACTIVE",
      project: {
        seasonId: season.id,
        status: "APPROVED",
        // Staff can't score on their own project, so don't suggest it.
        ownerId: { not: userId },
        mentors: { none: { userId } },
      },
    },
  };
  const select = {
    id: true,
    number: true,
    title: true,
    url: true,
    level: true,
    labels: true,
    githubCreatedAt: true,
    repo: { select: { owner: true, name: true, project: { select: { slug: true, name: true } } } },
  } satisfies Prisma.ProgramIssueSelect;

  const atLevel = await prisma.programIssue.findMany({
    where: { ...where, level },
    orderBy: { githubCreatedAt: "desc" },
    take,
    select,
  });
  const rest =
    atLevel.length < take
      ? await prisma.programIssue.findMany({
          where: { ...where, id: { notIn: atLevel.map((issue) => issue.id) }, level: { not: null } },
          orderBy: { githubCreatedAt: "desc" },
          take: take - atLevel.length,
          select,
        })
      : [];
  return {
    level,
    issues: [...atLevel, ...rest].map((issue) => ({
      id: issue.id,
      number: issue.number,
      title: issue.title,
      url: issue.url,
      level: issue.level,
      levelName: issue.level ? LEVEL_NAMES[issue.level] : null,
      points: issue.level ? seasonRules(season).points.levels[issue.level] : null,
      repo: `${issue.repo.owner}/${issue.repo.name}`,
      project: issue.repo.project,
      openedAt: issue.githubCreatedAt,
    })),
  };
}
