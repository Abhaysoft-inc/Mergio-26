import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  autoFreezeDue,
  boardKey,
  boardPhase,
  compareStandings,
  decodeMember,
  encodeMember,
  normaliseCollegeName,
  parseBoardKey,
  type BoardRef,
  type SeasonBoardState,
  type Standing,
} from "./index";

const at = (iso: string) => new Date(iso);
const entry = (over: Partial<Standing>): Standing => ({
  id: "u",
  points: 10,
  advanced: 0,
  intermediate: 0,
  beginner: 0,
  reachedAt: at("2026-12-01T00:00:00Z"),
  ...over,
});

describe("leaderboard ordering", () => {
  const entries: Standing[] = [
    entry({ id: "a", points: 50 }),
    entry({ id: "b", points: 60 }),
    entry({ id: "c", points: 60, advanced: 1 }),
    entry({ id: "d", points: 60, advanced: 1, intermediate: 2 }),
    entry({ id: "e", points: 60, advanced: 1, intermediate: 2, reachedAt: at("2026-11-30T00:00:00Z") }),
    entry({ id: "f", points: 60, advanced: 1, intermediate: 2, reachedAt: at("2026-11-30T00:00:00Z") }),
    // "g" is a prefix of "g0": the shorter id sorts first in byte order.
    entry({ id: "g0", points: 5 }),
    entry({ id: "g", points: 5 }),
    entry({ id: "big", points: 1_234_567, advanced: 40 }),
  ];

  test("applies points, advanced, intermediate, reached first, then id", () => {
    const order = [...entries].sort(compareStandings).map((e) => e.id);
    assert.deepEqual(order, ["big", "e", "f", "d", "c", "b", "a", "g", "g0"]);
  });

  test("member byte order is the same as compareStandings", () => {
    const byMember = [...entries]
      .map(encodeMember)
      .sort((x, y) => Buffer.compare(Buffer.from(x), Buffer.from(y)))
      .map((member) => decodeMember(member).id);
    assert.deepEqual(byMember, [...entries].sort(compareStandings).map((e) => e.id));
  });

  test("members round-trip", () => {
    const original = entry({ id: "user_1", points: 345, advanced: 3, intermediate: 7, beginner: 11 });
    assert.deepEqual(decodeMember(encodeMember(original)), original);
  });
});

describe("board keys", () => {
  const boards: BoardRef[] = [
    { family: "overall" },
    { family: "weekly", week: "2026-11-16" },
    { family: "project", projectId: "p1" },
    { family: "college", collegeId: "c1" },
    { family: "colleges" },
    { family: "mentors" },
  ];
  for (const board of boards) {
    test(`${boardKey(board)} round-trips`, () => assert.deepEqual(parseBoardKey(boardKey(board)), board));
  }
  test("rejects unknown keys", () => {
    assert.equal(parseBoardKey("weekly:monday"), null);
    assert.equal(parseBoardKey("nope"), null);
  });
});

describe("freeze", () => {
  const season: SeasonBoardState = {
    codingEndsAt: at("2026-12-31T18:30:00Z"),
    leaderboardFrozenAt: null,
    leaderboardAutoFreeze: true,
    freezeSnapshotId: null,
    finalizedAt: null,
    finalSnapshotId: null,
  };

  test("auto-freezes 48 hours before coding ends", () => {
    assert.equal(autoFreezeDue(season, at("2026-12-29T18:29:59Z")), false);
    assert.equal(autoFreezeDue(season, at("2026-12-29T18:30:00Z")), true);
  });

  test("not after an organizer unfroze it, nor twice", () => {
    const now = at("2026-12-30T00:00:00Z");
    assert.equal(autoFreezeDue({ ...season, leaderboardAutoFreeze: false }, now), false);
    assert.equal(autoFreezeDue({ ...season, leaderboardFrozenAt: now }, now), false);
  });

  test("final beats frozen beats live", () => {
    assert.deepEqual(boardPhase(season), { phase: "live" });
    const frozen = { ...season, leaderboardFrozenAt: at("2026-12-29T18:30:00Z"), freezeSnapshotId: "s1" };
    assert.equal(boardPhase(frozen).phase, "frozen");
    const final = { ...frozen, finalizedAt: at("2027-01-02T00:00:00Z"), finalSnapshotId: "s2" };
    assert.deepEqual(boardPhase(final), { phase: "final", snapshotId: "s2", since: final.finalizedAt });
  });
});

describe("college names", () => {
  test("normalise for matching", () => {
    assert.equal(
      normaliseCollegeName("The Indian Institute of Technology, Madras"),
      normaliseCollegeName("indian institute of technology  madras"),
    );
    assert.equal(normaliseCollegeName("R.V. College of Engg & Tech"), "r v college of engg and tech");
  });
});
