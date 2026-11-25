import { prisma, type PrLevel } from "@repo/db";
import { LEVELS, normaliseLabel, type ScoringRules } from "@repo/scoring";
import { enqueueJobs } from "@repo/scoring/server";
import { restGet } from "../github/client";
import { findRepo, rulesOf, tokenFor, type RepoRow } from "./repos";

// Program issues (F-09): open issues with the program label on tracked repos, for discovery and
// the dashboard's recommendations. An issue that loses the label leaves the list.

export type IssueResponse = {
  id: number;
  number: number;
  title: string;
  html_url: string;
  state: "open" | "closed";
  labels: ({ name?: string } | string)[];
  assignees?: unknown[];
  created_at: string;
  updated_at: string;
  pull_request?: unknown;
};

const labelNames = (issue: IssueResponse) =>
  issue.labels.flatMap((label) => {
    const name = typeof label === "string" ? label : label.name;
    return name ? [name] : [];
  });

function levelOf(labels: string[], rules: ScoringRules): PrLevel | null {
  const names = new Set(labels.map(normaliseLabel));
  const found = LEVELS.filter((level) => names.has(normaliseLabel(rules.labels.levels[level])));
  return found.length === 1 ? found[0]! : null;
}

/** Stores (or drops) one issue from a REST payload. */
export async function upsertIssue(repo: RepoRow, issue: IssueResponse) {
  if (issue.pull_request) return;
  const rules = rulesOf(repo);
  const labels = labelNames(issue);
  const programLabel = normaliseLabel(rules.labels.program);
  if (!labels.some((label) => normaliseLabel(label) === programLabel)) {
    await prisma.programIssue.deleteMany({ where: { repoId: repo.id, number: issue.number } });
    return;
  }
  const fields = {
    githubId: BigInt(issue.id),
    title: issue.title,
    url: issue.html_url,
    state: issue.state === "open" ? ("OPEN" as const) : ("CLOSED" as const),
    labels,
    level: levelOf(labels, rules),
    assigneeCount: issue.assignees?.length ?? 0,
    githubCreatedAt: new Date(issue.created_at),
    githubUpdatedAt: new Date(issue.updated_at),
    lastSyncedAt: new Date(),
  };
  await prisma.programIssue.upsert({
    where: { repoId_number: { repoId: repo.id, number: issue.number } },
    create: { repoId: repo.id, number: issue.number, ...fields },
    update: fields,
  });
}

export async function syncIssue(githubRepoId: bigint, number: number) {
  const repo = await findRepo(githubRepoId);
  if (!repo) return;
  const token = await tokenFor(repo);
  if (!token) return;
  const issue = await restGet<IssueResponse>(
    `/repositories/${githubRepoId}/issues/${number}`,
    token,
  );
  if (!issue) {
    await prisma.programIssue.deleteMany({ where: { repoId: repo.id, number } });
  } else {
    await upsertIssue(repo, issue);
  }

  // PRs that close this issue take their level from it when they have none: rescore them.
  const linked = await prisma.pullRequest.findMany({
    where: { repoId: repo.id, linkedIssueNumbers: { has: number } },
    select: { number: true },
  });
  await enqueueJobs(
    linked.map((pr) => ({
      kind: "PULL_REQUEST" as const,
      payload: { githubRepoId: githubRepoId.toString(), number: pr.number },
    })),
  );
}
