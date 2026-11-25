import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  BADGES,
  DEFAULT_RULES,
  REASON_CODES,
  allocateDaily,
  evaluatePullRequest,
  istDay,
  istDayStart,
  istWeekKey,
  longestWeekStreak,
  mentorAwards,
  planMentorPoints,
  meetsBadge,
  nextBadge,
  planLedger,
  reasonText,
  resolveRules,
  type AuthorFacts,
  type Evaluation,
  type ExistingEntry,
  type PullRequestFacts,
  type ScoringContext,
} from "./index";

const rules = DEFAULT_RULES;
const merged = new Date("2026-12-10T08:00:00Z"); // 13:30 IST, a Thursday
const hours = (n: number) => new Date(merged.getTime() + n * 3_600_000);

function pr(overrides: Partial<PullRequestFacts> = {}): PullRequestFacts {
  return {
    state: "MERGED",
    mergedAt: merged,
    labels: ["wos", "level:intermediate"],
    linkedIssueLabels: [],
    baseRef: "main",
    defaultBranch: "main",
    changedLines: 40,
    selfMerged: false,
    revertedAt: null,
    ...overrides,
  };
}
const author = (overrides: Partial<AuthorFacts> = {}): AuthorFacts => ({
  registered: true,
  projectStaff: false,
  scoringSuspendedAt: null,
  ...overrides,
});
const context = (overrides: Partial<ScoringContext> = {}): ScoringContext => ({
  repoTracked: true,
  codingStartsAt: new Date("2026-12-01T00:00:00+05:30"),
  codingEndsAt: new Date("2026-12-31T23:59:59+05:30"),
  beginnerPrsScoredInProject: 0,
  qualityBonusesInProjectThisWeek: 0,
  now: hours(1),
  ...overrides,
});

const evaluate = (
  p: Partial<PullRequestFacts> = {},
  a: Partial<AuthorFacts> = {},
  c: Partial<ScoringContext> = {},
) => evaluatePullRequest(pr(p), author(a), context(c), rules);

function reasonOf(evaluation: Evaluation) {
  assert.ok(
    evaluation.status === "NOT_ELIGIBLE" || evaluation.status === "INVALIDATED",
    `expected a reason, got ${evaluation.status}`,
  );
  return evaluation.reason;
}

function awardsOf(evaluation: Evaluation) {
  return evaluation.status === "SCORED" ? evaluation.awards : [];
}

/** Applies a plan to a ledger, the way the worker writes it. The daily cap has its own tests. */
function apply(ledger: ExistingEntry[], evaluation: Evaluation, now = hours(2)) {
  const plan = planLedger({
    desired: awardsOf(evaluation),
    existing: ledger,
    mergedAt: merged,
    now,
    dailyUsed: new Map(),
    dailyCap: 0,
    reversalDescription: "change",
  });
  return [...ledger, ...plan.map(({ ruleKey, points }) => ({ ruleKey, points }))];
}
const total = (ledger: ExistingEntry[]) => ledger.reduce((sum, entry) => sum + entry.points, 0);

