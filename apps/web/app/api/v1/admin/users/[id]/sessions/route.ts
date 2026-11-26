import { revokeSessions } from "@/lib/moderation";
import { resultJson, withRole } from "@/lib/rbac";

type Context = RouteContext<"/api/v1/admin/users/[id]/sessions">;

// DELETE /api/v1/admin/users/{id}/sessions
// Signs the user out on every device without banning them.
export const DELETE = withRole("ORGANIZER", async (_request, context: Context, { user }) => {
  const { id } = await context.params;
  return resultJson(await revokeSessions(user, id));
});
