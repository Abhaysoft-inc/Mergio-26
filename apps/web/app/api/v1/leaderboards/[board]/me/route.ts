import { PAGE_SIZE } from "@repo/scoring";
import { apiError, apiUser, json, unauthorized } from "@/lib/api";
import { leaderboardSeason, myPosition, phaseOf, resolveBoard, rowJson } from "@/lib/leaderboard";

type Context = { params: Promise<{ board: string }> };

/**
 * GET /api/v1/leaderboards/{board}/me — your row and the page it is on ("jump to me"). On the
 * colleges board, your college's row. `row` is null when you aren't ranked on this board.
 */
export async function GET(_request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { board: ref } = await params;
  const season = await leaderboardSeason();
  if (!season) return apiError(404, "There is no active season.");
  const resolved = await resolveBoard(season, decodeURIComponent(ref));
  if (!resolved) return apiError(404, "No such leaderboard.");
  const position = await myPosition(season, resolved, user.id);
  const phase = phaseOf(season);
  return json({
    board: resolved.ref,
    phase: phase.phase,
    pageSize: PAGE_SIZE,
    total: position?.total ?? 0,
    page: position?.page ?? null,
    row: position?.row ? rowJson(position.row) : null,
  });
}
