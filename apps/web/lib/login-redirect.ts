// Where to send people after they sign in. Plain functions, safe in proxy.ts, server code and
// client components alike.

const BASE = "http://mergio.invalid";

/**
 * `value` if it is a path on this site ("/dashboard?tab=1"), otherwise null. Rejects absolute
 * URLs, protocol-relative ones ("//evil.com") and backslash tricks ("/\\evil.com"), so a
 * ?next= link can never bounce someone to another site after sign-in.
 */
export function safeNextPath(value: string | string[] | null | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) {
    return null;
  }
  try {
    const url = new URL(raw, BASE);
    if (url.origin !== BASE) return null;
    // Sending someone back to the login page after signing in would loop.
    if (url.pathname === "/login") return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/** /login, with ?next= when there is somewhere safe to come back to. */
export function loginPath(next?: string | null) {
  const safe = safeNextPath(next);
  return safe ? `/login?next=${encodeURIComponent(safe)}` : "/login";
}
