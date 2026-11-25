// Scoring rules (PRD §4.1, §4.4). A season stores overrides in `Season.scoringRules`; anything it
// leaves out uses these defaults, so a new season needs no code change.

export const LEVELS = ["BEGINNER", "INTERMEDIATE", "ADVANCED"] as const;
export type Level = (typeof LEVELS)[number];

export const BONUSES = ["quality", "docs", "tests"] as const;
export type Bonus = (typeof BONUSES)[number];

export type ScoringRules = {
  labels: {
    /** Marks a PR or issue as part of the program. */
    program: string;
    levels: Record<Level, string>;
    bonuses: Record<Bonus, string>;
    invalid: string;
    spam: string;
  };
  points: {
    levels: Record<Level, number>;
    bonuses: Record<Bonus, number>;
  };
  /** Mentor points (PRD §4.5), kept apart from contributor scores. */
  mentorPoints: {
    /** Per approving review on a PR that scores. */
    approvingReview: number;
    /** When an issue the mentor labelled gets a scored PR (once per issue). */
    labelledIssue: number;
  };
  caps: {
    /** Scored beginner PRs per contributor per project; later ones are CAP_REACHED. */
    beginnerPrsPerProject: number;
    /** Points per contributor per IST day; the overflow is held to the next day. */
    dailyPoints: number;
    /** `bonus:quality` awards per contributor per project per IST week. */
    qualityBonusesPerProjectPerWeek: number;
    /** Diffs with fewer changed non-whitespace lines than this score as beginner at most. */
    trivialDiffLines: number;
  };
  /** How long after the merge a mentor has to add the level label. */
  labelGraceHours: number;
  /** A revert merged within this many days of the original takes its points back. */
  revertWindowDays: number;
  /** How long after a PR's merge (or its last score change) the contributor can dispute it. */
  disputeWindowDays: number;
  /** Spam strikes that suspend a contributor's scoring until an organizer reviews it. */
  spamStrikesToSuspend: number;
};

export const DEFAULT_RULES: ScoringRules = {
  labels: {
    program: "wos",
    levels: {
      BEGINNER: "level:beginner",
      INTERMEDIATE: "level:intermediate",
      ADVANCED: "level:advanced",
    },
    bonuses: { quality: "bonus:quality", docs: "bonus:docs", tests: "bonus:tests" },
    invalid: "wos:invalid",
    spam: "wos:spam",
  },
  points: {
    levels: { BEGINNER: 10, INTERMEDIATE: 25, ADVANCED: 45 },
    bonuses: { quality: 10, docs: 5, tests: 5 },
  },
  mentorPoints: { approvingReview: 5, labelledIssue: 2 },
  caps: {
    beginnerPrsPerProject: 8,
    dailyPoints: 40,
    qualityBonusesPerProjectPerWeek: 2,
    trivialDiffLines: 3,
  },
  labelGraceHours: 72,
  revertWindowDays: 7,
  disputeWindowDays: 7,
  spamStrikesToSuspend: 3,
};

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Overlays stored values onto `base`, keeping only those with the same type as the default. */
function merge<T>(base: T, stored: unknown): T {
  if (!isObject(base) || !isObject(stored)) return base;
  const result: Json = { ...base };
  for (const [key, fallback] of Object.entries(base)) {
    const value = stored[key];
    if (isObject(fallback)) result[key] = merge(fallback, value);
    else if (typeof fallback === "number" && typeof value === "number" && Number.isFinite(value) && value >= 0)
      result[key] = value;
    else if (typeof fallback === "string" && typeof value === "string" && value.trim() !== "")
      result[key] = value.trim();
  }
  return result as T;
}

/** The effective rules for a season: its stored overrides on top of the defaults. */
export function resolveRules(stored: unknown): ScoringRules {
  return merge(DEFAULT_RULES, stored);
}

/** GitHub label names are case-insensitive. */
export const normaliseLabel = (label: string) => label.trim().toLowerCase();

/** Every label the program uses, with a colour and description, for creating them on install. */
export function programLabels(rules: ScoringRules) {
  const { labels, points } = rules;
  return [
    { name: labels.program, color: "1F6FEB", description: "Part of the Mergio open-source program" },
    { name: labels.levels.BEGINNER, color: "2DA44E", description: `Beginner: ${points.levels.BEGINNER} points` },
    { name: labels.levels.INTERMEDIATE, color: "0969DA", description: `Intermediate: ${points.levels.INTERMEDIATE} points` },
    { name: labels.levels.ADVANCED, color: "8250DF", description: `Advanced: ${points.levels.ADVANCED} points` },
    { name: labels.bonuses.quality, color: "BF8700", description: `Quality bonus: +${points.bonuses.quality} points` },
    { name: labels.bonuses.docs, color: "BF8700", description: `Documentation bonus: +${points.bonuses.docs} points` },
    { name: labels.bonuses.tests, color: "BF8700", description: `Tests bonus: +${points.bonuses.tests} points` },
    { name: labels.invalid, color: "6E7781", description: "Not counted for the program" },
    { name: labels.spam, color: "CF222E", description: "Spam: not counted, and a strike for the author" },
  ];
}

export const LEVEL_NAMES: Record<Level, string> = {
  BEGINNER: "Beginner",
  INTERMEDIATE: "Intermediate",
  ADVANCED: "Advanced",
};

export const BONUS_NAMES: Record<Bonus, string> = {
  quality: "Quality bonus",
  docs: "Documentation bonus",
  tests: "Tests bonus",
};
