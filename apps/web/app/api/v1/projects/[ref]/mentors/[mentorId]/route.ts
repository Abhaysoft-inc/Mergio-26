import { apiUser, failure, unauthorized } from "@/lib/api";
import { removeMentor } from "@/lib/mentor-service";

type Context = { params: Promise<{ ref: string; mentorId: string }> };

/** DELETE /api/v1/projects/{id}/mentors/{mentorId} — removes a mentor; their access ends at once. */
export async function DELETE(_request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const { ref: projectId, mentorId } = await params;
  const result = await removeMentor(user, projectId, mentorId);
  if (!result.ok) return failure(result);
  return new Response(null, { status: 204 });
}
