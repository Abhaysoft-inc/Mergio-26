import "server-only";
import { prisma } from "@repo/db";
import { isOrganizer, isSuperAdmin, type StaffRoleName } from "./roles";

// Banning, session revocation and staff roles. Each function checks the actor's permission
// itself, so API routes, server actions and scripts all get the same rules.
//
// Rules:
// - Organizers (and super admins) can ban, unban and sign out regular users.
// - Only super admins can do that to an organizer, and nobody can to a super admin:
//   demote them first. Nobody can act on themselves, so staff can't lock themselves out.
// - Only super admins can change staff roles.

type Actor = { id: string; staffRole?: unknown };

export type ModerationResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string };

const fail = (status: number, message: string) =>
  ({ ok: false, status, message }) as const;

export const BAN_REASON_MAX = 500;

/** Loads the target and checks that `actor` may moderate them. */
async function moderatable(actor: Actor, targetId: string) {
  if (!isOrganizer(actor)) return fail(403, "Only organizers can do this.");
  if (actor.id === targetId) return fail(400, "You can't do this to your own account.");
  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, staffRole: true, bannedAt: true },
  });
  if (!target) return fail(404, "No user with that ID.");
  if (target.staffRole === "SUPER_ADMIN") {
    return fail(403, "Super admins can't be moderated. Remove their staff role first.");
  }
  if (target.staffRole === "ORGANIZER" && !isSuperAdmin(actor)) {
    return fail(403, "Only super admins can moderate organizers.");
  }
  return { ok: true, target } as const;
}

/**
 * Bans a user and deletes all their sessions in one transaction, so they are signed out on
 * their next request, and the sign-in hook in lib/auth.ts stops them signing back in.
 */
export async function banUser(
  actor: Actor,
  targetId: string,
  reason: unknown,
): Promise<ModerationResult<{ bannedAt: Date; revokedSessions: number }>> {
  const text = typeof reason === "string" ? reason.trim() : "";
  if (!text) return fail(400, "Give a reason for the ban.");
  if (text.length > BAN_REASON_MAX) {
    return fail(400, `Keep the reason under ${BAN_REASON_MAX} characters.`);
  }

  const check = await moderatable(actor, targetId);
  if (!check.ok) return check;

  // Banning someone who is already banned updates the reason but keeps the original date.
  const bannedAt = check.target.bannedAt ?? new Date();
  const [, revoked] = await prisma.$transaction([
    prisma.user.update({
      where: { id: targetId },
      data: { bannedAt, banReason: text },
    }),
    prisma.session.deleteMany({ where: { userId: targetId } }),
  ]);
  return { ok: true, data: { bannedAt, revokedSessions: revoked.count } };
}

export async function unbanUser(
  actor: Actor,
  targetId: string,
): Promise<ModerationResult<{ unbanned: boolean }>> {
  const check = await moderatable(actor, targetId);
  if (!check.ok) return check;
  if (!check.target.bannedAt) return { ok: true, data: { unbanned: false } };
  await prisma.user.update({
    where: { id: targetId },
    data: { bannedAt: null, banReason: null },
  });
  return { ok: true, data: { unbanned: true } };
}

/** Signs a user out everywhere without banning them (a stolen laptop, say). */
export async function revokeSessions(
  actor: Actor,
  targetId: string,
): Promise<ModerationResult<{ revokedSessions: number }>> {
  const check = await moderatable(actor, targetId);
  if (!check.ok) return check;
  const revoked = await prisma.session.deleteMany({ where: { userId: targetId } });
  return { ok: true, data: { revokedSessions: revoked.count } };
}

/** Makes someone an organizer or super admin, or (with null) removes their staff role. */
export async function setStaffRole(
  actor: Actor,
  targetId: string,
  staffRole: StaffRoleName | null,
): Promise<ModerationResult<{ staffRole: StaffRoleName | null }>> {
  if (!isSuperAdmin(actor)) return fail(403, "Only super admins can change staff roles.");
  if (actor.id === targetId) {
    return fail(400, "You can't change your own staff role. Ask another super admin.");
  }
  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { bannedAt: true },
  });
  if (!target) return fail(404, "No user with that ID.");
  if (staffRole && target.bannedAt) {
    return fail(409, "This user is banned. Unban them before giving them a staff role.");
  }
  await prisma.user.update({ where: { id: targetId }, data: { staffRole } });
  return { ok: true, data: { staffRole } };
}
