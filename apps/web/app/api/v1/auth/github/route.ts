import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { githubSignInUrl } from "@/lib/sign-in";

// GET /api/v1/auth/github?next=/dashboard
// Starts GitHub sign-in: redirects to GitHub, which returns to Better Auth's callback
// (/api/auth/callback/github) and then to `next`. A plain link can start sign-in this way.
export async function GET(request: NextRequest) {
  redirect(await githubSignInUrl(request.nextUrl.searchParams.get("next")));
}
