import { prisma } from "@repo/db";
import {
  issueRuleKey,
  mentorAwards,
  planMentorPoints,
  resolveRules,
  reviewRuleKey,
} from "@repo/scoring";
import { enqueueJobs, ledgerOpen, projectStaffIds } from "@repo/scoring/server";

// Applies mentor points (PRD §4.5) for one PR: its approving reviews, and the issues it closes.
// Called after the PR's contributor score is updated, so its scoreStatus is current.

type Labeler = { number: number; githubId: string | null };

/** Mergio users for GitHub account ids (only people who have signed in). */
async function usersForGithubIds(githubIds: string[]) {
  if (githubIds.length === 0) return new Map<string, string>();
  const accounts = await prisma.account.findMany({
    where: { providerId: "github", accountId: { in: [...new Set(githubIds)] } },
    select: { accountId: true, userId: true },
  });
  return new Map(accounts.map((account) => [account.accountId, account.userId]));
}

export async function scoreMentorPoints(pullRequestId: string) {
  const pr = await prisma.pullRequest.findUnique({
    where: { id: pullRequestId },
    include: { repo: { include: { project: { include: { season: true } } } } },
  });
  if (!pr) return;
  const { project } = pr.repo;
  // Locked once the season is finalized (PRD §4.8).
  if (project.season.finalizedAt) return;
  const rules = resolveRules(project.season.scoringRules);
  const labelers = (Array.isArray(pr.linkedIssueLabelers) ? pr.linkedIssueLabelers : []) as Labeler[];

  // For each issue this PR closes: does any PR closing it score (this one or another)?
  const issues = await Promise.all(
    pr.linkedIssueNumbers.map(async (number) => {
      const scored = await prisma.pullRequest.findFirst({
        where: { repoId: pr.repoId, linkedIssueNumbers: { has: number }, scoreStatus: "SCORED" },
        select: { id: true },
      });
      return {
        ruleKey: issueRuleKey(pr.repoId, number),
        number,
        anyScoredPr: Boolean(scored),
        githubId: labelers.find((labeler) => labeler.number === number)?.githubId ?? null,
      };
    }),
  );

  const users = await usersForGithubIds([
    ...pr.approvedByGithubIds.map(String),
    ...issues.flatMap((issue) => (issue.githubId ? [issue.githubId] : [])),
  ]);
  const ruleKeys = [reviewRuleKey(pr.id), ...issues.map((issue) => issue.ruleKey)];

  await prisma.$transaction(async (tx) => {
    // Issue rules are shared by every PR closing the issue, so serialize per project.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mentor:${project.id}`}))`;
    // Re-checked under the season lock: it may have been finalized since the check above.
    if (!(await ledgerOpen(tx, project.season.id))) return;
    const [staff, existing] = await Promise.all([
      projectStaffIds(project.id),
      tx.mentorPointEvent.findMany({
        where: { ruleKey: { in: ruleKeys } },
        select: { ruleKey: true, userId: true, points: true },
      }),
    ]);
    const held = new Map<string, number>();
    for (const entry of existing) {
      const key = `${entry.ruleKey}|${entry.userId}`;
      held.set(key, (held.get(key) ?? 0) + entry.points);
    }
    const awarded = new Set([...held].filter(([, points]) => points > 0).map(([key]) => key));

    const desired = mentorAwards({
      pullRequestId: pr.id,
      scored: pr.scoreStatus === "SCORED",
      authorId: pr.authorId,
      approvedBy: pr.approvedByGithubIds.flatMap((id) => {
        const userId = users.get(String(id));
        return userId ? [userId] : [];
      }),
      issues: issues.map((issue) => ({
        ruleKey: issue.ruleKey,
        number: issue.number,
        anyScoredPr: issue.anyScoredPr,
        labelledBy: issue.githubId ? (users.get(issue.githubId) ?? null) : null,
      })),
      staff,
      awarded,
      rules,
    });
    const plan = planMentorPoints(ruleKeys, desired, existing);
    if (plan.length === 0) return;

    const counts = new Map<string, number>();
    for (const entry of existing) {
      const key = `${entry.ruleKey}|${entry.userId}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    await tx.mentorPointEvent.createMany({
      data: plan.map((entry) => {
        const key = `${entry.ruleKey}|${entry.userId}`;
        const sequence = counts.get(key) ?? 0;
        counts.set(key, sequence + 1);
        return {
          seasonId: project.seasonId,
          userId: entry.userId,
          // Issue points stay attached to the PR that earned them, for the link in the ledger.
          pullRequestId: pr.id,
          ruleKey: entry.ruleKey,
          points: entry.points,
          description: entry.description,
          idempotencyKey: `${key}:${sequence}`,
        };
      }),
    });
    await enqueueJobs(
      [...new Set(plan.map((entry) => entry.userId))].map((userId) => ({
        kind: "LEADERBOARD_REFRESH" as const,
        payload: { seasonId: project.seasonId, kind: "mentor" as const, id: userId },
      })),
      { client: tx },
    );
  });
}
