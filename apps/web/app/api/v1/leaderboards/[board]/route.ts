import type { NextRequest } from "next/server";
import { PAGE_SIZE } from "@repo/scoring";
import { apiError, apiUser } from "@/lib/api";
import {
  boardPage,
  leaderboardSeason,
  MAX_PAGE,
  parseFilters,
  parsePage,
  phaseOf,
  resolveBoard,
  rowJson,
} from "@/lib/leaderboard";

type Context = { params: Promise<{ board: string }> };

/**
 * GET /api/v1/leaderboards/{board}?page=2&q=&college=<slug>&state=&gradYear=
 * {board}: overall, weekly, mentors, colleges, project:<slug>, college:<slug>. 50 rows a page.
 * While frozen or final, ranks are the snapshot's (`phase` says which).
 */
export async function GET(request: NextRequest, { params }: Context) {
  const { board: ref } = await params;
  const season = await leaderboardSeason();
  if (!season) return apiError(404, "There is no active season.");
  const resolved = await resolveBoard(season, ref);
  if (!resolved) return apiError(404, "No such leaderboard.");
  const search = request.nextUrl.searchParams;
  const page = parsePage(search.get("page"));
  if (page === null) return apiError(400, `page must be a whole number from 1 to ${MAX_PAGE}`);
  const filters = parseFilters((name) => search.get(name));

  const result = await boardPage(season, resolved, filters, page);
  const phase = phaseOf(season);
  const body = JSON.stringify({
    season: { slug: season.slug, name: season.name },
    board: resolved.ref,
    subject: resolved.subject,
    phase: phase.phase,
    phaseSince: phase.phase === "live" ? null : phase.since,
    page: result.page,
    pageSize: PAGE_SIZE,
    pages: result.pages,
    total: result.total,
    boardTotal: result.boardTotal,
    rows: result.rows.map(rowJson),
  });
  // Anonymous reads can be shared by the CDN for a few seconds; signed-in ones aren't cached.
  const user = await apiUser();
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": user ? "private, no-store" : "public, s-maxage=15, stale-while-revalidate=30",
      "X-Leaderboard-Source": result.servedFrom,
    },
  });
}
