import { prisma } from "@repo/db";
import { getUserRegistrations } from "@/lib/dal";
import { json, withRole } from "@/lib/rbac";
import { parseStaffRole } from "@/lib/roles";

// GET /api/v1/me
// The signed-in person: identity, roles and registrations. 401 when signed out.
export const GET = withRole("SIGNED_IN", async (_request, _context, { user, roles }) => {
  const [account, registrations] = await Promise.all([
    prisma.account.findFirst({
      where: { userId: user.id, providerId: "github" },
      select: { accountId: true },
    }),
    getUserRegistrations(user.id),
  ]);

  return json({
    id: user.id,
    // GitHub's numeric user ID, as a string. It never changes, unlike githubLogin.
    githubId: account?.accountId ?? null,
    githubLogin: user.githubLogin ?? null,
    name: user.name,
    email: user.email,
    image: user.image ?? null,
    staffRole: parseStaffRole(user.staffRole),
    roles,
    registrations,
    createdAt: user.createdAt,
  });
});
