import "server-only";
import { prisma, type Prisma } from "@repo/db";
import { boardPhase, istWeekKey, PAGE_SIZE, type BoardRef } from "@repo/scoring";
import {
  describeRows,
  rankIds,
  readBoard,
  type BoardRow,
  type LeaderboardSeason,
} from "@repo/scoring/server";
import { activeSeason } from "./projects-server";
import { likeText } from "./search";

// The leaderboards as pages and the API see them (F-08): which board a request means, search and
// filters, "jump to me". Ranks always come from the official source (live, frozen or final), the
// same one the dashboard uses.

export type BoardView = "overall" | "weekly" | "project" | "colleges" | "college" | "mentors";
export const BOARD_VIEWS: readonly BoardView[] = ["overall", "weekly", "project", "colleges", "college", "mentors"];

export type ResolvedBoard = {
  view: BoardView;
  board: BoardRef;
  /** The project or college the board is for. */
  subject: { id: string; slug: string; name: string; state?: string } | null;
  /** "{view}" or "{view}:{slug}", as in /api/v1/leaderboards/{board}. */
  ref: string;
};

export type Filters = {
  q: string | null;
  college: string | null;
  state: string | null;
  graduationYear: number | null;
};

export const NO_FILTERS: Filters = { q: null, college: null, state: null, graduationYear: null };

export const hasFilters = (filters: Filters) =>
  Boolean(filters.q || filters.college || filters.state || filters.graduationYear);

/** The week a weekly board shows: this week, or the snapshot's week while frozen or final. */
function currentWeek(season: LeaderboardSeason, now: Date) {
  const phase = boardPhase(season);
  return istWeekKey(phase.phase === "live" ? now : phase.since);
}

/**
 * Parses "overall", "weekly", "mentors", "colleges", "project:<slug>" or "college:<slug>".
 * Null when the board, project or college doesn't exist.
 */
export async function resolveBoard(
  season: LeaderboardSeason & { slug: string },
  ref: string,
  now = new Date(),
): Promise<ResolvedBoard | null> {
  const [view, slug] = ref.includes(":") ? [ref.slice(0, ref.indexOf(":")), ref.slice(ref.indexOf(":") + 1)] : [ref, null];
  switch (view) {
    case "overall":
    case "colleges":
    case "mentors":
      return slug ? null : { view, board: { family: view }, subject: null, ref: view };
    case "weekly":
      return slug ? null : { view, board: { family: "weekly", week: currentWeek(season, now) }, subject: null, ref: view };
    case "project": {
      if (!slug) return null;
      const project = await prisma.project.findUnique({
        where: { seasonId_slug: { seasonId: season.id, slug } },
        select: { id: true, slug: true, name: true, status: true },
      });
      if (!project || project.status !== "APPROVED") return null;
      return {
        view,
        board: { family: "project", projectId: project.id },
        subject: { id: project.id, slug: project.slug, name: project.name },
        ref: `project:${project.slug}`,
      };
    }
    case "college": {
      if (!slug) return null;
      const college = await prisma.college.findUnique({
        where: { slug },
        select: { id: true, slug: true, name: true, state: true },
      });
      if (!college) return null;
      return {
        view,
        board: { family: "college", collegeId: college.id },
        subject: college,
        ref: `college:${college.slug}`,
      };
    }
    default:
      return null;
  }
}

/** Reads ?q=&college=&state=&gradYear= (tolerating junk). */
export function parseFilters(get: (name: string) => string | null | undefined): Filters {
  const text = (name: string, max = 80) => {
    const value = get(name)?.trim();
    return value ? value.slice(0, max) : null;
  };
  const year = Number(get("gradYear"));
  return {
    q: text("q"),
    college: text("college"),
    state: text("state"),
    graduationYear: Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : null,
  };
}

/**
 * Far past any real board (500,000 rows). Without a cap a page like 1e20 overflows Redis' ZRANGE
 * offset, and every such request falls back to a full SQL ranking.
 */
export const MAX_PAGE = 10_000;

/** A ?page= value: 1 when missing, null when it isn't a whole number from 1 to MAX_PAGE. */
export function parsePage(raw: string | null | undefined): number | null {
  if (raw == null || raw === "") return 1;
  if (!/^\d{1,6}$/.test(raw)) return null;
  const page = Number(raw);
  return page >= 1 && page <= MAX_PAGE ? page : null;
}

const MAX_CANDIDATES = 25_000;

