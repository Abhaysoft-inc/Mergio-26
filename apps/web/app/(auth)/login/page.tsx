import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Icon } from "@/components/landing/icon";
import { BANNED_ERROR } from "@/lib/auth";
import { getSession } from "@/lib/dal";
import { safeNextPath } from "@/lib/login-redirect";
import { logInWithGitHub } from "../actions";

export const metadata: Metadata = {
  title: "Sign in — Mergio",
  description: "Sign in to Mergio with your GitHub account.",
};

// Better Auth sends failed sign-ins here with ?error=<code>. Known codes get a plain
// explanation; the raw code is never shown, since anyone can put anything in the URL.
function errorMessage(code: string | undefined) {
  if (!code) return null;
  if (code === BANNED_ERROR) {
    return "This account is suspended. If you think that's a mistake, contact the organizers.";
  }
  if (code === "access_denied") return "Sign-in was cancelled on GitHub.";
  return "Signing in didn't work. Please try again.";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [params, session] = await Promise.all([searchParams, getSession()]);
  const next = safeNextPath(params.next);

  if (session) redirect(next ?? "/dashboard");

  const error = errorMessage(
    Array.isArray(params.error) ? params.error[0] : params.error,
  );

  return (
    <section className="auth-card panel panel-featured login-card" aria-labelledby="login-title">
      <h1 id="login-title">Sign in to Mergio</h1>
      <p className="auth-lead">
        Mergio uses your GitHub account, so your merged pull requests count towards your
        points automatically.
      </p>

      {error && (
        <p className="form-alert" role="alert">
          {error}
        </p>
      )}

      <form action={logInWithGitHub} className="login-form">
        {next && <input type="hidden" name="next" value={next} />}
        <button className="btn btn-primary join-submit" type="submit">
          <Icon name="github" size={18} />
          Continue with GitHub
        </button>
      </form>

      <p className="join-privacy">
        We only read your public profile and email. Never your repositories.
      </p>
      <p className="login-alt">
        New to Mergio? <Link href="/register">Register for this season</Link>
      </p>
    </section>
  );
}
