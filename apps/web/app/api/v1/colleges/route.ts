import type { NextRequest } from "next/server";
import { json } from "@/lib/api";
import { searchColleges } from "@/lib/colleges";

/** GET /api/v1/colleges?q=iit+madras — up to 10 colleges for the registration autocomplete. */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";
  return json({ colleges: await searchColleges(q.slice(0, 80)) });
}
