import type { InvalidatingReason, ReasonCode } from "./reasons";
import {
  BONUSES,
  BONUS_NAMES,
  LEVELS,
  LEVEL_NAMES,
  normaliseLabel,
  type Bonus,
  type Level,
  type ScoringRules,
} from "./rules";
import { DAY_MS, HOUR_MS } from "./time";

// The pure part of the scoring engine (F-07): from everything known about one PR, decide whether
// it counts and what it is worth. No database or clock access; the caller passes `now`, so the
// same inputs always give the same answer and a full recompute matches incremental updates.

export type PullRequestFacts = {
  state: "OPEN" | "CLOSED" | "MERGED";
  mergedAt: Date | null;
  labels: string[];
  /** Labels on the issues the PR closes ("Closes #123"), all together. */
  linkedIssueLabels: string[];
  baseRef: string;
  /** The repo's default branch, or null when unknown (then the branch isn't checked). */
  defaultBranch: string | null;
  /** Changed non-whitespace lines, or null when unknown. */
  changedLines: number | null;
  /** The author merged it themselves. */
  selfMerged: boolean;
  /** When a revert of this PR was merged, if one was. */
  revertedAt: Date | null;
};

export type AuthorFacts = {
  /** An approved contributor registration. */
  registered: boolean;
  /** Owner (project admin) or mentor of the PR's project. */
  projectStaff: boolean;
  /** When scoring was suspended on the account (spam strikes, organizer sanction). */
  scoringSuspendedAt: Date | null;
};

export type ScoringContext = {
  /** The repo is an approved, not-removed repo of an approved project when the PR merged. */
  repoTracked: boolean;
  codingStartsAt: Date | null;
  codingEndsAt: Date | null;
  /** This contributor's other scored beginner PRs on the project, merged before this one. */
  beginnerPrsScoredInProject: number;
  /** Quality bonuses this contributor already has on the project in this PR's merge week. */
  qualityBonusesInProjectThisWeek: number;
  now: Date;
};

export type Award = {
  /** "base" for the level points, "bonus:<name>" for bonuses. One ledger rule per key. */
  ruleKey: string;
  points: number;
  level?: Level;
  description: string;
};

export type Evaluation =
  | { status: "OPEN" }
  | { status: "CLOSED" }
  | {
      status: "AWAITING_LABEL";
      missing: "NO_PROGRAM_LABEL" | "NO_LEVEL_LABEL";
      labelDeadline: Date;
      level: Level | null;
    }
  | { status: "NOT_ELIGIBLE"; reason: Exclude<ReasonCode, InvalidatingReason>; level: Level | null }
  | { status: "INVALIDATED"; reason: InvalidatingReason; level: Level | null }
  | {
      status: "SCORED";
      level: Level;
      levelSource: "PR" | "LINKED_ISSUE";
      awards: Award[];
      /** Things the contributor should know about how the points were worked out. */
      notes: string[];
    };

type LevelResult =
  | { kind: "none" }
  | { kind: "multiple" }
  | { kind: "one"; level: Level; source: "PR" | "LINKED_ISSUE" };

function levelsIn(labels: Set<string>, rules: ScoringRules) {
  return LEVELS.filter((level) => labels.has(normaliseLabel(rules.labels.levels[level])));
}

/** The PR's own level label wins; otherwise the closed issue's (PRD §4.1 fallback). */
function resolveLevel(pr: Set<string>, issues: Set<string>, rules: ScoringRules): LevelResult {
  const own = levelsIn(pr, rules);
  if (own.length > 1) return { kind: "multiple" };
  if (own.length === 1) return { kind: "one", level: own[0]!, source: "PR" };
  const linked = levelsIn(issues, rules);
  if (linked.length > 1) return { kind: "multiple" };
  if (linked.length === 1) return { kind: "one", level: linked[0]!, source: "LINKED_ISSUE" };
  return { kind: "none" };
}

