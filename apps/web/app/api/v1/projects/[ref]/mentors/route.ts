import { apiUser, failure, json, readJson, unauthorized } from "@/lib/api";
import { addMentor } from "@/lib/mentor-service";

type Context = { params: Promise<{ ref: string }> };

/**
 * POST /api/v1/projects/{id}/mentors — attaches a mentor (project admin or organizer).
 * Body: {"githubLogin": "octocat"}. Someone without a Mergio account gets an invite: the row
 * links to them when they sign in, and `inviteUrl` is the sign-up link to send them.
 */
export async function POST(request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if (!read.ok) return read.response;
  const { ref: projectId } = await params;
  const result = await addMentor(user, projectId, read.body.githubLogin);
  if (!result.ok) return failure(result);
  return json({ mentor: result.mentor, inviteUrl: result.inviteUrl }, 201);
}