describe("evaluatePullRequest", () => {
  test("open and closed PRs are not scored", () => {
    assert.equal(evaluate({ state: "OPEN", mergedAt: null }).status, "OPEN");
    assert.equal(evaluate({ state: "CLOSED", mergedAt: null }).status, "CLOSED");
  });

  test("a labelled, merged PR scores its level's points", () => {
    for (const [label, points] of [
      ["level:beginner", 10],
      ["level:intermediate", 25],
      ["level:advanced", 45],
    ] as const) {
      const evaluation = evaluate({ labels: ["wos", label] });
      assert.equal(evaluation.status, "SCORED");
      assert.deepEqual(awardsOf(evaluation).map((award) => award.points), [points]);
    }
  });

  test("labels match case-insensitively", () => {
    assert.equal(evaluate({ labels: ["WOS", "Level:Advanced"] }).status, "SCORED");
  });

  test("bonuses add their points", () => {
    const evaluation = evaluate({
      labels: ["wos", "level:beginner", "bonus:quality", "bonus:docs", "bonus:tests"],
    });
    assert.deepEqual(
      awardsOf(evaluation).map((award) => [award.ruleKey, award.points]),
      [
        ["base", 10],
        ["bonus:quality", 10],
        ["bonus:docs", 5],
        ["bonus:tests", 5],
      ],
    );
  });

  test("the quality bonus is capped per project per week", () => {
    const evaluation = evaluate(
      { labels: ["wos", "level:beginner", "bonus:quality"] },
      {},
      { qualityBonusesInProjectThisWeek: 2 },
    );
    assert.deepEqual(awardsOf(evaluation).map((award) => award.ruleKey), ["base"]);
    assert.equal(evaluation.status === "SCORED" && evaluation.notes.length, 1);
  });

  test("the level falls back to the closed issue's label", () => {
    const evaluation = evaluate({
      labels: ["wos"],
      linkedIssueLabels: ["level:advanced"],
    });
    assert.equal(evaluation.status, "SCORED");
    assert.equal(evaluation.status === "SCORED" && evaluation.levelSource, "LINKED_ISSUE");
    assert.equal(awardsOf(evaluation)[0]?.points, 45);
  });

  test("the program label may be on the closed issue", () => {
    assert.equal(
      evaluate({ labels: ["level:beginner"], linkedIssueLabels: ["wos"] }).status,
      "SCORED",
    );
  });

  test("the PR's own level beats the issue's", () => {
    const evaluation = evaluate({
      labels: ["wos", "level:beginner"],
      linkedIssueLabels: ["level:advanced"],
    });
    assert.equal(awardsOf(evaluation)[0]?.points, 10);
  });

  test("missing labels wait for the grace window, then become ineligible", () => {
    const early = evaluate({ labels: ["wos"] }, {}, { now: hours(71) });
    assert.equal(early.status, "AWAITING_LABEL");
    assert.equal(early.status === "AWAITING_LABEL" && early.labelDeadline.getTime(), hours(72).getTime());
    assert.equal(reasonOf(evaluate({ labels: ["wos"] }, {}, { now: hours(72) })), "NO_LEVEL_LABEL");

    const noProgram = evaluate({ labels: ["level:beginner"] }, {}, { now: hours(10) });
    assert.equal(noProgram.status === "AWAITING_LABEL" && noProgram.missing, "NO_PROGRAM_LABEL");
    assert.equal(
      reasonOf(evaluate({ labels: ["level:beginner"] }, {}, { now: hours(80) })),
      "NO_PROGRAM_LABEL",
    );
  });

  test("a diff under 3 changed lines scores as beginner", () => {
    const evaluation = evaluate({ labels: ["wos", "level:advanced"], changedLines: 2 });
    assert.equal(evaluation.status === "SCORED" && evaluation.level, "BEGINNER");
    assert.equal(awardsOf(evaluation)[0]?.points, 10);
    assert.equal(awardsOf(evaluate({ labels: ["wos", "level:advanced"], changedLines: 3 }))[0]?.points, 45);
  });

  test("every reason code is reachable", () => {
    const cases: Record<string, Evaluation> = {
      NOT_REGISTERED: evaluate({}, { registered: false }),
      NO_PROGRAM_LABEL: evaluate({ labels: ["level:beginner"] }, {}, { now: hours(100) }),
      NO_LEVEL_LABEL: evaluate({ labels: ["wos"] }, {}, { now: hours(100) }),
      MULTIPLE_LEVEL_LABELS: evaluate({ labels: ["wos", "level:beginner", "level:advanced"] }),
      OUTSIDE_WINDOW: evaluate({}, {}, { codingEndsAt: new Date("2026-12-05T00:00:00Z") }),
      REPO_NOT_TRACKED: evaluate({}, {}, { repoTracked: false }),
      WRONG_BASE_BRANCH: evaluate({ baseRef: "dev" }),
      SELF_MERGED: evaluate({ selfMerged: true }),
      AUTHOR_IS_MENTOR: evaluate({}, { projectStaff: true }),
      CAP_REACHED: evaluate({ labels: ["wos", "level:beginner"] }, {}, { beginnerPrsScoredInProject: 8 }),
      INVALID_LABEL: evaluate({ labels: ["wos", "level:beginner", "wos:invalid"] }),
      SPAM_LABEL: evaluate({ labels: ["wos", "level:beginner", "wos:spam"] }),
      REVERTED: evaluate({ revertedAt: hours(24) }),
      AUTHOR_SANCTIONED: evaluate({}, { scoringSuspendedAt: hours(-1) }),
    };
    assert.deepEqual(Object.keys(cases).sort(), [...REASON_CODES].sort());
    for (const [code, evaluation] of Object.entries(cases)) {
      assert.equal(reasonOf(evaluation), code);
      assert.ok(reasonText(reasonOf(evaluation), rules).length > 0);
    }
  });

  test("a season without a contribution window scores nothing", () => {
    assert.equal(reasonOf(evaluate({}, {}, { codingStartsAt: null })), "OUTSIDE_WINDOW");
  });

  test("an unknown default branch skips the branch check", () => {
    assert.equal(evaluate({ baseRef: "dev", defaultBranch: null }).status, "SCORED");
  });

  test("a revert after the 7-day window doesn't invalidate", () => {
    assert.equal(evaluate({ revertedAt: hours(24 * 7 + 1) }).status, "SCORED");
  });

  test("a suspension only affects PRs merged after it", () => {
    assert.equal(evaluate({}, { scoringSuspendedAt: hours(1) }).status, "SCORED");
  });

  test("the beginner cap leaves other levels alone", () => {
    assert.equal(evaluate({}, {}, { beginnerPrsScoredInProject: 8 }).status, "SCORED");
  });
});

