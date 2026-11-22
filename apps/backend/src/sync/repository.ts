import { prisma } from "@repo/db";
import { programLabels } from "@repo/scoring";
import { enqueueJobs } from "@repo/scoring/server";
import { installationToken, restGet, restList, restPost } from "../github/client";
import { upsertIssue, type IssueResponse } from "./issue";
import { findRepo, refreshRepoDetails, rulesOf, tokenFor, type RepoRow } from "./repos";

// Whole-repo work: installation, reconciliation and repository events.

const DAY_MS = 86_400_000;

/**
 * Creates the program labels the repo is missing (needs the Issues: write permission) and
 * records any that still couldn't be created, for the project admin's repo health.
 */
export async function ensureLabels(repo: RepoRow, token: string) {
  const existing = await restList<{ name: string }>(
    `/repos/${repo.owner}/${repo.name}/labels?per_page=100`,
    token,
    { maxPages: 5 },
  );
  const have = new Set(existing.map((label) => label.name.toLowerCase()));
  const missing: string[] = [];
  for (const label of programLabels(rulesOf(repo))) {
    if (have.has(label.name.toLowerCase())) continue;
    const response = await restPost(`/repos/${repo.owner}/${repo.name}/labels`, token, label);
    // 422: it exists already (created meanwhile). Anything else leaves it missing.
    if (!response.ok && response.status !== 422) {
      console.warn(`Couldn't create label "${label.name}" on ${repo.owner}/${repo.name}: ${response.status}`);
      missing.push(label.name);
    }
  }
  await prisma.projectRepo.updateMany({
    where: { githubRepoId: repo.githubRepoId },
    data: { missingLabels: missing, labelsCheckedAt: new Date() },
  });
}

/**
 * Reconciliation (nightly, after install, or on demand): queues a refetch of every PR updated
 * since the last sync (with a day of overlap) and refreshes program issues. Recovers anything a
 * webhook outage missed; scoring is idempotent, so seeing a PR twice never double counts.
 */
export async function resyncRepo(githubRepoId: bigint) {
  let repo = await findRepo(githubRepoId);
  if (!repo) return;
  const token = await tokenFor(repo);
  if (!token) return;
  repo = (await refreshRepoDetails(repo, token)) ?? repo;

  const startedAt = new Date();
  const season = repo.project.season;
  try {
    await ensureLabels(repo, token);
  } catch (error) {
    console.warn(`Label check failed for ${repo.owner}/${repo.name}`, error);
  }
  // First sync: everything since the window opened (or the last 60 days if it isn't set yet).
  const since = repo.lastSyncedAt
    ? new Date(repo.lastSyncedAt.getTime() - DAY_MS)
    : new Date((season.codingStartsAt?.getTime() ?? Date.now()) - 60 * DAY_MS);

  type PullSummary = { number: number; updated_at: string };
  const pulls = await restList<PullSummary>(
    `/repos/${repo.owner}/${repo.name}/pulls?state=all&sort=updated&direction=desc&per_page=100`,
    token,
    { maxPages: 30, stop: (page) => page.some((pr) => new Date(pr.updated_at) < since) },
  );
  await enqueueJobs(
    pulls
      .filter((pr) => new Date(pr.updated_at) >= since)
      .map((pr) => ({
        kind: "PULL_REQUEST" as const,
        payload: { githubRepoId: githubRepoId.toString(), number: pr.number },
      })),
  );

  const label = encodeURIComponent(rulesOf(repo).labels.program);
  const issues = await restList<IssueResponse>(
    `/repos/${repo.owner}/${repo.name}/issues?labels=${label}&state=all&since=${since.toISOString()}&per_page=100`,
    token,
    { maxPages: 30 },
  );
  for (const issue of issues) await upsertIssue(repo, issue);

  await prisma.projectRepo.updateMany({
    where: { githubRepoId },
    data: { lastSyncedAt: startedAt },
  });
}

/** installation and installation_repositories events. */
export async function syncInstallation(
  installationId: bigint,
  action: string,
  githubRepoIds: bigint[],
) {
  // Earned points stay when tracking stops; only future scoring stops until the app is back.
  if (action === "removed") {
    // Repos taken out of an installation that stays.
    await prisma.projectRepo.updateMany({
      where: { githubRepoId: { in: githubRepoIds } },
      data: { trackingStatus: "SUSPENDED" },
    });
    return;
  }
  if (action === "deleted" || action === "suspend") {
    await prisma.projectRepo.updateMany({
      where: { OR: [{ installationId }, { githubRepoId: { in: githubRepoIds } }] },
      data: { trackingStatus: "SUSPENDED" },
    });
    return;
  }

  // created, unsuspend, new_permissions_accepted, added: list what the installation covers.
  const token = await installationToken(installationId);
  const repos = await restList<{ id: number }>(
    "/installation/repositories?per_page=100",
    token,
    { maxPages: 20, pick: (body) => (body as { repositories: { id: number }[] }).repositories },
  );
  const ids = repos.map((repo) => BigInt(repo.id));
  if (ids.length === 0) return;
  await prisma.projectRepo.updateMany({
    where: { githubRepoId: { in: ids } },
    data: { installationId, trackingStatus: "ACTIVE" },
  });

  const ours = await prisma.projectRepo.findMany({
    where: { githubRepoId: { in: ids }, project: { season: { isActive: true } } },
    select: { githubRepoId: true },
    distinct: ["githubRepoId"],
  });
  for (const { githubRepoId } of ours) {
    const repo = await findRepo(githubRepoId);
    if (repo) {
      try {
        await ensureLabels(repo, token);
      } catch (error) {
        console.warn(`Label setup failed for ${repo.owner}/${repo.name}`, error);
      }
    }
  }
  await enqueueJobs(
    ours.map(({ githubRepoId }) => ({
      kind: "REPO_RESYNC" as const,
      payload: { githubRepoId: githubRepoId.toString() },
    })),
  );
}

/** repository events: renamed, transferred, archived, deleted... */
export async function syncRepository(githubRepoId: bigint, action: string) {
  if (action === "deleted") {
    await prisma.projectRepo.updateMany({
      where: { githubRepoId },
      data: { trackingStatus: "SUSPENDED" },
    });
    return;
  }
  const repo = await findRepo(githubRepoId);
  if (!repo) return;
  const token = await tokenFor(repo);
  if (!token) return;
  const refreshed = await restGet(`/repositories/${githubRepoId}`, token);
  if (!refreshed) {
    await prisma.projectRepo.updateMany({
      where: { githubRepoId },
      data: { trackingStatus: "SUSPENDED" },
    });
    return;
  }
  await refreshRepoDetails(repo, token);
}
