import { apiUser, json, unauthorized } from "@/lib/api";
import { contributorStats, isContributor } from "@/lib/contributor";
import { activeSeason } from "@/lib/projects-server";

/** GET /api/v1/me/stats — points, rank, weekly rank, PR counts and badge progress. */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  const season = await activeSeason();
  if (!season) return json({ season: null, contributor: false, stats: null });
  const [contributor, stats] = await Promise.all([
    isContributor(user.id),
    contributorStats(user.id, season),
  ]);
  return json({ season: stats.season, contributor, stats });
}
