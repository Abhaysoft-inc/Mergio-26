import { prisma } from "@repo/db";
import { graphql, restList } from "../github/client";
import { scorePullRequest } from "../scoring/score-pr";
import { LEVELS, normaliseLabel, type ScoringRules } from "@repo/scoring";
import { findRepo, refreshRepoDetails, rulesOf, tokenFor, type RepoRow } from "./repos";

// Refetches one PR from GitHub (the webhook payload is only a hint), stores it, and scores it.

const PR_QUERY = /* GraphQL */ `
  query PullRequest($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      defaultBranchRef { name }
      pullRequest(number: $number) {
        databaseId
        number
        title
        url
        body
        state
        isDraft
        createdAt
        updatedAt
        mergedAt
        closedAt
        baseRefName
        additions
        deletions
        author { __typename login ... on User { databaseId } ... on Bot { databaseId } }
        mergedBy { __typename login ... on User { databaseId } ... on Bot { databaseId } }
        labels(first: 50) { nodes { name } }
        closingIssuesReferences(first: 10) {
          nodes {
            number
            repository { databaseId }
            labels(first: 30) { nodes { name } }
            timelineItems(last: 50, itemTypes: [LABELED_EVENT]) {
              nodes { ... on LabeledEvent { label { name } actor { ... on User { databaseId } } } }
            }
          }
        }
        reviews(first: 100, states: APPROVED) {
          nodes { author { ... on User { databaseId } } }
        }
        timelineItems(first: 100, itemTypes: [LABELED_EVENT, UNLABELED_EVENT]) {
          nodes {
            __typename
            ... on LabeledEvent { id createdAt label { name } actor { login } }
            ... on UnlabeledEvent { id createdAt label { name } actor { login } }
          }
        }
      }
    }
  }
`;

type Actor = { __typename: string; login: string; databaseId?: number | null } | null;
type LinkedIssue = {
  number: number;
  repository: { databaseId: number };
  labels: { nodes: { name: string }[] };
  timelineItems: {
    nodes: { label?: { name: string }; actor?: { databaseId?: number } | null }[];
  };
};
type PrData = {
  repository: {
    defaultBranchRef: { name: string } | null;
    pullRequest: {
      databaseId: number;
      number: number;
      title: string;
      url: string;
      body: string;
      state: "OPEN" | "CLOSED" | "MERGED";
      isDraft: boolean;
      createdAt: string;
      updatedAt: string;
      mergedAt: string | null;
      closedAt: string | null;
      baseRefName: string;
      additions: number;
      deletions: number;
      author: Actor;
      mergedBy: Actor;
      labels: { nodes: { name: string }[] };
      closingIssuesReferences: {
        nodes: LinkedIssue[];
      };
      reviews: { nodes: { author: { databaseId?: number } | null }[] };
      timelineItems: {
        nodes: {
          __typename: string;
          id?: string;
          createdAt?: string;
          label?: { name: string };
          actor?: { login: string } | null;
        }[];
      };
    } | null;
  } | null;
};

/**
 * Who labelled an issue, for mentor points: the latest person to add a level label still on it,
 * or else the program label.
 */
function labelerOf(issue: LinkedIssue, rules: ScoringRules) {
  const current = new Set(issue.labels.nodes.map((label) => normaliseLabel(label.name)));
  const levels = new Set(LEVELS.map((level) => normaliseLabel(rules.labels.levels[level])));
  const events = issue.timelineItems.nodes.filter(
    (event) => event.label && current.has(normaliseLabel(event.label.name)) && event.actor?.databaseId,
  );
  const pick = (wanted: (name: string) => boolean) =>
    events.filter((event) => wanted(normaliseLabel(event.label!.name))).at(-1)?.actor?.databaseId;
  const id =
    pick((name) => levels.has(name)) ?? pick((name) => name === normaliseLabel(rules.labels.program));
  return id ? String(id) : null;
}

/** Diffs at most this big are measured line by line; bigger ones can't be trivial. */
const MEASURE_LIMIT = 50;

/** Changed lines that aren't blank, from the PR's patches (PRD §4.4 trivial-diff rule). */
async function changedNonBlankLines(repo: RepoRow, number: number, token: string) {
  const files = await restList<{ patch?: string }>(
    `/repos/${repo.owner}/${repo.name}/pulls/${number}/files?per_page=100`,
    token,
    { maxPages: 3 },
  );
  let count = 0;
  for (const file of files) {
    for (const line of (file.patch ?? "").split("\n")) {
      if ((line.startsWith("+") || line.startsWith("-")) && line.slice(1).trim() !== "") count++;
    }
  }
  return count;
}

