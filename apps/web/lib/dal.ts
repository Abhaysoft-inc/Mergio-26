import "server-only";
import { prisma } from "@repo/db";
import { getSessionCookie } from "better-auth/cookies";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "./auth";
import type { Viewer } from "./content";
import { ensureGithubLogin } from "./github-login";
import { loginPath } from "./login-redirect";
import { isOrganizer, rolesOf, type PlatformRole } from "./roles";

// Data access layer. This is the real permission check: proxy.ts only does a cheap
// cookie check, so every page, action and API route that needs a user must come through here.

/** The current session, or null. Deduplicated within one request. */
export const getSession = cache(async () => {
  const reqHeaders = await headers();
  if (!getSessionCookie(reqHeaders)) return null;
  const session = await auth.api.getSession({ headers: reqHeaders });
  // Banning deletes every session, so this only catches one created in the instant
  // between the ban check at sign-in and the ban itself.
  if (session?.user.bannedAt) return null;
  return session;
});

/**
 * Who is looking at a public page (signed out, signed in but not registered, or registered),
 * so it can show "Dashboard" instead of "Register". Visitors without a session cookie, which
 * is most of them, never cost a database query.
 */
export const getViewer = cache(async (): Promise<Viewer> => {
  const session = await getSession();
  if (!session) return "signed-out";
  const registration = await prisma.registration.findFirst({
    where: { userId: session.user.id },
    select: { id: true },
  });
  return registration ? "registered" : "unregistered";
});

/** The signed-in user. Redirects to /login (coming back to `next` afterwards) if there is none. */
export async function requireUser(next?: string) {
  const session = await getSession();
  if (!session) redirect(loginPath(next));
  const { user } = session;
  return user.githubLogin
    ? user
    : { ...user, githubLogin: await ensureGithubLogin(user) };
}

/** The signed-in organizer. Anyone else gets a 404, so admin pages don't reveal that they exist. */
export async function requireAdmin() {
  const user = await requireUser();
  if (!user.isAdmin && !isOrganizer(user)) notFound();
  return user;
}

/** Registrations for a user, deduplicated within one request. */
export const getUserRegistrations = cache(async (userId: string) =>
  prisma.registration.findMany({
    where: { userId },
    select: { role: true, status: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  }),
);

/** Every role the current person holds (always includes VISITOR). Deduplicated within one request. */
export const getRoles = cache(async (): Promise<PlatformRole[]> => {
  const session = await getSession();
  if (!session) return rolesOf(null);
  const registrations = await getUserRegistrations(session.user.id);
  return rolesOf(session.user, registrations);
});

/**
 * The signed-in user, who must hold `role`. Signed-out people are sent to /login; signed-in
 * people without the role get a 404, so staff pages don't reveal that they exist.
 */
export async function requireRole(role: PlatformRole, next?: string) {
  const user = await requireUser(next);
  if (!(await getRoles()).includes(role)) notFound();
  return user;
}
