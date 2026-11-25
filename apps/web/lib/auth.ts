import "server-only";
import { prisma } from "@repo/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";

// GitHub usernames (case-insensitive) that become admins on sign-in. This only ever
// promotes: removing a name here does not demote someone already marked isAdmin.
const loginsFrom = (value: string | undefined) =>
  new Set(
    (value ?? "")
      .split(",")
      .map((login) => login.trim().toLowerCase())
      .filter(Boolean),
  );
const adminLogins = loginsFrom(process.env.ADMIN_GITHUB_LOGINS);
// Super Admins can also undo a finalized leaderboard (PRD §4.8). They are organizers too. Like
// ADMIN_GITHUB_LOGINS, this only ever promotes.
const superAdminLogins = loginsFrom(process.env.SUPER_ADMIN_GITHUB_LOGINS);

// Set in production (".mergio.in") so admin.mergio.in can read the same session.
const cookieDomain = process.env.AUTH_COOKIE_DOMAIN || undefined;

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
      // Users can rename themselves on GitHub, so refresh name, avatar and login every time.
      overrideUserInfoOnSignIn: true,
      mapProfileToUser: (profile) => ({
        githubLogin: profile.login,
        ...(adminLogins.has(profile.login.toLowerCase()) ||
        superAdminLogins.has(profile.login.toLowerCase())
          ? { isAdmin: true }
          : {}),
        ...(superAdminLogins.has(profile.login.toLowerCase()) ? { isSuperAdmin: true } : {}),
      }),
    },
  },

  user: {
    additionalFields: {
      // input: false means clients can never set these through the auth API.
      githubLogin: { type: "string", required: false, input: false },
      isAdmin: { type: "boolean", required: false, defaultValue: false, input: false },
      isSuperAdmin: { type: "boolean", required: false, defaultValue: false, input: false },
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
