import type { NextRequest } from "next/server";
import { searchColleges } from "@/lib/colleges";

/**
 * GET /api/v1/colleges?q=iit+madras&limit=20&offset=0
 * Paginated, edge-cached college search for onboarding autocomplete and scroll-to-load.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const q = (params.get("q") ?? "").slice(0, 80);
  const rawLimit = Number.parseInt(params.get("limit") ?? "20", 10);
  const rawOffset = Number.parseInt(params.get("offset") ?? "0", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(30, Math.max(1, rawLimit)) : 20;
  const offset = Number.isFinite(rawOffset) ? Math.min(10_000, Math.max(0, rawOffset)) : 0;

  const { colleges, hasMore } = await searchColleges(q, { limit, offset });
  const nextOffset = hasMore ? offset + colleges.length : null;

  return Response.json(
    { colleges, hasMore, nextOffset },
    {
      headers: {
        // Cache on Vercel Edge CDN for 1 hour and serve stale for 24h to protect small DBs.
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}
