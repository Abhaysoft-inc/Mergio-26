import type { NextRequest } from "next/server";
import { apiError, apiUser, json, unauthorized } from "@/lib/api";
import { contributorLedger } from "@/lib/contributor";
import { activeSeason } from "@/lib/projects-server";

/**
 * GET /api/v1/me/score-events?page=2 — the signed-in contributor's points ledger this season,
 * newest first. `held` entries were cut by the daily cap and count from `effectiveAt`.
 */
export async function GET(request: NextRequest) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const page = Number(request.nextUrl.searchParams.get("page") ?? 1);
  if (!Number.isInteger(page) || page < 1) return apiError(400, "page must be a positive integer");
  const season = await activeSeason();
  if (!season) return json({ season: null, entries: [], page: 1, pageSize: 25, total: 0, pages: 1 });
  const result = await contributorLedger(user.id, season, { page });
  return json({ season: { slug: season.slug, name: season.name }, ...result });
}
