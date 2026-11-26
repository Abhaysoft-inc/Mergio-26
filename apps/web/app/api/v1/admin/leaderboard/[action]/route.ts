import { apiError, apiUser, json, readJson, unauthorized } from "@/lib/api";
import { LEADERBOARD_ACTIONS, runLeaderboardAction, type LeaderboardAction } from "@/lib/leaderboard-admin";

type Context = { params: Promise<{ action: string }> };

/**
 * POST /api/v1/admin/leaderboard/{freeze|unfreeze|finalize|unfinalize|rebuild} with a JSON body
 * ({} is fine). Organizers only; unfinalize needs a Super Admin.
 */
export async function POST(request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if (!read.ok) return read.response;
  const { action } = await params;
  if (!(LEADERBOARD_ACTIONS as readonly string[]).includes(action)) return apiError(404, "Not found.");
  const result = await runLeaderboardAction(user, action as LeaderboardAction);
  return result.ok ? json({ ok: true, message: result.message }) : apiError(result.status, result.message);
}
