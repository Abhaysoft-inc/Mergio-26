import { randomUUID } from "node:crypto";
import { prisma } from "@repo/db";
import {
  boardKey,
  boardPhase,
  decodeMember,
  encodeMember,
  type BoardRef,
  type SeasonBoardState,
  type Standing,
} from "../../leaderboard";
import { istDay, istDayStart, istWeekKey } from "../../time";
import { loadEntities, type EntityInfo } from "./entities";
import { boardRowsSql, collegeTotalSql, projectsOfUser, type RankedRow } from "./sql";
import { kv, type Kv } from "./store";

// Leaderboards served from Redis sorted sets (F-08). Postgres stays the source of truth: a board
// missing from Redis is rebuilt from the SQL in ./sql.ts, a frozen or final board is loaded from
// its snapshot, and each ledger change re-reads the affected user's standing from SQL and swaps
// their one entry. Every read falls back to Postgres if Redis is unset or failing.

export type LeaderboardSeason = SeasonBoardState & { id: string };

/** Where a board's entries come from: the live ledger or a stored snapshot. */
export type Source = { kind: "live" } | { kind: "snapshot"; snapshotId: string };

export function sourceOf(season: LeaderboardSeason): Source {
  const phase = boardPhase(season);
  return phase.phase === "live" ? { kind: "live" } : { kind: "snapshot", snapshotId: phase.snapshotId };
}

const DAY_S = 86_400;

function keysOf(seasonId: string, source: Source, board: BoardRef) {
  const base =
    source.kind === "live"
      ? `lb:v1:${seasonId}:live:${boardKey(board)}`
      : `lb:v1:${seasonId}:snap:${source.snapshotId}:${boardKey(board)}`;
  return {
    z: `${base}:z`,
    idx: `${base}:idx`,
    built: `${base}:built`,
    lock: `${base}:lock`,
    dirty: `${base}:dirty`,
    // Live weekly boards go once the week is long over; snapshots reload from Postgres anyway.
    ttl: source.kind === "snapshot" ? 7 * DAY_S : board.family === "weekly" ? 21 * DAY_S : 0,
  };
}

const entitiesKey = (seasonId: string) => `lb:v1:${seasonId}:entities`;
/**
 * user id -> the college whose live board they are on. Written whenever a college board is built
 * or a user's entry changes, so a user who switches college is taken off the old board.
 */
const memberCollegeKey = (seasonId: string) => `lb:v1:${seasonId}:live:member-college`;
const prevKey = (seasonId: string, board: BoardRef, day: string) =>
  `lb:v1:${seasonId}:prev:${day}:${boardKey(board)}`;

// ---------------------------------------------------------------------------
// Lua scripts (each one atomic)
// ---------------------------------------------------------------------------

const ID_PATTERN = "^%S+ %S+ %S+ %S+ (%S+)";

/** KEYS z, built, entities, prev; ARGV start, stop, wantPrev. */
const READ_PAGE = `
if redis.call('EXISTS', KEYS[2]) == 0 then return {0} end
local total = redis.call('ZCARD', KEYS[1])
local members = redis.call('ZRANGE', KEYS[1], ARGV[1], ARGV[2])
local ids = {}
for i, m in ipairs(members) do ids[i] = string.match(m, '${ID_PATTERN}') end
local info = {}
local prev = {}
local prevBuilt = 0
if #ids > 0 then info = redis.call('HMGET', KEYS[3], unpack(ids)) end
if ARGV[3] == '1' and redis.call('HEXISTS', KEYS[4], '_') == 1 then
  prevBuilt = 1
  if #ids > 0 then prev = redis.call('HMGET', KEYS[4], unpack(ids)) end
end
return {1, total, members, info, prevBuilt, prev}
`;

/** KEYS z, idx, built; ARGV ids. Returns {built, total, {id, member, rank0}...}. */
const RANKS = `
if redis.call('EXISTS', KEYS[3]) == 0 then return {0} end
local out = {}
for i = 1, #ARGV do
  local m = redis.call('HGET', KEYS[2], ARGV[i])
  if m then
    local r = redis.call('ZRANK', KEYS[1], m)
    if r then out[#out + 1] = {ARGV[i], m, r} end
  end
end
return {1, redis.call('ZCARD', KEYS[1]), out}
`;

