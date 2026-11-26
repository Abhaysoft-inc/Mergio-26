"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/dal";
import { banUser, revokeSessions, setStaffRole, unbanUser } from "@/lib/moderation";
import { parseStaffRole } from "@/lib/roles";

export type UserActionResult = { error?: string; done?: string };

async function withSession(
  run: (user: NonNullable<Awaited<ReturnType<typeof getSession>>>["user"]) => Promise<UserActionResult>,
): Promise<UserActionResult> {
  const session = await getSession();
  if (!session) return { error: "Your session expired. Sign in with GitHub again." };
  const result = await run(session.user);
  if (!result.error) revalidatePath("/admin/users");
  return result;
}

export async function banUserAction(userId: string, reason: string): Promise<UserActionResult> {
  return withSession(async (actor) => {
    const result = await banUser(actor, userId, reason);
    if (!result.ok) return { error: result.message };
    const count = result.data.revokedSessions;
    return { done: `Banned (${count} ${count === 1 ? "session" : "sessions"} revoked).` };
  });
}

export async function unbanUserAction(userId: string): Promise<UserActionResult> {
  return withSession(async (actor) => {
    const result = await unbanUser(actor, userId);
    if (!result.ok) return { error: result.message };
    return { done: result.data.unbanned ? "Unbanned." : "User was not banned." };
  });
}

export async function revokeSessionsAction(userId: string): Promise<UserActionResult> {
  return withSession(async (actor) => {
    const result = await revokeSessions(actor, userId);
    if (!result.ok) return { error: result.message };
    const count = result.data.revokedSessions;
    return { done: `Revoked ${count} ${count === 1 ? "session" : "sessions"}.` };
  });
}

export async function setStaffRoleAction(
  userId: string,
  value: string,
): Promise<UserActionResult> {
  const staffRole = value === "" ? null : parseStaffRole(value);
  if (value !== "" && !staffRole) return { error: "Invalid staff role." };

  return withSession(async (actor) => {
    const result = await setStaffRole(actor, userId, staffRole);
    if (!result.ok) return { error: result.message };
    return { done: staffRole ? `Role set to ${staffRole}.` : "Staff role removed." };
  });
}
