import type { ScoringRules } from "./rules";

// Mentor points (PRD §4.5), pure like the contributor engine:
//   +approvingReview for each staff member who approved a PR that scores;
//   +labelledIssue once per issue, for the staff member who labelled it, when a scored PR closes it.
// Staff means the project admin and active mentors. Someone who leaves the project keeps points
// already earned: they are only taken back when the PR or issue stops qualifying.

export type MentorAward = { ruleKey: string; userId: string; points: number; description: string };

export type MentorPointsInput = {
  pullRequestId: string;
  /** The PR currently scores (SCORED). */
  scored: boolean;
  authorId: string | null;
  /** Users (already resolved from GitHub ids) who approved the PR. */
  approvedBy: string[];
  /** Issues the PR closes: whether any PR closing it scores, and who labelled it. */
  issues: { ruleKey: string; number: number; anyScoredPr: boolean; labelledBy: string | null }[];
  staff: ReadonlySet<string>;
  /** "ruleKey|userId" pairs that already hold points, so leaving staff doesn't revoke them. */
  awarded: ReadonlySet<string>;
  rules: ScoringRules;
};

export const reviewRuleKey = (pullRequestId: string) => `review:${pullRequestId}`;
export const issueRuleKey = (repoId: string, number: number) => `issue:${repoId}#${number}`;

export function mentorAwards(input: MentorPointsInput): MentorAward[] {
  const eligible = (ruleKey: string, userId: string) =>
    userId !== input.authorId && (input.staff.has(userId) || input.awarded.has(`${ruleKey}|${userId}`));
  const awards: MentorAward[] = [];

  if (input.scored) {
    const ruleKey = reviewRuleKey(input.pullRequestId);
    for (const userId of new Set(input.approvedBy)) {
      if (!eligible(ruleKey, userId)) continue;
      awards.push({
        ruleKey,
        userId,
        points: input.rules.mentorPoints.approvingReview,
        description: "Approving review on a scored pull request",
      });
    }
  }
  for (const issue of input.issues) {
    if (!issue.anyScoredPr || !issue.labelledBy || !eligible(issue.ruleKey, issue.labelledBy)) continue;
    awards.push({
      ruleKey: issue.ruleKey,
      userId: issue.labelledBy,
      points: input.rules.mentorPoints.labelledIssue,
      description: `Labelled issue #${issue.number} got a scored pull request`,
    });
  }
  return awards;
}

export type MentorEntry = { ruleKey: string; userId: string; points: number };

/**
 * New ledger entries that bring `existing` to `desired` for the given rule keys: one entry per
 * (rule, user) whose total changes. Running it again after writing them gives nothing.
 */
export function planMentorPoints(
  ruleKeys: string[],
  desired: MentorAward[],
  existing: MentorEntry[],
): (MentorAward & { reversal: boolean })[] {
  const keys = new Set(ruleKeys);
  const current = new Map<string, number>();
  for (const entry of existing) {
    if (!keys.has(entry.ruleKey)) continue;
    const key = `${entry.ruleKey}|${entry.userId}`;
    current.set(key, (current.get(key) ?? 0) + entry.points);
  }
  const wanted = new Map(
    desired.filter((award) => keys.has(award.ruleKey)).map((award) => [`${award.ruleKey}|${award.userId}`, award]),
  );
  const entries: (MentorAward & { reversal: boolean })[] = [];
  for (const key of [...new Set([...current.keys(), ...wanted.keys()])].sort()) {
    const [ruleKey, userId] = key.split("|") as [string, string];
    const award = wanted.get(key);
    const delta = (award?.points ?? 0) - (current.get(key) ?? 0);
    if (delta === 0) continue;
    entries.push({
      ruleKey,
      userId,
      points: delta,
      description: delta > 0 && award ? award.description : "Taken back: the pull request no longer scores",
      reversal: delta < 0,
    });
  }
  return entries;
}