/** KEYS entities, prev; ARGV wantPrev, ids... */
const INFO = `
local ids = {}
for i = 2, #ARGV do ids[#ids + 1] = ARGV[i] end
local info = {}
local prev = {}
local prevBuilt = 0
if #ids > 0 then info = redis.call('HMGET', KEYS[1], unpack(ids)) end
if ARGV[1] == '1' and redis.call('HEXISTS', KEYS[2], '_') == 1 then
  prevBuilt = 1
  if #ids > 0 then prev = redis.call('HMGET', KEYS[2], unpack(ids)) end
end
return {info, prevBuilt, prev}
`;

/**
 * KEYS z, idx, built, dirty; ARGV id, member ('' removes). Marks the id dirty first, so a rebuild
 * that read Postgres before this change re-reads it afterwards.
 */
const REPLACE = `
redis.call('SADD', KEYS[4], ARGV[1])
redis.call('EXPIRE', KEYS[4], 900)
if redis.call('EXISTS', KEYS[3]) == 0 then return 0 end
local old = redis.call('HGET', KEYS[2], ARGV[1])
if old then redis.call('ZREM', KEYS[1], old) end
if ARGV[2] ~= '' then
  redis.call('ZADD', KEYS[1], 0, ARGV[2])
  redis.call('HSET', KEYS[2], ARGV[1], ARGV[2])
else
  redis.call('HDEL', KEYS[2], ARGV[1])
end
return 1
`;

/**
 * KEYS tmpZ, tmpIdx, z, idx, built, lock; ARGV builtValue, ttl, token. Swaps a finished build in,
 * unless the build's lock expired and another build took over: then that one's rows win (it read
 * Postgres later), and this returns 0.
 */
const SWAP = `
if redis.call('GET', KEYS[6]) ~= ARGV[3] then return 0 end
if redis.call('EXISTS', KEYS[1]) == 1 then redis.call('RENAME', KEYS[1], KEYS[3]) else redis.call('DEL', KEYS[3]) end
if redis.call('EXISTS', KEYS[2]) == 1 then redis.call('RENAME', KEYS[2], KEYS[4]) else redis.call('DEL', KEYS[4]) end
redis.call('SET', KEYS[5], ARGV[1])
local ttl = tonumber(ARGV[2])
if ttl > 0 then
  redis.call('EXPIRE', KEYS[3], ttl)
  redis.call('EXPIRE', KEYS[4], ttl)
  redis.call('EXPIRE', KEYS[5], ttl)
end
return 1
`;

/** KEYS lock; ARGV token. Releases the lock only if it is still ours. */
const UNLOCK = `
if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1]) end
return 1
`;

const TAKE_DIRTY = `
local ids = redis.call('SMEMBERS', KEYS[1])
redis.call('DEL', KEYS[1])
return ids
`;

const ALL = `return redis.call('ZRANGE', KEYS[1], 0, -1)`;

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const CHUNK = 1_000;

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** A board's ranked entries from Postgres: the ledger, or the snapshot. */
export async function sourceRows(
  seasonId: string,
  source: Source,
  board: BoardRef,
  now = new Date(),
  users?: string[],
): Promise<RankedRow[]> {
  if (source.kind === "live") return boardRowsSql(seasonId, board, now, users);
  const entries = await prisma.leaderboardSnapshotEntry.findMany({
    where: {
      snapshotId: source.snapshotId,
      board: boardKey(board),
      ...(users ? { entityId: { in: users } } : {}),
    },
    orderBy: { rank: "asc" },
  });
  return entries.map((entry) => ({
    partition: "",
    id: entry.entityId,
    points: entry.points,
    advanced: entry.advanced,
    intermediate: entry.intermediate,
    beginner: entry.beginner,
    reachedAt: entry.reachedAt,
    rank: entry.rank,
  }));
}

