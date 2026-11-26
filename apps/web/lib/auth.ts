import "server-only";
import { prisma } from "@repo/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";

// GitHub usernames (case-insensitive) that become super admins on sign-in. This only ever
// promotes: removing a name here does not demote someone, so change staffRole in the database
// (or through the admin API) for that.
const adminLogins = new Set(
  (process.env.ADMIN_GITHUB_LOGINS ?? "")
    .split(",")
    .map((login) => login.trim().toLowerCase())
    .filter(Boolean),
);

// Set in production (".mergio.in") so admin.mergio.in can read the same session.
const cookieDomain = process.env.AUTH_COOKIE_DOMAIN || undefined;

const DAY = 60 * 60 * 24;

// GitHub ID -> login, from the profile fetched earlier in the same sign-in request. Entries
// are taken by syncGithubIdentity() moments later; the expiry only clears ones left behind
// by a sign-in that failed in between.
const pendingLogins = new Map<string, { login: string; expires: number }>();

function rememberGithubProfile(githubId: string, login: string) {
  const now = Date.now();
  for (const [id, entry] of pendingLogins) {
    if (entry.expires < now) pendingLogins.delete(id);
  }
  pendingLogins.set(githubId, { login, expires: now + 60_000 });
}

async function syncGithubIdentity(
  account: { providerId: string; accountId: string; userId: string } | null,
) {
  if (account?.providerId !== "github") return;
  const pending = pendingLogins.get(account.accountId);
  pendingLogins.delete(account.accountId);

  if (pending) {
    // Logins are unique here but not forever on GitHub: if whoever held this login before
    // has since renamed, free it so this update doesn't fail. They get their new login back
    // the next time they sign in.
    await prisma.user.updateMany({
      where: {
        githubLogin: { equals: pending.login, mode: "insensitive" },
        id: { not: account.userId },
      },
      data: { githubLogin: null },
    });
  }

  if (!pending) return;
  const promote = adminLogins.has(pending.login.toLowerCase());
  await prisma.user.update({
    where: { id: account.userId },
    data: {
      githubLogin: pending.login,
      ...(promote ? { staffRole: "SUPER_ADMIN" } : {}),
    },
  });
}

/** Shown on /login when a banned person tries to sign in (see app/(auth)/login). */
export const BANNED_ERROR = "account_banned";

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, { provider: "postgresql" }),

  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
      // Identity only. No repository access is requested.
      scope: ["read:user", "user:email"],
      // Users are matched by GitHub's numeric ID (Account.accountId), so someone who renames
      // themselves on GitHub signs back in to the same user, with their points. Name, avatar
      // and login are refreshed from GitHub every time.
      overrideUserInfoOnSignIn: true,
      // Fields marked input: false (githubLogin, staffRole) are dropped from whatever this
      // returns, so the login is handed to the account hook below instead.
      mapProfileToUser: (profile) => {
        rememberGithubProfile(String(profile.id), profile.login);
        return {};
      },
    },
  },

  user: {
    additionalFields: {
      // input: false means clients can never set these through the auth API.
      githubLogin: { type: "string", required: false, input: false },
      staffRole: { type: "string", required: false, input: false },
      bannedAt: { type: "date", required: false, input: false },
      banReason: { type: "string", required: false, input: false },
    },
  },

  // Sessions live in the Session table, so deleting a row signs that device out at once
  // (banUser() in lib/moderation.ts relies on this). 30 days, rolling: a session used after
  // it is a day old is pushed out to 30 days from then.
  //
  // The session cookie cache is kept to 60 seconds so revoked sessions/bans still take
  // effect within a minute while avoiding a Postgres lookup on every navigation.
  //
  // Cookie attributes are Better Auth's defaults: httpOnly, SameSite=Lax, and Secure
  // whenever BETTER_AUTH_URL is https.
  session: {
    expiresIn: 30 * DAY,
    updateAge: DAY,
    cookieCache: {
      enabled: true,
      maxAge: 60,
    },
  },

  databaseHooks: {
    // Every GitHub sign-in creates or updates the account row (fresh tokens), so this runs
    // each time and keeps the login current.
    account: {
      create: { after: syncGithubIdentity },
      update: { after: syncGithubIdentity },
    },
    session: {
      create: {
        // Banned people can't start a session. The OAuth callback sends them to the error
        // URL (/login) with ?error=account_banned.
        before: async (session) => {
          const user = await prisma.user.findUnique({
            where: { id: session.userId },
            select: { bannedAt: true },
          });
          if (user?.bannedAt) {
            throw new APIError("FORBIDDEN", {
              code: BANNED_ERROR,
              message: "This account is suspended.",
            });
          }
        },
      },
    },
  },

  advanced: {
    crossSubDomainCookies: cookieDomain
      ? { enabled: true, domain: cookieDomain }
      : { enabled: false },
  },

  // Must be last: lets server actions set the session cookie.
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
