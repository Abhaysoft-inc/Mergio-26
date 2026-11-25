import "server-only";
import { prisma } from "@repo/db";

// Users who signed in before the login was stored have none. It's filled in the first time
// they're seen, so every lookup that fails would otherwise repeat on every page they open.
const RETRY_AFTER_MS = 10 * 60_000;
const failedAt = new Map<string, number>();

/**
 * The user's GitHub login. Accounts created before the login was stored have none, so look it up
 * from GitHub's API by the permanent numeric id and save it. Signing in stores it from then on.
 *
 * The call uses the user's own OAuth token when there is one (5,000 requests an hour for them,
 * instead of 60 an hour shared by the whole server's IP), and a failed lookup isn't retried for a
 * few minutes, so a rate limit can't add a failing GitHub call to every page load.
 */
export async function ensureGithubLogin(user: {
  id: string;
  githubLogin?: string | null;
}) {
  if (user.githubLogin) return user.githubLogin;
  const failed = failedAt.get(user.id);
  if (failed !== undefined && Date.now() - failed < RETRY_AFTER_MS) return null;

  const account = await prisma.account.findFirst({
    where: { userId: user.id, providerId: "github" },
    select: { accountId: true, accessToken: true, accessTokenExpiresAt: true },
  });
  if (!account) return null;
  const tokenUsable =
    account.accessToken && (!account.accessTokenExpiresAt || account.accessTokenExpiresAt > new Date());
  try {
    const response = await fetch(`https://api.github.com/user/${account.accountId}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "mergio",
        ...(tokenUsable ? { Authorization: `Bearer ${account.accessToken}` } : {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    const { login } = response.ok ? ((await response.json()) as { login?: string }) : {};
    if (!login) {
      failedAt.set(user.id, Date.now());
      return null;
    }
    failedAt.delete(user.id);
    await prisma.user.update({
      where: { id: user.id },
      data: { githubLogin: login },
    });
    return login;
  } catch {
    failedAt.set(user.id, Date.now());
    return null;
  }
}
