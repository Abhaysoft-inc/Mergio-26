import "server-only";
import { prisma } from "@repo/db";

/**
 * The user's GitHub login. Accounts created before the login was stored have none, so look it up
 * from GitHub's public API by the permanent numeric id and save it.
 */
export async function ensureGithubLogin(user: {
  id: string;
  githubLogin?: string | null;
}) {
  if (user.githubLogin) return user.githubLogin;
  const account = await prisma.account.findFirst({
    where: { userId: user.id, providerId: "github" },
    select: { accountId: true },
  });
  if (!account) return null;
  try {
    const response = await fetch(
      `https://api.github.com/user/${account.accountId}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "mergio",
        },
        cache: "no-store",
      },
    );
    if (!response.ok) return null;
    const { login } = (await response.json()) as { login?: string };
    if (!login) return null;
    await prisma.user.update({
      where: { id: user.id },
      data: { githubLogin: login },
    });
    return login;
  } catch {
    return null;
  }
}
