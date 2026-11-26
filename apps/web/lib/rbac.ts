import "server-only";
import { getRoles, getSession } from "./dal";
import type { PlatformRole } from "./roles";

// Role checks for /api/v1 route handlers. They authenticate with the same session cookie as
// the site: it is SameSite=Lax, so other sites can't send it along with a POST, and writes
// also need a JSON body, which a cross-site HTML form can't send.

type SessionUser = NonNullable<Awaited<ReturnType<typeof getSession>>>["user"];

export type Viewer = { user: SessionUser; roles: PlatformRole[] };

/** JSON response that is never cached. */
export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export const apiError = (status: number, message: string) =>
  json({ error: { message } }, status);

/**
 * Wraps a route handler so it only runs for a signed-in user who holds `role` (or any
 * signed-in user when `role` is "SIGNED_IN"). Others get 401 (not signed in) or 403.
 *
 *   export const POST = withRole("ORGANIZER", async (request, ctx, viewer) => { ... });
 */
export function withRole<Context>(
  role: PlatformRole | "SIGNED_IN",
  handler: (request: Request, context: Context, viewer: Viewer) => Promise<Response>,
) {
  return async (request: Request, context: Context) => {
    const session = await getSession();
    if (!session) return apiError(401, "Sign in first.");
    const roles = await getRoles();
    if (role !== "SIGNED_IN" && !roles.includes(role)) {
      return apiError(403, "You don't have permission to do this.");
    }
    return handler(request, context, { user: session.user, roles });
  };
}

/** Reads a JSON object body; anything else becomes a 415 or 400 response. */
export async function readJson(
  request: Request,
): Promise<
  { ok: true; body: Record<string, unknown> } | { ok: false; response: Response }
> {
  const type = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!type.startsWith("application/json")) {
    return { ok: false, response: apiError(415, "Send the body as application/json.") };
  }
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { ok: false, response: apiError(400, "The body must be a JSON object.") };
    }
    return { ok: true, body: body as Record<string, unknown> };
  } catch {
    return { ok: false, response: apiError(400, "The body is not valid JSON.") };
  }
}

/** A service result (lib/moderation.ts) as a response: its data, or its error and status. */
export function resultJson<T>(
  result: { ok: true; data: T } | { ok: false; status: number; message: string },
) {
  return result.ok ? json(result.data) : apiError(result.status, result.message);
}
