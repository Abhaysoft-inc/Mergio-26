import { getSessionCookie } from "better-auth/cookies";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { loginPath } from "@/lib/login-redirect";

// Optimistic check only: it looks for the session cookie and never touches the database.
// A forged, expired or revoked cookie gets past here and is rejected by requireUser() in
// lib/dal.ts, which also does the role checks (RBAC).
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    const { pathname, search } = request.nextUrl;
    return NextResponse.redirect(new URL(loginPath(pathname + search), request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/profile/:path*"],
};