describe("point changes over time (PRD §4.3)", () => {
  test("scoring is idempotent", () => {
    const ledger = apply([], evaluate());
    assert.equal(total(ledger), 25);
    assert.equal(apply(ledger, evaluate()).length, ledger.length);
  });

  test("a relabel up adds the difference", () => {
    let ledger = apply([], evaluate());
    ledger = apply(ledger, evaluate({ labels: ["wos", "level:advanced"] }));
    assert.equal(total(ledger), 45);
    assert.deepEqual(ledger.map((entry) => entry.points), [25, 20]);
  });

  test("a relabel down reverses the difference", () => {
    let ledger = apply([], evaluate({ labels: ["wos", "level:advanced"] }));
    ledger = apply(ledger, evaluate({ labels: ["wos", "level:beginner"] }));
    assert.deepEqual(ledger.map((entry) => entry.points), [45, -35]);
  });

  test("a late bonus is a new entry", () => {
    let ledger = apply([], evaluate());
    ledger = apply(ledger, evaluate({ labels: ["wos", "level:intermediate", "bonus:docs"] }));
    assert.deepEqual(ledger.map((entry) => [entry.ruleKey, entry.points]), [
      ["base", 25],
      ["bonus:docs", 5],
    ]);
  });

  for (const [name, change] of [
    ["invalid", { labels: ["wos", "level:intermediate", "bonus:docs", "wos:invalid"] }],
    ["spam", { labels: ["wos", "level:intermediate", "bonus:docs", "wos:spam"] }],
    ["revert within 7 days", { labels: ["wos", "level:intermediate", "bonus:docs"], revertedAt: hours(48) }],
  ] satisfies [string, Partial<PullRequestFacts>][]) {
    test(`${name} reverses everything`, () => {
      let ledger = apply([], evaluate({ labels: ["wos", "level:intermediate", "bonus:docs"] }));
      ledger = apply(ledger, evaluate(change));
      assert.equal(total(ledger), 0);
      assert.equal(ledger.length, 4);
    });
  }

  test("removing the invalid label restores the points", () => {
    let ledger = apply([], evaluate());
    ledger = apply(ledger, evaluate({ labels: ["wos", "level:intermediate", "wos:invalid"] }));
    ledger = apply(ledger, evaluate());
    assert.deepEqual(ledger.map((entry) => entry.points), [25, -25, 25]);
  });

  test("manual adjustments and dispute corrections are kept beside rule entries", () => {
    // They use their own rule keys, so rescoring a PR never undoes them.
    const ledger = apply([{ ruleKey: "adjustment:abc", points: 7 }], evaluate());
    assert.equal(total(ledger), 32);
  });
});

