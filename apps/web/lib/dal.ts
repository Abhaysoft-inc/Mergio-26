import "server-only";
import { prisma } from "@repo/db";
import { getSessionCookie } from "better-auth/cookies";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "./auth";
import type { Viewer } from "./content";
import { ensureGithubLogin } from "./github-login";

// Data access layer. This is the real permission check: proxy.ts only does a cheap
// cookie check, so every page and action that needs a user must come through here.

/** The current session, or null. Deduplicated within one request. */
export const getSession = cache(async () =>
  auth.api.getSession({ headers: await headers() }),
);

/**
 * Who is looking at a public page (signed out, signed in but not registered, or registered),
 * so it can show "Dashboard" instead of "Register". Visitors without a session cookie, which
 * is most of them, never cost a database query.
 */
export const getViewer = cache(async (): Promise<Viewer> => {
  if (!getSessionCookie(await headers())) return "signed-out";
  const session = await getSession();
  if (!session) return "signed-out";
  const registration = await prisma.registration.findFirst({
    where: { userId: session.user.id },
    select: { id: true },
  });
  return registration ? "registered" : "unregistered";
});

/** The signed-in user. Redirects to the registration page (where sign-in starts) if there is none. */
export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/register");
  const { user } = session;
  return user.githubLogin
    ? user
    : { ...user, githubLogin: await ensureGithubLogin(user) };
}

/** The signed-in organizer. Anyone else gets a 404, so admin pages don't reveal that they exist. */
export async function requireAdmin() {
  const user = await requireUser();
  if (!user.isAdmin) notFound();
  return user;
}
