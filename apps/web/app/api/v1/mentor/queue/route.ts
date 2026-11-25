import { apiUser, json, unauthorized } from "@/lib/api";
import { mentorQueue } from "@/lib/mentor-dashboard";
import { activeSeason } from "@/lib/projects-server";

/**
 * GET /api/v1/mentor/queue — merged PRs on the projects you mentor or run that still need a
 * mentor's label. `urgent` ones are inside the 72-hour grace window (soonest deadline first).
 */
export async function GET() {
  const user = await apiUser();
  if (!user) return unauthorized();
  const season = await activeSeason();
  if (!season) return json({ season: null, projects: [], pullRequests: [] });
  const { projects, pullRequests } = await mentorQueue(user.id, season);
  return json({
    season: { slug: season.slug, name: season.name },
    projects: projects.map(({ id, slug, name, role }) => ({ id, slug, name, role })),
    pullRequests,
  });
}
