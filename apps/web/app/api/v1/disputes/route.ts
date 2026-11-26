import { apiError, apiUser, json, readJson, unauthorized } from "@/lib/api";
import { openDispute } from "@/lib/dispute-service";

/**
 * POST /api/v1/disputes — opens a dispute on one of the signed-in contributor's merged PRs.
 * Body: {"pullRequestId", "category", "text", "evidenceUrls"?: string[]}
 */
export async function POST(request: Request) {
  const user = await apiUser();
  if (!user) return unauthorized();
  const read = await readJson(request);
  if (!read.ok) return read.response;
  const result = await openDispute(user.id, {
    ...read.body,
    evidenceUrls: read.body.evidenceUrls ?? [],
  });
  if (!result.ok) {
    const { form, ...fields } = result.errors;
    return apiError(result.status, form ?? "Check the highlighted fields.", {
      ...(Object.keys(fields).length > 0 ? { fields } : {}),
    });
  }
  return json({ dispute: result.dispute }, 201);
}
