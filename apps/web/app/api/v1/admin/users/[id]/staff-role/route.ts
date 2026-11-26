import { setStaffRole } from "@/lib/moderation";
import { apiError, readJson, resultJson, withRole } from "@/lib/rbac";
import { parseStaffRole } from "@/lib/roles";

type Context = RouteContext<"/api/v1/admin/users/[id]/staff-role">;

// PUT /api/v1/admin/users/{id}/staff-role  {"staffRole": "ORGANIZER" | "SUPER_ADMIN" | null}
// Super admins only. null removes the staff role.
export const PUT = withRole("SUPER_ADMIN", async (request, context: Context, { user }) => {
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const value = body.body.staffRole;
  const staffRole = parseStaffRole(value);
  if (value !== null && !staffRole) {
    return apiError(400, 'staffRole must be "ORGANIZER", "SUPER_ADMIN" or null.');
  }
  const { id } = await context.params;
  return resultJson(await setStaffRole(user, id, staffRole));
});