/** "Reverts owner/repo#12" in a revert PR's body (GitHub's Revert button writes this). */
function revertedNumber(body: string, repo: RepoRow) {
  const match = /^Reverts ([\w.-]+)\/([\w.-]+)#(\d+)/m.exec(body);
  if (!match) return null;
  const sameRepo =
    match[1]!.toLowerCase() === repo.owner.toLowerCase() &&
    match[2]!.toLowerCase() === repo.name.toLowerCase();
  return sameRepo ? Number(match[3]) : null;
}

export async function syncPullRequest(githubRepoId: bigint, number: number) {
  let repo = await findRepo(githubRepoId, number);
  if (!repo) return;
  const token = await tokenFor(repo);
  if (!token) return;

  const fetch = (target: RepoRow) =>
    graphql<PrData>(PR_QUERY, { owner: target.owner, name: target.name, number }, token);
  let data = await fetch(repo);
  if (!data?.repository) {
    // Renamed or transferred since we last looked: refresh by id and try once more.
    const refreshed = await refreshRepoDetails(repo, token);
    if (!refreshed) return;
    repo = refreshed;
    data = await fetch(repo);
  }
  const pr = data?.repository?.pullRequest;
  if (!data?.repository || !pr) return;

  // Bots and deleted ("ghost") accounts are stored too, so a revert PR they opened still takes
  // the reverted PR's points back. They have no Mergio account, so they never score: the PR is
  // recorded as not registered. A ghost has no id, so it is stored under 0, which no account has.
  const author = {
    githubId: BigInt(pr.author?.databaseId ?? 0),
    login: pr.author?.login ?? "ghost",
  };

  const defaultBranch = data.repository.defaultBranchRef?.name ?? null;
  if (defaultBranch && defaultBranch !== repo.defaultBranch) {
    await prisma.projectRepo.updateMany({ where: { githubRepoId }, data: { defaultBranch } });
  }

  const linkedIssues = pr.closingIssuesReferences.nodes.filter(
    (issue) => BigInt(issue.repository.databaseId) === githubRepoId,
  );
  const changedLines =
    pr.state === "MERGED" && pr.additions + pr.deletions <= MEASURE_LIMIT
      ? await changedNonBlankLines(repo, number, token)
      : pr.additions + pr.deletions;

  const fields = {
    githubId: BigInt(pr.databaseId),
    title: pr.title,
    url: pr.url,
    authorGithubId: author.githubId,
    authorLogin: author.login,
    state: pr.state,
    isDraft: pr.isDraft,
    baseRef: pr.baseRefName,
    labels: pr.labels.nodes.map((label) => label.name),
    linkedIssueNumbers: linkedIssues.map((issue) => issue.number),
    linkedIssueLabelers: linkedIssues.map((issue) => ({
      number: issue.number,
      githubId: labelerOf(issue, rulesOf(repo)),
    })),
    linkedIssueLabels: [
      ...new Set(linkedIssues.flatMap((issue) => issue.labels.nodes.map((label) => label.name))),
    ],
    additions: pr.additions,
    deletions: pr.deletions,
    changedLines,
    mergedAt: pr.mergedAt ? new Date(pr.mergedAt) : null,
    mergedByGithubId: pr.mergedBy?.databaseId ? BigInt(pr.mergedBy.databaseId) : null,
    mergedByLogin: pr.mergedBy?.login ?? null,
    closedAt: pr.closedAt ? new Date(pr.closedAt) : null,
    revertsNumber: revertedNumber(pr.body, repo),
    approvedByGithubIds: [
      ...new Set(
        pr.reviews.nodes.flatMap((review) =>
          review.author?.databaseId ? [BigInt(review.author.databaseId)] : [],
        ),
      ),
    ],
    githubCreatedAt: new Date(pr.createdAt),
    githubUpdatedAt: new Date(pr.updatedAt),
    lastSyncedAt: new Date(),
  };

  const stored = await prisma.pullRequest.upsert({
    where: { repoId_number: { repoId: repo.id, number } },
    create: { repoId: repo.id, seasonId: repo.project.seasonId, number, ...fields },
    update: fields,
    select: { id: true },
  });

  const labelEvents = pr.timelineItems.nodes.filter(
    (event) => event.id && event.label && event.createdAt,
  );
  if (labelEvents.length > 0) {
    await prisma.prLabelEvent.createMany({
      data: labelEvents.map((event) => ({
        pullRequestId: stored.id,
        githubEventId: event.id!,
        label: event.label!.name,
        action: event.__typename === "LabeledEvent" ? "ADDED" : "REMOVED",
        actorLogin: event.actor?.login ?? null,
        createdAt: new Date(event.createdAt!),
      })),
      skipDuplicates: true,
    });
  }

  await scorePullRequest(stored.id);

  // A merged revert takes the original's points back (if within the revert window).
  if (fields.revertsNumber && pr.state === "MERGED") {
    const original = await prisma.pullRequest.findUnique({
      where: { repoId_number: { repoId: repo.id, number: fields.revertsNumber } },
      select: { id: true },
    });
    if (original) await scorePullRequest(original.id);
  }
}
