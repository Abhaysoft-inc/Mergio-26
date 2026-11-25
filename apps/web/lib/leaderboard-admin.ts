import "server-only";
import {
  freezeLeaderboard,
  finalizeLeaderboard,
  invalidateLiveBoards,
  LeaderboardStateError,
  liveBoardsOf,
  unfinalizeLeaderboard,
  unfreezeLeaderboard,
} from "@repo/scoring/server";
import { activeSeason } from "./projects-server";

// Organizer actions on the leaderboard (PRD §4.8), shared by /admin/leaderboard and the API.

export const LEADERBOARD_ACTIONS = ["freeze", "unfreeze", "finalize", "unfinalize", "rebuild"] as const;
export type LeaderboardAction = (typeof LEADERBOARD_ACTIONS)[number];

type Actor = { id: string; isAdmin?: boolean | null; isSuperAdmin?: boolean | null };

export type ActionResult = { ok: true; message: string } | { ok: false; status: 403 | 404 | 409; message: string };

export async function runLeaderboardAction(actor: Actor, action: LeaderboardAction): Promise<ActionResult> {
  if (actor.isAdmin !== true) return { ok: false, status: 404, message: "Not found." };
  if (action === "unfinalize" && actor.isSuperAdmin !== true) {
    return { ok: false, status: 403, message: "Only a Super Admin can unfinalize the leaderboard." };
  }
  const season = await activeSeason();
  if (!season) return { ok: false, status: 409, message: "There is no active season." };
  try {
    switch (action) {
      case "freeze":
        await freezeLeaderboard(season.id, actor.id);
        return { ok: true, message: "Frozen. The public board and everyone's rank now show this moment." };
      case "unfreeze":
        await unfreezeLeaderboard(season.id);
        return { ok: true, message: "Unfrozen. Live ranks are back, and it won't freeze by itself again." };
      case "finalize":
        await finalizeLeaderboard(season.id, actor.id);
        return { ok: true, message: "Finalized. The ledger is locked and these ranks are official." };
      case "unfinalize":
        await unfinalizeLeaderboard(season.id);
        return { ok: true, message: "Unfinalized. The ledger is open again." };
      case "rebuild":
        await invalidateLiveBoards(season.id, await liveBoardsOf(season.id));
        return { ok: true, message: "Live boards will rebuild from Postgres on their next read." };
    }
  } catch (error) {
    if (error instanceof LeaderboardStateError) return { ok: false, status: 409, message: error.message };
    throw error;
  }
}
