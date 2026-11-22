import type { NextRequest } from "next/server";
import { apiError, apiUser, json, unauthorized } from "@/lib/api";
import {
  LEVEL_FILTERS,
  PR_FILTERS,
  contributorPullRequests,
  parseLevelFilter,
  parsePrFilter,
} from "@/lib/contributor";
import { activeSeason } from "@/lib/projects-server";

/**
 * GET /api/v1/me/pull-requests?status=scored&level=advanced&project=<slug>&page=2
 * The signed-in contributor's PRs this season, newest activity first, 25 a page.
 */
export async function GET(request: NextRequest) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const params = request.nextUrl.searchParams;

  const rawStatus = params.get("status");
  const status = parsePrFilter(rawStatus);
  if (rawStatus && !status) {
    return apiError(400, `status must be one of: ${Object.keys(PR_FILTERS).join(", ")}`);
  }
  const rawLevel = params.get("level");
  const level = parseLevelFilter(rawLevel);
  if (rawLevel && !level) {
    return apiError(400, `level must be one of: ${Object.keys(LEVEL_FILTERS).join(", ")}`);
  }
  const page = Number(params.get("page") ?? 1);
  if (!Number.isInteger(page) || page < 1) return apiError(400, "page must be a positive integer");

  const season = await activeSeason();
  if (!season) return json({ season: null, pullRequests: [], page: 1, pageSize: 25, total: 0, pages: 1 });
  const result = await contributorPullRequests(user.id, season, {
    status,
    level,
    project: params.get("project")?.trim() || null,
    page,
  });
  return json({ season: { slug: season.slug, name: season.name }, ...result });
}