export function evaluatePullRequest(
  pr: PullRequestFacts,
  author: AuthorFacts,
  context: ScoringContext,
  rules: ScoringRules,
): Evaluation {
  if (pr.state === "OPEN") return { status: "OPEN" };
  if (pr.state === "CLOSED" || !pr.mergedAt) return { status: "CLOSED" };

  const mergedAt = pr.mergedAt;
  const labels = new Set(pr.labels.map(normaliseLabel));
  const issueLabels = new Set(pr.linkedIssueLabels.map(normaliseLabel));
  const has = (label: string) => labels.has(normaliseLabel(label));
  const resolved = resolveLevel(labels, issueLabels, rules);
  const knownLevel = resolved.kind === "one" ? resolved.level : null;

  const invalidated = (reason: InvalidatingReason): Evaluation => ({
    status: "INVALIDATED",
    reason,
    level: knownLevel,
  });
  const notEligible = (reason: Exclude<ReasonCode, InvalidatingReason>): Evaluation => ({
    status: "NOT_ELIGIBLE",
    reason,
    level: knownLevel,
  });

  // 1. Moderation outcomes. They apply even to PRs that already counted, and take the points back.
  if (
    pr.revertedAt &&
    pr.revertedAt.getTime() - mergedAt.getTime() <= rules.revertWindowDays * DAY_MS
  ) {
    return invalidated("REVERTED");
  }
  if (has(rules.labels.spam)) return invalidated("SPAM_LABEL");
  if (has(rules.labels.invalid)) return invalidated("INVALID_LABEL");

  // 2. Who wrote it, where and when.
  if (!author.registered) return notEligible("NOT_REGISTERED");
  if (author.scoringSuspendedAt && author.scoringSuspendedAt <= mergedAt) {
    return notEligible("AUTHOR_SANCTIONED");
  }
  if (!context.repoTracked) return notEligible("REPO_NOT_TRACKED");
  // A season without a configured window scores nothing: safer than scoring everything.
  if (
    !context.codingStartsAt ||
    !context.codingEndsAt ||
    mergedAt < context.codingStartsAt ||
    mergedAt > context.codingEndsAt
  ) {
    return notEligible("OUTSIDE_WINDOW");
  }
  if (pr.defaultBranch && pr.baseRef !== pr.defaultBranch) return notEligible("WRONG_BASE_BRANCH");
  if (pr.selfMerged) return notEligible("SELF_MERGED");
  if (author.projectStaff) return notEligible("AUTHOR_IS_MENTOR");

  // 3. Labels. Mentors have a grace window after the merge to add any that are missing.
  const labelDeadline = new Date(mergedAt.getTime() + rules.labelGraceHours * HOUR_MS);
  const inGrace = context.now < labelDeadline;
  const programLabelled =
    has(rules.labels.program) || issueLabels.has(normaliseLabel(rules.labels.program));
  if (!programLabelled) {
    return inGrace
      ? { status: "AWAITING_LABEL", missing: "NO_PROGRAM_LABEL", labelDeadline, level: knownLevel }
      : notEligible("NO_PROGRAM_LABEL");
  }
  if (resolved.kind === "multiple") return notEligible("MULTIPLE_LEVEL_LABELS");
  if (resolved.kind === "none") {
    return inGrace
      ? { status: "AWAITING_LABEL", missing: "NO_LEVEL_LABEL", labelDeadline, level: null }
      : notEligible("NO_LEVEL_LABEL");
  }

  // 4. Anti-farming (PRD §4.4).
  const notes: string[] = [];
  let level = resolved.level;
  if (resolved.source === "LINKED_ISSUE") {
    notes.push("The level comes from the issue this PR closes.");
  }
  if (
    level !== "BEGINNER" &&
    pr.changedLines !== null &&
    pr.changedLines < rules.caps.trivialDiffLines
  ) {
    notes.push(
      `Scored as beginner: the diff changes fewer than ${rules.caps.trivialDiffLines} non-blank lines.`,
    );
    level = "BEGINNER";
  }
  if (
    level === "BEGINNER" &&
    context.beginnerPrsScoredInProject >= rules.caps.beginnerPrsPerProject
  ) {
    return { status: "NOT_ELIGIBLE", reason: "CAP_REACHED", level };
  }

  // 5. Points.
  const awards: Award[] = [
    {
      ruleKey: "base",
      points: rules.points.levels[level],
      level,
      description: `${LEVEL_NAMES[level]} pull request`,
    },
  ];
  for (const bonus of BONUSES) {
    if (!has(rules.labels.bonuses[bonus])) continue;
    if (
      bonus === "quality" &&
      context.qualityBonusesInProjectThisWeek >= rules.caps.qualityBonusesPerProjectPerWeek
    ) {
      notes.push(
        `The quality bonus isn't counted: you already have ${rules.caps.qualityBonusesPerProjectPerWeek} on this project this week.`,
      );
      continue;
    }
    awards.push({
      ruleKey: bonusRuleKey(bonus),
      points: rules.points.bonuses[bonus],
      description: BONUS_NAMES[bonus],
    });
  }

  return { status: "SCORED", level, levelSource: resolved.source, awards, notes };
}

export const bonusRuleKey = (bonus: Bonus) => `bonus:${bonus}`;
