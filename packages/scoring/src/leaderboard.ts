import { HOUR_MS } from "./time";

// Leaderboard rules (F-08, PRD §4.7 and §4.8). One ordering for every board in the app, so the
// overall, weekly, project, college, colleges and mentor boards, the dashboard rank and the SQL
// reference can never disagree:
//
//   1. more points
//   2. more advanced PRs
//   3. more intermediate PRs
//   4. reached that total first (the latest effective ledger entry is earliest)
//   5. ascending id (byte order), so no two entries ever share a rank
//
// Mentors have no PR levels, so for them it is points, reached first, then id.

export const PAGE_SIZE = 50;
/** The public board freezes this long before coding ends. */
export const FREEZE_BEFORE_END_MS = 48 * HOUR_MS;

export type BoardRef =
  | { family: "overall" }
  | { family: "weekly"; week: string }
  | { family: "project"; projectId: string }
  | { family: "college"; collegeId: string }
  | { family: "colleges" }
  | { family: "mentors" };

export type BoardFamily = BoardRef["family"];

/** The board's name in keys and snapshots: "overall", "weekly:2026-11-16", "project:<id>", ... */
export function boardKey(board: BoardRef): string {
  switch (board.family) {
    case "overall":
    case "colleges":
    case "mentors":
      return board.family;
    case "weekly":
      return `weekly:${board.week}`;
    case "project":
      return `project:${board.projectId}`;
    case "college":
      return `college:${board.collegeId}`;
  }
}

export function parseBoardKey(key: string): BoardRef | null {
  if (key === "overall" || key === "colleges" || key === "mentors") return { family: key };
  const [family, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
  if (!id || key.indexOf(":") < 0) return null;
  if (family === "weekly" && /^\d{4}-\d{2}-\d{2}$/.test(id)) return { family, week: id };
  if (family === "project") return { family, projectId: id };
  if (family === "college") return { family, collegeId: id };
  return null;
}

/** One entry's standing on a board: a user, or a college on the colleges board. */
export type Standing = {
  id: string;
  points: number;
  advanced: number;
  intermediate: number;
  beginner: number;
  reachedAt: Date;
};

/** The ordering, as a comparator: negative when `a` ranks above `b`. */
export function compareStandings(a: Standing, b: Standing): number {
  return (
    b.points - a.points ||
    b.advanced - a.advanced ||
    b.intermediate - a.intermediate ||
    a.reachedAt.getTime() - b.reachedAt.getTime() ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

// Redis sorted-set members. Every member has score 0, so Redis orders them by their bytes; the
// fixed-width fields below make that byte order exactly compareStandings(). (Packing the keys
// into a float score needs about 56 bits, more than a double holds exactly.)
const POINTS_MAX = 9_999_999_999;
const COUNT_MAX = 999_999;
const pad = (value: number, width: number) => String(value).padStart(width, "0");

/** Only boards' positive totals are ranked; ids must not contain spaces. */
export function encodeMember(standing: Standing): string {
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);
  return [
    pad(POINTS_MAX - clamp(standing.points, POINTS_MAX), 10),
    pad(COUNT_MAX - clamp(standing.advanced, COUNT_MAX), 6),
    pad(COUNT_MAX - clamp(standing.intermediate, COUNT_MAX), 6),
    pad(Math.max(0, standing.reachedAt.getTime()), 13),
    // The space sorts below every id character, so a shorter id that is a prefix of a longer
    // one still sorts first, as it does in compareStandings and in SQL's "C" collation.
    standing.id,
    String(clamp(standing.beginner, COUNT_MAX)),
  ].join(" ");
}

export function decodeMember(member: string): Standing {
  const [points, advanced, intermediate, reachedAt, id, beginner] = member.split(" ");
  return {
    id: id!,
    points: POINTS_MAX - Number(points),
    advanced: COUNT_MAX - Number(advanced),
    intermediate: COUNT_MAX - Number(intermediate),
    reachedAt: new Date(Number(reachedAt)),
    beginner: Number(beginner),
  };
}

// ---------------------------------------------------------------------------
// Freeze and finalize (PRD §4.8)
// ---------------------------------------------------------------------------

export type SeasonBoardState = {
  codingEndsAt: Date | null;
  leaderboardFrozenAt: Date | null;
  leaderboardAutoFreeze: boolean;
  freezeSnapshotId: string | null;
  finalizedAt: Date | null;
  finalSnapshotId: string | null;
};

/**
 * Where every rank shown comes from: the final snapshot once finalized, the freeze snapshot while
 * frozen, otherwise the live ledger. Public boards, /me and the dashboard all use this.
 */
export type BoardPhase =
  | { phase: "live" }
  | { phase: "frozen"; snapshotId: string; since: Date }
  | { phase: "final"; snapshotId: string; since: Date };

export function boardPhase(season: SeasonBoardState): BoardPhase {
  if (season.finalizedAt && season.finalSnapshotId) {
    return { phase: "final", snapshotId: season.finalSnapshotId, since: season.finalizedAt };
  }
  if (season.leaderboardFrozenAt && season.freezeSnapshotId) {
    return { phase: "frozen", snapshotId: season.freezeSnapshotId, since: season.leaderboardFrozenAt };
  }
  return { phase: "live" };
}

/** When the board freezes by itself, or null when coding has no end date yet. */
export function autoFreezeAt(season: Pick<SeasonBoardState, "codingEndsAt">): Date | null {
  return season.codingEndsAt ? new Date(season.codingEndsAt.getTime() - FREEZE_BEFORE_END_MS) : null;
}

/** Whether the worker should freeze the board now. */
export function autoFreezeDue(season: SeasonBoardState, now: Date): boolean {
  const at = autoFreezeAt(season);
  return (
    at !== null &&
    now >= at &&
    season.leaderboardAutoFreeze &&
    !season.leaderboardFrozenAt &&
    !season.finalizedAt
  );
}

// ---------------------------------------------------------------------------
// Colleges
// ---------------------------------------------------------------------------

/**
 * A college name reduced to what matters for matching: "The Indian Institute of Technology,
 * Madras" and "indian institute of technology madras" are the same. Aliases are stored this way.
 */
export function normaliseCollegeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^the /, "")
    .trim()
    .replace(/\s+/g, " ");
}

export function collegeSlug(name: string, city?: string | null): string {
  const base = normaliseCollegeName(city ? `${name} ${city}` : name)
    .replace(/ /g, "-")
    .slice(0, 80)
    .replace(/-+$/, "");
  return base || "college";
}