describe("daily cap", () => {
  test("overflow is held to the next IST day", () => {
    const day = istDay(merged);
    const parts = allocateDaily(45, merged, new Map([[day, 10]]), 40);
    assert.deepEqual(parts.map((part) => part.points), [30, 15]);
    assert.equal(parts[0]!.effectiveAt.getTime(), merged.getTime());
    assert.equal(istDay(parts[1]!.effectiveAt), "2026-12-11");
    assert.equal(parts[1]!.effectiveAt.getTime(), istDayStart("2026-12-11").getTime());
  });

  test("full days are skipped", () => {
    const parts = allocateDaily(10, merged, new Map([["2026-12-10", 40], ["2026-12-11", 40]]), 40);
    assert.deepEqual(parts.map((part) => istDay(part.effectiveAt)), ["2026-12-12"]);
  });

  test("planLedger splits base and bonus across days", () => {
    const plan = planLedger({
      desired: awardsOf(evaluate({ labels: ["wos", "level:advanced", "bonus:quality"] })),
      existing: [],
      mergedAt: merged,
      now: hours(1),
      dailyUsed: new Map(),
      dailyCap: 40,
      reversalDescription: "",
    });
    assert.deepEqual(
      plan.map((entry) => [entry.ruleKey, entry.points, istDay(entry.effectiveAt)]),
      [
        ["base", 40, "2026-12-10"],
        ["base", 5, "2026-12-11"],
        ["bonus:quality", 10, "2026-12-11"],
      ],
    );
  });
});

describe("reversals", () => {
  const plan = (existing: ExistingEntry[], labels: string[], now: Date, dailyUsed = new Map<string, number>()) =>
    planLedger({
      desired: awardsOf(evaluate({ labels })),
      existing,
      mergedAt: merged,
      now,
      dailyUsed,
      dailyCap: 40,
      reversalDescription: "taken back",
    });

  test("a reversal counts from the same moment as the award it cancels", () => {
    const awardedAt = merged;
    const existing = [{ ruleKey: "base", points: 25, effectiveAt: awardedAt }];
    const later = new Date(merged.getTime() + 8 * 86_400_000); // a week on
    const [reversal] = plan(existing, ["wos"], later);
    assert.equal(reversal!.kind, "REVERSAL");
    assert.equal(reversal!.points, -25);
    assert.equal(reversal!.effectiveAt.getTime(), awardedAt.getTime());
  });

  test("a held award is reversed on the day it was held to, not before", () => {
    const heldTo = istDayStart("2026-12-11");
    const existing = [
      { ruleKey: "base", points: 30, effectiveAt: merged },
      { ruleKey: "base", points: 15, effectiveAt: heldTo },
    ];
    const reversals = plan(existing, ["wos"], hours(3));
    // The held 15 are taken back first, effective when they would have counted.
    assert.deepEqual(
      reversals.map((entry) => [entry.points, entry.effectiveAt.getTime()]),
      [
        [-15, heldTo.getTime()],
        [-30, merged.getTime()],
      ],
    );
  });

  test("a partial reversal only takes back the difference", () => {
    const existing = [{ ruleKey: "base", points: 45, effectiveAt: merged }];
    const reversals = plan(existing, ["wos", "level:intermediate"], hours(3));
    assert.deepEqual(reversals.map((entry) => entry.points), [-20]);
  });

  test("reversed points free the day's cap room again", () => {
    // 40 awarded on the merge day, then taken back: the next award fits on the same day.
    const day = istDay(merged);
    const awarded = [
      { ruleKey: "base", points: 40, effectiveAt: merged },
      { ruleKey: "base", points: -40, effectiveAt: merged },
    ];
    // dailyUsed is the net the caller computes: 0 for that day.
    const again = plan(awarded, ["wos", "level:advanced"], hours(3), new Map([[day, 0]]));
    assert.deepEqual(
      again.map((entry) => [entry.points, istDay(entry.effectiveAt)]),
      [[40, day], [5, "2026-12-11"]],
    );
  });

  test("older entries without dates are reversed now", () => {
    const [reversal] = plan([{ ruleKey: "base", points: 25 }], ["wos"], hours(3));
    assert.equal(reversal!.points, -25);
    assert.equal(reversal!.effectiveAt.getTime(), hours(3).getTime());
  });
});

