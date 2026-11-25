import { apiUser, failure, json, readJson, unauthorized } from "@/lib/api";
import { reviewParticipant } from "@/lib/mentor-service";

type Context = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/admin/participants/{registrationId}/review — approves or rejects a mentor or
 * maintainer registration. Body: {"decision": "APPROVED" | "REJECTED"}. The person is emailed.
 */
export async function POST(request: Request, { params }: Context) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if (!read.ok) return read.response;
  const { id } = await params;
  const result = await reviewParticipant(user, id, read.body.decision);
  if (!result.ok) return failure(result);
  return json({ status: result.status });
}