/** Rebuilds one board in Redis from Postgres. False when another process is already doing it. */
export async function rebuildBoard(
  store: Kv,
  seasonId: string,
  source: Source,
  board: BoardRef,
): Promise<boolean> {
  const keys = keysOf(seasonId, source, board);
  const token = randomUUID();
  if (!(await store.setNx(keys.lock, token, 60_000))) return false;
  const tmp = `${keys.z}:tmp:${token}`;
  const tmpIdx = `${keys.idx}:tmp:${token}`;
  try {
    // Changes from here on are marked dirty and re-read after the swap.
    await store.del([keys.dirty]);
    const rows = await sourceRows(seasonId, source, board);
    const members = rows.map((row) => [row.id, encodeMember(row)] as const);
    for (const [index, part] of chunks(members).entries()) {
      await store.zaddZero(tmp, part.map(([, member]) => member));
      await store.hset(tmpIdx, Object.fromEntries(part));
      // If this process dies half way, the temporary keys go away by themselves.
      if (index === 0) await Promise.all([store.expire(tmp, 600), store.expire(tmpIdx, 600)]);
    }
    const swapped = await store.eval<number>(
      SWAP,
      [tmp, tmpIdx, keys.z, keys.idx, keys.built, keys.lock],
      [new Date().toISOString(), keys.ttl, token],
    );
    if (Number(swapped) !== 1) return false;

    if (source.kind === "live" && board.family === "college") {
      for (const part of chunks(rows)) {
        await store.hset(memberCollegeKey(seasonId), Object.fromEntries(part.map((row) => [row.id, board.collegeId])));
      }
    }
    if (source.kind === "live") {
      const dirty = await store.eval<string[]>(TAKE_DIRTY, [keys.dirty], []);
      for (const id of dirty ?? []) await replaceEntry(store, seasonId, board, id);
    }
    return true;
  } finally {
    // After a swap the tmp keys are gone already; after a failure they'd otherwise linger.
    await store.del([tmp, tmpIdx]);
    await store.eval(UNLOCK, [keys.lock], [token]);
  }
}

/** Re-reads one entry of a live board from Postgres and swaps it in (or out). */
async function replaceEntry(store: Kv, seasonId: string, board: BoardRef, id: string, now = new Date()) {
  const keys = keysOf(seasonId, { kind: "live" }, board);
  const [row] =
    board.family === "colleges"
      ? [await collegeTotalSql(seasonId, id, now)].filter((value) => value !== null)
      : await boardRowsSql(seasonId, board, now, [id]);
  await store.eval(REPLACE, [keys.z, keys.idx, keys.built, keys.dirty], [id, row ? encodeMember(row) : ""]);
}

