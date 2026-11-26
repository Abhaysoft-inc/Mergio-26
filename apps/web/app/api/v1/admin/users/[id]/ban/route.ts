import { banUser, unbanUser } from "@/lib/moderation";
import { readJson, resultJson, withRole } from "@/lib/rbac";

type Context = RouteContext<"/api/v1/admin/users/[id]/ban">;

// POST /api/v1/admin/users/{id}/ban  {"reason": "..."}
// Bans the user and deletes all their sessions, so they are signed out on their next request.
export const POST = withRole("ORGANIZER", async (request, context: Context, { user }) => {
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const { id } = await context.params;
  return resultJson(await banUser(user, id, body.body.reason));
});

// DELETE /api/v1/admin/users/{id}/ban
// Lifts the ban. They can sign in again; their old sessions stay deleted.
export const DELETE = withRole("ORGANIZER", async (_request, context: Context, { user }) => {
  const { id } = await context.params;
  return resultJson(await unbanUser(user, id));
});
