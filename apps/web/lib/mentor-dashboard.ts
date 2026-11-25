import "server-only";
import { prisma, type Prisma } from "@repo/db";
import { LEVEL_NAMES, normaliseLabel, type ScoringRules } from "@repo/scoring";
import { projectStaffIds, staffProjectsOf } from "@repo/scoring/server";
import { seasonRules, type SeasonInfo } from "./contributor";
import { LABELLING_ROLES } from "./mentoring";

// The mentor view (F-10): the projects someone mentors (or runs), PRs waiting for a level label,
// recent scored PRs and their mentor points. Project admins see it for their projects too.

/** Approved projects the user mentors or runs this season. */
export async function mentoredProjects(userId: string, season: SeasonInfo) {
  return (await staffProjectsOf(userId, season.id)).filter((project) => project.status === "APPROVED");
}

const queueInclude = {
  repo: { select: { owner: true, name: true, project: { select: { slug: true, name: true } } } },
  flags: { where: { status: "OPEN" }, select: { reporterId: true } },
} satisfies Prisma.PullRequestInclude;

type QueueRow = Prisma.PullRequestGetPayload<{ include: typeof queueInclude }>;

/** What label the PR still needs, in mentor terms. */
function missingLabel(pr: QueueRow, rules: ScoringRules) {
  if (pr.scoreReason === "MULTIPLE_LEVEL_LABELS") return "Keep just one level label";
  const labels = new Set([...pr.labels, ...pr.linkedIssueLabels].map(normaliseLabel));
  if (!labels.has(normaliseLabel(rules.labels.program))) return `Add "${rules.labels.program}" and a level label`;
  return "Add a level label";
}

function presentQueued(pr: QueueRow, rules: ScoringRules, viewerId: string) {
  return {
    id: pr.id,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    repo: `${pr.repo.owner}/${pr.repo.name}`,
    project: pr.repo.project,
    authorLogin: pr.authorLogin,
    mergedAt: pr.mergedAt,
    labelDeadline: pr.labelDeadline,
    // Merged in the last 72 hours with no level label: scoring is still waiting on a mentor.
    urgent: pr.scoreStatus === "AWAITING_LABEL",
    action: missingLabel(pr, rules),
    flaggedByYou: pr.flags.some((flag) => flag.reporterId === viewerId),
  };
}

/**
 * Merged PRs on the user's projects that need a mentor's label. Urgent first (still inside the
 * grace window, soonest deadline first), then ones past it: a label added late still scores them.
 */
export async function mentorQueue(userId: string, season: SeasonInfo, take = 50) {
  const projects = await mentoredProjects(userId, season);
  const projectIds = projects.map((project) => project.id);
  if (projectIds.length === 0) return { projects, pullRequests: [] };
  const rules = seasonRules(season);
  const base = { seasonId: season.id, repo: { projectId: { in: projectIds } } } satisfies Prisma.PullRequestWhereInput;
  const [urgent, overdue] = await Promise.all([
    prisma.pullRequest.findMany({
      where: { ...base, scoreStatus: "AWAITING_LABEL" },
      orderBy: { labelDeadline: "asc" },
      include: queueInclude,
      take,
    }),
    prisma.pullRequest.findMany({
      where: {
        ...base,
        scoreStatus: "NOT_ELIGIBLE",
        scoreReason: { in: ["NO_LEVEL_LABEL", "NO_PROGRAM_LABEL", "MULTIPLE_LEVEL_LABELS"] },
      },
      orderBy: { mergedAt: "desc" },
      include: queueInclude,
      take,
    }),
  ]);
  return {
    projects,
    pullRequests: [...urgent, ...overdue].slice(0, take).map((pr) => presentQueued(pr, rules, userId)),
  };
}

export type QueuedPullRequest = Awaited<ReturnType<typeof mentorQueue>>["pullRequests"][number];

export async function mentorOverview(userId: string, season: SeasonInfo) {
  const { projects, pullRequests: queue } = await mentorQueue(userId, season);
  const projectIds = projects.map((project) => project.id);

  const [recent, points, ledger, attachments] = await Promise.all([
    prisma.pullRequest.findMany({
      where: { seasonId: season.id, repo: { projectId: { in: projectIds } }, scoreStatus: "SCORED" },
      orderBy: { scoredAt: "desc" },
      take: 10,
      include: queueInclude,
    }),
    prisma.mentorPointEvent.aggregate({
      where: { seasonId: season.id, userId },
      _sum: { points: true },
    }),
    prisma.mentorPointEvent.findMany({
      where: { seasonId: season.id, userId },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: {
        pullRequest: { select: { number: true, title: true, url: true, repo: { select: { owner: true, name: true } } } },
      },
    }),
    prisma.projectMentor.findMany({
      where: { userId, projectId: { in: projectIds } },
      select: { repoAccess: true, accessCheckedAt: true, project: { select: { name: true } } },
    }),
  ]);

  // Repos where the mentor's GitHub role can't apply labels.
  const accessWarnings = attachments.flatMap((attachment) =>
    Object.entries((attachment.repoAccess ?? {}) as Record<string, string>)
      .filter(([, role]) => !LABELLING_ROLES.has(role))
      .map(([repo, role]) => ({ project: attachment.project.name, repo, role })),
  );

  return {
    projects,
    queue,
    urgentCount: queue.filter((pr) => pr.urgent).length,
    recentScored: recent.map((pr) => ({
      id: pr.id,
      number: pr.number,
      title: pr.title,
      url: pr.url,
      repo: `${pr.repo.owner}/${pr.repo.name}`,
      project: pr.repo.project,
      authorLogin: pr.authorLogin,
      levelName: pr.level ? LEVEL_NAMES[pr.level] : null,
      points: pr.points,
      scoredAt: pr.scoredAt,
      flaggedByYou: pr.flags.some((flag) => flag.reporterId === userId),
    })),
    mentorPoints: points._sum.points ?? 0,
    ledger: ledger.map((entry) => ({
      id: entry.id,
      points: entry.points,
      description: entry.description,
      createdAt: entry.createdAt,
      pullRequest: entry.pullRequest
        ? {
            number: entry.pullRequest.number,
            title: entry.pullRequest.title,
            url: entry.pullRequest.url,
            repo: `${entry.pullRequest.repo.owner}/${entry.pullRequest.repo.name}`,
          }
        : null,
    })),
    accessWarnings,
  };
}

/** One PR on a project the user is staff of, for the flag form; null otherwise. */
export async function flaggablePullRequest(userId: string, isAdmin: boolean, pullRequestId: string) {
  const pr = await prisma.pullRequest.findUnique({
    where: { id: pullRequestId },
    include: {
      repo: { select: { owner: true, name: true, project: { select: { id: true, name: true, ownerId: true } } } },
    },
  });
  if (!pr) return null;
  if (!isAdmin && !(await projectStaffIds(pr.repo.project.id)).has(userId)) return null;
  return pr;
}