/** Waits for a board that another process is building; false if it isn't ready in time. */
async function ensureBuilt(store: Kv, seasonId: string, source: Source, board: BoardRef) {
  if (await rebuildBoard(store, seasonId, source, board)) return true;
  const keys = keysOf(seasonId, source, board);
  for (let i = 0; i < 30; i++) {
    await sleep(100);
    const state = await store.eval<number[]>(`return {redis.call('EXISTS', KEYS[1])}`, [keys.built], []);
    if (state?.[0] === 1) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Yesterday's ranks (the rank-change column)
// ---------------------------------------------------------------------------

/**
 * Ranks as of today's 00:00 IST, computed from the ledger once a day per board. On a weekly board
 * that is empty on Mondays, so the first day of a week shows no change.
 */
async function buildPrev(store: Kv, seasonId: string, board: BoardRef, now: Date) {
  const day = istDay(now);
  const key = prevKey(seasonId, board, day);
  if (!(await store.setNx(`${key}:lock`, "1", 60_000))) return;
  try {
    const rows = await boardRowsSql(seasonId, board, istDayStart(day));
    for (const part of chunks(rows)) {
      await store.hset(key, Object.fromEntries(part.map((row) => [row.id, String(row.rank)])));
    }
    // The marker goes last, so a half-written hash is never read as complete.
    await store.hset(key, { _: "1" });
    await store.expire(key, 2 * DAY_S);
  } finally {
    await store.del([`${key}:lock`]);
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type BoardRow = Standing & {
  rank: number;
  /** Positive when the entry moved up since 00:00 IST today; null when unknown or new. */
  change: number | null;
  entity: EntityInfo | null;
};

export type BoardPage = {
  total: number;
  rows: BoardRow[];
  /** "redis" normally; "postgres" when Redis is unset or failing. */
  servedFrom: "redis" | "postgres";
};

const parseInfo = (value: string | null | undefined): EntityInfo | null => {
  if (!value) return null;
  try {
    return JSON.parse(value) as EntityInfo;
  } catch {
    return null;
  }
};

/** Fills in display data Redis doesn't have yet. */
async function fillEntities(store: Kv | null, seasonId: string, rows: BoardRow[]) {
  const missing = rows.filter((row) => !row.entity).map((row) => row.id);
  if (missing.length === 0) return;
  const loaded = await loadEntities(seasonId, missing);
  for (const row of rows) row.entity ??= loaded.get(row.id) ?? null;
  if (store && loaded.size > 0) {
    await store
      .hset(entitiesKey(seasonId), Object.fromEntries([...loaded].map(([id, info]) => [id, JSON.stringify(info)])))
      .catch(() => undefined);
  }
}

const toChange = (prevRank: number | null, rank: number) =>
  prevRank === null || Number.isNaN(prevRank) ? null : prevRank - rank;

/** One page of a board (0-based offset), with display data and yesterday's ranks. */
export async function readBoard(
  season: LeaderboardSeason,
  board: BoardRef,
  offset: number,
  limit: number,
  now = new Date(),
): Promise<BoardPage> {
  const source = sourceOf(season);
  const store = kv();
  const wantPrev = source.kind === "live";
  if (store) {
    try {
      const keys = keysOf(season.id, source, board);
      const prev = prevKey(season.id, board, istDay(now));
      const run = () =>
        store.eval<[number, number, string[], (string | null)[], number, (string | null)[]]>(
          READ_PAGE,
          [keys.z, keys.built, entitiesKey(season.id), prev],
          [offset, offset + limit - 1, wantPrev ? "1" : "0"],
        );
      let result = await run();
      if (result[0] !== 1) {
        if (!(await ensureBuilt(store, season.id, source, board))) throw new Error("board still building");
        result = await run();
      }
      const [, total, members, info, prevBuilt, prevRanks] = result;
      if (wantPrev && prevBuilt !== 1) await buildPrev(store, season.id, board, now);
      const rows: BoardRow[] = (members ?? []).map((member, index) => ({
        ...decodeMember(member),
        rank: offset + index + 1,
        change: prevBuilt === 1 ? toChange(prevRanks?.[index] ? Number(prevRanks[index]) : null, offset + index + 1) : null,
        entity: parseInfo(info?.[index]),
      }));
      await fillEntities(store, season.id, rows);
      return { total: Number(total), rows, servedFrom: "redis" };
    } catch (error) {
      console.error(`Leaderboard ${boardKey(board)} from Redis failed; using Postgres`, error);
    }
  }
  const all = await sourceRows(season.id, source, board, now);
  const rows: BoardRow[] = all
    .slice(offset, offset + limit)
    .map((row) => ({ ...row, change: null, entity: null }));
  await fillEntities(null, season.id, rows);
  return { total: all.length, rows, servedFrom: "postgres" };
}

export type RankedEntity = Standing & { rank: number };

/** The ranks of particular ids on a board (search results, filters, "me"). Unranked ids are left out. */
export async function rankIds(
  season: LeaderboardSeason,
  board: BoardRef,
  ids: string[],
  now = new Date(),
): Promise<{ total: number; ranked: RankedEntity[]; servedFrom: "redis" | "postgres" }> {
  const source = sourceOf(season);
  const store = kv();
  if (store) {
    try {
      const keys = keysOf(season.id, source, board);
      let total = 0;
      const ranked: RankedEntity[] = [];
      for (const part of chunks(ids, 5_000)) {
        const run = () => store.eval<[number, number, [string, string, number][]]>(RANKS, [keys.z, keys.idx, keys.built], part);
        let result = await run();
        if (result[0] !== 1) {
          if (!(await ensureBuilt(store, season.id, source, board))) throw new Error("board still building");
          result = await run();
        }
        total = Number(result[1]);
        for (const [, member, rank] of result[2] ?? []) ranked.push({ ...decodeMember(member), rank: Number(rank) + 1 });
      }
      if (ids.length === 0) {
        const result = await store.eval<[number, number]>(RANKS, [keys.z, keys.idx, keys.built], []);
        if (result[0] === 1) total = Number(result[1]);
        else if (await ensureBuilt(store, season.id, source, board)) {
          total = Number((await store.eval<[number, number]>(RANKS, [keys.z, keys.idx, keys.built], []))[1]);
        }
      }
      return { total, ranked: ranked.sort((a, b) => a.rank - b.rank), servedFrom: "redis" };
    } catch (error) {
      console.error(`Leaderboard ${boardKey(board)} ranks from Redis failed; using Postgres`, error);
    }
  }
  const all = await sourceRows(season.id, source, board, now);
  const wanted = new Set(ids);
  return { total: all.length, ranked: all.filter((row) => wanted.has(row.id)), servedFrom: "postgres" };
}

/** Display data and yesterday's ranks for rows found with rankIds(). */
export async function describeRows(
  season: LeaderboardSeason,
  board: BoardRef,
  ranked: RankedEntity[],
  now = new Date(),
): Promise<BoardRow[]> {
  const rows: BoardRow[] = ranked.map((row) => ({ ...row, change: null, entity: null }));
  const store = kv();
  const wantPrev = sourceOf(season).kind === "live";
  if (store && rows.length > 0) {
    try {
      const prev = prevKey(season.id, board, istDay(now));
      const [info, prevBuilt, prevRanks] = await store.eval<[(string | null)[], number, (string | null)[]]>(
        INFO,
        [entitiesKey(season.id), prev],
        [wantPrev ? "1" : "0", ...rows.map((row) => row.id)],
      );
      rows.forEach((row, index) => {
        row.entity = parseInfo(info?.[index]);
        if (prevBuilt === 1) row.change = toChange(prevRanks?.[index] ? Number(prevRanks[index]) : null, row.rank);
      });
    } catch (error) {
      console.error("Leaderboard display data from Redis failed", error);
    }
  }
  await fillEntities(store, season.id, rows);
  return rows;
}

// ---------------------------------------------------------------------------
// Keeping live boards current
// ---------------------------------------------------------------------------

/** The live boards a contributor appears on, given their projects and college. */
async function userBoards(seasonId: string, userId: string, now: Date): Promise<BoardRef[]> {
  const week = istWeekKey(now);
  // Late scoring (a label added after the weekend) can land in last week's board too.
  const lastWeek = istWeekKey(new Date(now.getTime() - 7 * DAY_S * 1000));
  const projects = await projectsOfUser(seasonId, userId);
  return [
    { family: "overall" },
    { family: "weekly", week },
    { family: "weekly", week: lastWeek },
    ...projects.map((projectId) => ({ family: "project" as const, projectId })),
  ];
}

/**
 * Re-reads a contributor's standing on every live board they are on and swaps their entries.
 * Returns the colleges whose totals changed, for refreshCollege().
 */
export async function refreshUser(seasonId: string, userId: string, now = new Date()): Promise<string[]> {
  const store = kv();
  if (!store) return [];
  const [boards, entities] = await Promise.all([
    userBoards(seasonId, userId, now),
    loadEntities(seasonId, [userId]),
  ]);
  const info = entities.get(userId);
  const current = info?.kind === "user" ? (info.college?.id ?? null) : null;

  // The college board they are on now, if it differs from their profile, loses them.
  const previous =
    (
      await store.eval<(string | null)[]>(`return redis.call('HMGET', KEYS[1], ARGV[1])`, [memberCollegeKey(seasonId)], [
        userId,
      ])
    )?.[0] ?? null;

  for (const board of boards) await replaceEntry(store, seasonId, board, userId, now);
  if (current) await replaceEntry(store, seasonId, { family: "college", collegeId: current }, userId, now);
  if (previous && previous !== current) {
    const keys = keysOf(seasonId, { kind: "live" }, { family: "college", collegeId: previous });
    await store.eval(REPLACE, [keys.z, keys.idx, keys.built, keys.dirty], [userId, ""]);
  }
  if (current) await store.hset(memberCollegeKey(seasonId), { [userId]: current });
  else if (previous) await store.eval(`return redis.call('HDEL', KEYS[1], ARGV[1])`, [memberCollegeKey(seasonId)], [userId]);
  if (info) await store.hset(entitiesKey(seasonId), { [userId]: JSON.stringify(info) });
  return [...new Set([current, previous].filter((id): id is string => id !== null))];
}

/** Re-reads one college's total on the live colleges board. */
export async function refreshCollege(seasonId: string, collegeId: string, now = new Date()) {
  const store = kv();
  if (!store) return;
  await replaceEntry(store, seasonId, { family: "colleges" }, collegeId, now);
  const info = (await loadEntities(seasonId, [collegeId])).get(collegeId);
  if (info) await store.hset(entitiesKey(seasonId), { [collegeId]: JSON.stringify(info) });
}

/** Re-reads one mentor's entry on the live mentor board. */
export async function refreshMentor(seasonId: string, userId: string, now = new Date()) {
  const store = kv();
  if (!store) return;
  await replaceEntry(store, seasonId, { family: "mentors" }, userId, now);
  const info = (await loadEntities(seasonId, [userId])).get(userId);
  if (info) await store.hset(entitiesKey(seasonId), { [userId]: JSON.stringify(info) });
}

/** Drops every cached board of a season so the next read rebuilds it (organizer "Rebuild now"). */
export async function invalidateLiveBoards(seasonId: string, boards: BoardRef[]) {
  const store = kv();
  if (!store) return;
  await store.del(boards.map((board) => keysOf(seasonId, { kind: "live" }, board).built));
  await store.del([entitiesKey(seasonId), memberCollegeKey(seasonId)]);
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export type Verification = {
  board: string;
  ok: boolean;
  redisCount: number;
  sqlCount: number;
  /** The first few differences, as "rank N: redis <id> vs sql <id>". */
  differences: string[];
};

/** Compares a live Redis board with a fresh SQL computation, entry by entry. */
export async function verifyBoard(seasonId: string, board: BoardRef, now = new Date()): Promise<Verification> {
  const store = kv();
  const sql = await boardRowsSql(seasonId, board, now);
  if (!store) {
    return { board: boardKey(board), ok: true, redisCount: sql.length, sqlCount: sql.length, differences: [] };
  }
  const keys = keysOf(seasonId, { kind: "live" }, board);
  const built = await store.eval<number[]>(`return {redis.call('EXISTS', KEYS[1])}`, [keys.built], []);
  if (built?.[0] !== 1) await ensureBuilt(store, seasonId, { kind: "live" }, board);
  const members = (await store.eval<string[]>(ALL, [keys.z], [])) ?? [];
  const redis = members.map(decodeMember);
  const differences: string[] = [];
  const length = Math.max(redis.length, sql.length);
  for (let i = 0; i < length && differences.length < 10; i++) {
    const a = redis[i];
    const b = sql[i];
    const same =
      a &&
      b &&
      a.id === b.id &&
      a.points === b.points &&
      a.advanced === b.advanced &&
      a.intermediate === b.intermediate &&
      a.beginner === b.beginner &&
      a.reachedAt.getTime() === b.reachedAt.getTime() &&
      b.rank === i + 1;
    if (!same) {
      differences.push(
        `rank ${i + 1}: redis ${a ? `${a.id} (${a.points})` : "none"} vs sql ${b ? `${b.id} (${b.points})` : "none"}`,
      );
    }
  }
  return {
    board: boardKey(board),
    ok: differences.length === 0,
    redisCount: redis.length,
    sqlCount: sql.length,
    differences,
  };
}

/** Every live board of a season, for verification and rebuilds. */
export async function liveBoardsOf(seasonId: string, now = new Date()): Promise<BoardRef[]> {
  const [projects, colleges] = await Promise.all([
    prisma.project.findMany({ where: { seasonId, status: "APPROVED" }, select: { id: true } }),
    prisma.profile.findMany({
      where: { collegeId: { not: null } },
      select: { collegeId: true },
      distinct: ["collegeId"],
    }),
  ]);
  return [
    { family: "overall" },
    { family: "weekly", week: istWeekKey(now) },
    { family: "colleges" },
    { family: "mentors" },
    ...projects.map((project) => ({ family: "project" as const, projectId: project.id })),
    ...colleges.map((profile) => ({ family: "college" as const, collegeId: profile.collegeId! })),
  ];
}

/** Forces a rebuild of one live board now. */
export async function rebuildLiveBoard(seasonId: string, board: BoardRef) {
  const store = kv();
  if (!store) return false;
  return rebuildBoard(store, seasonId, { kind: "live" }, board);
}

// ---------------------------------------------------------------------------
// The official standing (what every page shows)
// ---------------------------------------------------------------------------

/**
 * A contributor's official overall and weekly rank: live normally, the snapshot's while frozen or
 * final (then "this week" is the week the snapshot was taken). Points are shown live elsewhere;
 * there is no separate private rank.
 */
export async function officialStanding(season: LeaderboardSeason, userId: string, now = new Date()) {
  const phase = boardPhase(season);
  const weekOf = phase.phase === "live" ? now : phase.since;
  const weekly: BoardRef = { family: "weekly", week: istWeekKey(weekOf) };
  const [overall, week] = await Promise.all([
    rankIds(season, { family: "overall" }, [userId], now),
    rankIds(season, weekly, [userId], now),
  ]);
  return {
    phase: phase.phase,
    rank: overall.ranked[0]?.rank ?? null,
    rankedContributors: overall.total,
    weeklyRank: week.ranked[0]?.rank ?? null,
  };
}
