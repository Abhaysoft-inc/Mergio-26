import "server-only";
import { prisma } from "@repo/db";
import { LEVEL_NAMES, programLabels, type Level } from "@repo/scoring";
import { seasonRules, type SeasonInfo } from "./contributor";
import { mentorInviteUrl, mentorState } from "./mentor-service";
import { LABELLING_ROLES } from "./mentoring";

// The project admin view (F-10): repo health, mentors, contributors and PR stats for one project.

/** The project, if the viewer runs it (or is an organizer). */
export async function adminProject(slug: string, season: SeasonInfo, viewer: { id: string; isAdmin?: boolean | null }) {
  const project = await prisma.project.findUnique({
    where: { seasonId_slug: { seasonId: season.id, slug } },
  });
  if (!project || (project.ownerId !== viewer.id && viewer.isAdmin !== true)) return null;
  return project;
}

export async function projectAdminView(projectId: string, season: SeasonInfo) {
  const rules = seasonRules(season);
  const [repos, mentors, prs] = await Promise.all([
    prisma.projectRepo.findMany({
      where: { projectId, removedAt: null },
      orderBy: { createdAt: "asc" },
    }),
    prisma.projectMentor.findMany({
      where: { projectId },
      orderBy: { createdAt: "asc" },
      include: {
        user: {
          select: {
            name: true,
            githubLogin: true,
            image: true,
            registrations: { where: { role: "MENTOR" }, select: { status: true } },
          },
        },
      },
    }),
    prisma.pullRequest.findMany({
      where: { seasonId: season.id, repo: { projectId } },
      select: {
        id: true,
        number: true,
        title: true,
        url: true,
        state: true,
        scoreStatus: true,
        level: true,
        points: true,
        authorId: true,
        authorLogin: true,
        mergedAt: true,
        githubUpdatedAt: true,
        repo: { select: { owner: true, name: true } },
      },
    }),
  ]);

  const labelNames = programLabels(rules).map((label) => label.name);
  const repoHealth = repos.map((repo) => ({
    id: repo.id,
    fullName: `${repo.owner}/${repo.name}`,
    approval: repo.approval,
    trackingStatus: repo.trackingStatus,
    // Null until the GitHub App has looked at the repo's labels.
    missingLabels: repo.labelsCheckedAt ? repo.missingLabels : null,
    labelsCheckedAt: repo.labelsCheckedAt,
    lastSyncedAt: repo.lastSyncedAt,
  }));

  const mentorRows = mentors.map((mentor) => {
    const state = mentorState(mentor.userId, mentor.user?.registrations[0]);
    const access = (mentor.repoAccess ?? {}) as Record<string, string>;
    return {
      id: mentor.id,
      githubLogin: mentor.user?.githubLogin ?? mentor.githubLogin,
      name: mentor.user?.name ?? null,
      image: mentor.user?.image ?? null,
      state,
      // Repos where they can't label yet (below triage). Null until checked.
      cannotLabel: mentor.accessCheckedAt
        ? Object.entries(access)
            .filter(([, role]) => !LABELLING_ROLES.has(role))
            .map(([repo]) => repo)
        : null,
    };
  });

  // PR stats.
  const count = (status: string) => prs.filter((pr) => pr.scoreStatus === status).length;
  const scored = prs.filter((pr) => pr.scoreStatus === "SCORED");
  const byLevel = (Object.keys(LEVEL_NAMES) as Level[]).map((level) => ({
    level,
    name: LEVEL_NAMES[level],
    count: scored.filter((pr) => pr.level === level).length,
  }));
  const stats = {
    total: prs.length,
    open: count("OPEN"),
    merged: prs.filter((pr) => pr.state === "MERGED").length,
    scored: scored.length,
    awaitingLabel: count("AWAITING_LABEL"),
    notEligible: count("NOT_ELIGIBLE"),
    invalidated: count("INVALIDATED"),
    points: scored.reduce((sum, pr) => sum + pr.points, 0),
    byLevel,
  };

  // Contributors: everyone with a PR here, most points first.
  const people = new Map<string, { login: string; prs: number; scored: number; points: number; registered: boolean }>();
  for (const pr of prs) {
    const key = pr.authorLogin.toLowerCase();
    const row = people.get(key) ?? { login: pr.authorLogin, prs: 0, scored: 0, points: 0, registered: false };
    row.prs++;
    if (pr.scoreStatus === "SCORED") {
      row.scored++;
      row.points += pr.points;
    }
    row.registered ||= pr.authorId !== null;
    people.set(key, row);
  }
  const contributors = [...people.values()].sort((a, b) => b.points - a.points || b.prs - a.prs);

  const recent = [...prs]
    .sort((a, b) => b.githubUpdatedAt.getTime() - a.githubUpdatedAt.getTime())
    .slice(0, 10)
    .map((pr) => ({
      id: pr.id,
      number: pr.number,
      title: pr.title,
      url: pr.url,
      repo: `${pr.repo.owner}/${pr.repo.name}`,
      authorLogin: pr.authorLogin,
      status: pr.scoreStatus,
      levelName: pr.level ? LEVEL_NAMES[pr.level] : null,
      points: pr.points,
    }));

  return {
    repos: repoHealth,
    labelNames,
    mentors: mentorRows,
    activeMentors: mentorRows.filter((mentor) => mentor.state === "ACTIVE").length,
    inviteUrl: mentorInviteUrl(),
    stats,
    contributors,
    recent,
  };
}

export type ProjectAdminView = Awaited<ReturnType<typeof projectAdminView>>;
