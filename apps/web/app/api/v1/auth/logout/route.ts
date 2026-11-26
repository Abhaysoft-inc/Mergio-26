import { headers } from "next/headers";
import { auth } from "@/lib/auth";

// POST /api/v1/auth/logout
// Deletes the current session from the database and clears the cookie. Succeeds even when
// nobody is signed in, so clients can call it unconditionally.
export async function POST() {
  await auth.api.signOut({ headers: await headers() });
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