/** Ids on this kind of board matching the filters, from Postgres. */
async function candidateIds(seasonId: string, view: BoardView, filters: Filters): Promise<string[]> {
  if (view === "colleges") {
    const where: Prisma.CollegeWhereInput = {
      ...(filters.q ? { name: { contains: likeText(filters.q), mode: "insensitive" } } : {}),
      ...(filters.state ? { state: filters.state } : {}),
      ...(filters.college ? { slug: filters.college } : {}),
    };
    const rows = await prisma.college.findMany({ where, select: { id: true }, take: MAX_CANDIDATES });
    return rows.map((row) => row.id);
  }
  const profile: Prisma.ProfileWhereInput = {
    ...(filters.graduationYear ? { graduationYear: filters.graduationYear } : {}),
    ...(filters.college || filters.state
      ? {
          collegeRecord: {
            ...(filters.college ? { slug: filters.college } : {}),
            ...(filters.state ? { state: filters.state } : {}),
          },
        }
      : {}),
  };
  const where: Prisma.UserWhereInput = {
    ...(filters.q
      ? {
          OR: [
            { name: { contains: likeText(filters.q), mode: "insensitive" } },
            { githubLogin: { contains: likeText(filters.q.replace(/^@/, "")), mode: "insensitive" } },
          ],
        }
      : {}),
    ...(Object.keys(profile).length ? { profile } : {}),
    // Only people with points this season can be on the board, so the candidate cap below is
    // spent on them and not on everyone who ever signed in.
    ...(view === "mentors"
      ? { mentorPoints: { some: { seasonId } } }
      : { scoreEvents: { some: { seasonId } } }),
  };
  const rows = await prisma.user.findMany({ where, select: { id: true }, orderBy: { id: "asc" }, take: MAX_CANDIDATES });
  return rows.map((row) => row.id);
}

export type BoardResult = {
  page: number;
  pages: number;
  total: number;
  /** All ranked entries on the board (the total above is the filtered count when filtering). */
  boardTotal: number;
  rows: BoardRow[];
  servedFrom: "redis" | "postgres";
};

/** One page of a board, filtered or not. Ranks are always positions on the whole board. */
export async function boardPage(
  season: LeaderboardSeason,
  resolved: ResolvedBoard,
  filters: Filters,
  page: number,
  now = new Date(),
): Promise<BoardResult> {
  const offset = (page - 1) * PAGE_SIZE;
  if (!hasFilters(filters)) {
    const result = await readBoard(season, resolved.board, offset, PAGE_SIZE, now);
    return {
      page,
      pages: Math.max(1, Math.ceil(result.total / PAGE_SIZE)),
      total: result.total,
      boardTotal: result.total,
      rows: result.rows,
      servedFrom: result.servedFrom,
    };
  }
  const ids = await candidateIds(season.id, resolved.view, filters);
  const { total: boardTotal, ranked, servedFrom } = await rankIds(season, resolved.board, ids, now);
  const rows = await describeRows(season, resolved.board, ranked.slice(offset, offset + PAGE_SIZE), now);
  return {
    page,
    pages: Math.max(1, Math.ceil(ranked.length / PAGE_SIZE)),
    total: ranked.length,
    boardTotal,
    rows,
    servedFrom,
  };
}

/** The viewer's own row and the page it is on, or null when they aren't ranked on this board. */
export async function myPosition(season: LeaderboardSeason, resolved: ResolvedBoard, userId: string, now = new Date()) {
  // On the colleges board "me" is my college.
  let id = userId;
  if (resolved.view === "colleges") {
    const profile = await prisma.profile.findUnique({ where: { userId }, select: { collegeId: true } });
    if (!profile?.collegeId) return null;
    id = profile.collegeId;
  }
  const { total, ranked } = await rankIds(season, resolved.board, [id], now);
  const mine = ranked[0];
  if (!mine) return { total, row: null, page: null };
  const [row] = await describeRows(season, resolved.board, [mine], now);
  return { total, row: row ?? null, page: Math.ceil(mine.rank / PAGE_SIZE) };
}

/** The active season with what the boards need, or null. */
export async function leaderboardSeason() {
  return activeSeason();
}

/** The banner above every board: frozen or final, and since when. */
export function phaseOf(season: LeaderboardSeason) {
  return boardPhase(season);
}

/** A row as JSON for the API. */
export function rowJson(row: BoardRow) {
  return {
    rank: row.rank,
    change: row.change,
    id: row.id,
    points: row.points,
    pullRequests: { advanced: row.advanced, intermediate: row.intermediate, beginner: row.beginner },
    reachedAt: row.reachedAt,
    ...(row.entity?.kind === "college"
      ? { college: { name: row.entity.name, slug: row.entity.slug, state: row.entity.state, city: row.entity.city } }
      : row.entity?.kind === "user"
        ? {
            user: {
              name: row.entity.name,
              login: row.entity.login,
              avatarUrl: row.entity.image,
              college: row.entity.college
                ? { name: row.entity.college.name, slug: row.entity.college.slug, state: row.entity.college.state }
                : null,
              graduationYear: row.entity.graduationYear,
              badges: row.entity.badges,
            },
          }
        : {}),
  };
}
