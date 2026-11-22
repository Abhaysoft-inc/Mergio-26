import { apiError, apiUser, json, readJson, unauthorized } from "@/lib/api";
import { createFlag } from "@/lib/mentor-service";

/**
 * POST /api/v1/flags — flags the author of a PR on one of your projects (mentors, project
 * admins, organizers). Body: {"pullRequestId", "category", "note"}; category is SPAM,
 * PLAGIARISM, LOW_QUALITY_AI, MULTIPLE_ACCOUNTS or OTHER.
 */
export async function POST(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if (!read.ok) return read.response;
  const result = await createFlag(user, read.body);
  if (!result.ok) {
    const { form, ...fields } = result.errors;
    return apiError(result.status, form ?? "Check the highlighted fields.", {
      ...(Object.keys(fields).length > 0 ? { fields } : {}),
    });
  }
  return json({ flag: result.flag }, 201);
}
