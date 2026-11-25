import { prisma } from "@repo/db";
import { resolveRules } from "@repo/scoring";
import { installationToken, repoInstallationId, restGet } from "../github/client";

// Finding our row for a GitHub repo, and a token to read it with.

export const trackedRepoInclude = {
  project: { include: { season: true } },
} as const;

/**
 * The repo row for a GitHub repo in the active season: accepted, not removed rows first. Null
 * when no project of the active season lists the repo (then its events are ignored).
 *
 * Two projects can list the same GitHub repo. A PR is stored under one row and stays there: pass
 * `prNumber` when syncing a PR and the row that already holds it wins, so a change in which row
 * is "best" (the first project removes the repo, the second is approved) can't store the PR a
 * second time under the other row and count its points twice.
 */
export async function findRepo(githubRepoId: bigint, prNumber?: number) {
  const rows = await prisma.projectRepo.findMany({
    where: { githubRepoId, project: { season: { isActive: true } } },
    include: trackedRepoInclude,
    orderBy: { createdAt: "asc" },
  });
  if (rows.length > 1 && prNumber !== undefined) {
    const holder = await prisma.pullRequest.findFirst({
      where: { repoId: { in: rows.map((row) => row.id) }, number: prNumber },
      select: { repoId: true },
    });
    const row = rows.find((candidate) => candidate.id === holder?.repoId);
    if (row) return row;
  }
  const score = (row: (typeof rows)[number]) =>
    (row.approval === "APPROVED" ? 2 : 0) + (row.removedAt ? 0 : 1);
  return rows.sort((a, b) => score(b) - score(a))[0] ?? null;
}

export type RepoRow = NonNullable<Awaited<ReturnType<typeof findRepo>>>;

export const rulesOf = (repo: RepoRow) => resolveRules(repo.project.season.scoringRules);

/**
 * An installation token for the repo. Looks the installation up (and records it) when the
 * installation webhook was missed. Null when the app isn't installed on the repo.
 */
export async function tokenFor(repo: RepoRow) {
  let installationId = repo.installationId;
  if (!installationId) {
    installationId = await repoInstallationId(repo.owner, repo.name);
    if (!installationId) return null;
    await prisma.projectRepo.updateMany({
      where: { githubRepoId: repo.githubRepoId },
      data: { installationId, trackingStatus: "ACTIVE" },
    });
  }
  return installationToken(installationId);
}

type RepoResponse = {
  id: number;
  name: string;
  owner: { login: string };
  default_branch: string;
  archived: boolean;
};

/** Refreshes owner, name and default branch from GitHub (after a rename or transfer). */
export async function refreshRepoDetails(repo: RepoRow, token: string) {
  const data = await restGet<RepoResponse>(`/repositories/${repo.githubRepoId}`, token);
  if (!data) return null;
  await prisma.projectRepo.updateMany({
    where: { githubRepoId: repo.githubRepoId },
    data: { owner: data.owner.login, name: data.name, defaultBranch: data.default_branch },
  });
  return { ...repo, owner: data.owner.login, name: data.name, defaultBranch: data.default_branch };
}
