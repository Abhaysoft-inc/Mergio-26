import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LeaderboardScreen } from "@/components/leaderboard/leaderboard-screen";
import { getSession } from "@/lib/dal";
import { leaderboardSeason, MAX_PAGE, parseFilters, resolveBoard } from "@/lib/leaderboard";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ slug }, season] = await Promise.all([params, leaderboardSeason()]);
  const resolved = season ? await resolveBoard(season, `college:${slug}`) : null;
  return { title: resolved?.subject ? `${resolved.subject.name} — Mergio leaderboard` : "Leaderboard — Mergio" };
}

/** One college's students, ranked by the same rule as the overall board. */
export default async function CollegeLeaderboardPage({ params, searchParams }: Props) {
  const [{ slug }, raw, season, session] = await Promise.all([
    params,
    searchParams,
    leaderboardSeason(),
    getSession(),
  ]);
  if (!season) notFound();
  const resolved = await resolveBoard(season, `college:${slug}`);
  if (!resolved?.subject) notFound();
  const page = Math.min(MAX_PAGE, Math.max(1, Number.parseInt(first(raw.page) ?? "1", 10) || 1));
  const filters = { ...parseFilters((name) => first(raw[name])), college: null, state: null };

  return (
    <LeaderboardScreen
      season={season}
      resolved={resolved}
      filters={filters}
      page={page}
      viewerId={session?.user.id ?? null}
      path={`/leaderboard/colleges/${resolved.subject.slug}`}
      fixedParams={{}}
      title={resolved.subject.name}
      intro={`Students of ${resolved.subject.name}${resolved.subject.state ? `, ${resolved.subject.state}` : ""}, ranked by points this season.`}
    />
  );
}
