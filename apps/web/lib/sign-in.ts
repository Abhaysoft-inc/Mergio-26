import "server-only";
import { headers } from "next/headers";
import { auth } from "./auth";
import { loginPath, safeNextPath } from "./login-redirect";

/**
 * Starts a GitHub sign-in and returns the GitHub URL to send the browser to. Afterwards they
 * land on `next` (a path on this site, default /dashboard). If sign-in fails (they cancel on
 * GitHub, or they are banned) they land on /login with ?error=, which explains what happened.
 */
export async function githubSignInUrl(next?: string | null) {
  const safe = safeNextPath(next);
  const { url } = await auth.api.signInSocial({
    body: {
      provider: "github",
      callbackURL: safe ?? "/dashboard",
      errorCallbackURL: loginPath(safe),
    },
    headers: await headers(),
  });
  if (!url) throw new Error("GitHub sign-in did not return a redirect URL");
  return url;
}