describe("time", () => {
  test("IST days and weeks", () => {
    assert.equal(istDay(new Date("2026-12-10T18:29:59Z")), "2026-12-10");
    assert.equal(istDay(new Date("2026-12-10T18:30:00Z")), "2026-12-11");
    assert.equal(istWeekKey(merged), "2026-12-07"); // the Monday
    assert.equal(istWeekKey(new Date("2026-12-06T18:30:00Z")), "2026-12-07"); // Mon 00:00 IST
    assert.equal(istWeekKey(new Date("2026-12-06T18:29:59Z")), "2026-11-30"); // Sun 23:59 IST
  });
});

describe("rules", () => {
  test("stored overrides apply and bad values are ignored", () => {
    const resolved = resolveRules({
      labels: { program: "mergio", levels: { BEGINNER: "" } },
      points: { levels: { ADVANCED: 50, BEGINNER: -1 } },
      caps: { dailyPoints: "lots" },
    });
    assert.equal(resolved.labels.program, "mergio");
    assert.equal(resolved.labels.levels.BEGINNER, "level:beginner");
    assert.equal(resolved.points.levels.ADVANCED, 50);
    assert.equal(resolved.points.levels.BEGINNER, 10);
    assert.equal(resolved.caps.dailyPoints, 40);
    assert.deepEqual(resolveRules(null), DEFAULT_RULES);
  });
});

describe("badges", () => {
  const stats = { scoredPrs: 0, advancedPrs: 0, projects: 0, weeks: [], rank: null, qualityBonuses: 0 };

  test("streaks count consecutive weeks", () => {
    assert.equal(longestWeekStreak(["2026-12-07", "2026-11-30", "2026-12-14", "2026-12-28"]), 3);
    assert.equal(longestWeekStreak([]), 0);
  });

  test("rank badges need a rank", () => {
    const top10 = BADGES.find((badge) => badge.key === "top-10")!;
    assert.equal(meetsBadge(top10, stats), false);
    assert.equal(meetsBadge(top10, { ...stats, rank: 10 }), true);
    assert.equal(meetsBadge(top10, { ...stats, rank: 11 }), false);
  });

  test("the next badge is the closest count badge", () => {
    assert.equal(nextBadge(stats, new Set())?.badge.key, "first-merge");
    const progress = nextBadge({ ...stats, scoredPrs: 4 }, new Set(["first-merge"]));
    assert.deepEqual(
      progress && [progress.badge.key, progress.current, progress.target],
      ["prs-5", 4, 5],
    );
    const all = new Set(BADGES.map((badge) => badge.key));
    assert.equal(nextBadge(stats, all), null);
  });
});

describe("mentor points", () => {
  const base = {
    pullRequestId: "pr1",
    scored: true,
    authorId: "author",
    approvedBy: ["mentor", "stranger", "mentor"],
    issues: [{ ruleKey: "issue:r#4", number: 4, anyScoredPr: true, labelledBy: "mentor" }],
    staff: new Set(["mentor", "admin"]),
    awarded: new Set<string>(),
    rules,
  };
  const keys = ["review:pr1", "issue:r#4"];
  const apply = (ledger: { ruleKey: string; userId: string; points: number }[], input: typeof base) => [
    ...ledger,
    ...planMentorPoints(keys, mentorAwards(input), ledger).map(({ ruleKey, userId, points }) => ({ ruleKey, userId, points })),
  ];

  test("staff reviewers and issue labellers earn points, once", () => {
    const ledger = apply([], base);
    assert.deepEqual(ledger, [
      { ruleKey: "issue:r#4", userId: "mentor", points: 2 },
      { ruleKey: "review:pr1", userId: "mentor", points: 5 },
    ]);
    assert.equal(apply(ledger, base).length, 2);
  });

  test("the author never earns mentor points on their own PR", () => {
    assert.deepEqual(mentorAwards({ ...base, authorId: "mentor" }), []);
  });

  test("points go back when the PR stops scoring and the issue has no other scored PR", () => {
    const ledger = apply([], base);
    const after = apply(ledger, { ...base, scored: false, issues: [{ ...base.issues[0]!, anyScoredPr: false }] });
    assert.equal(after.reduce((sum, entry) => sum + entry.points, 0), 0);
  });

  test("leaving the project keeps earned points", () => {
    const ledger = apply([], base);
    const awarded = new Set(ledger.map((entry) => `${entry.ruleKey}|${entry.userId}`));
    assert.equal(apply(ledger, { ...base, staff: new Set(), awarded }).length, ledger.length);
  });
});
