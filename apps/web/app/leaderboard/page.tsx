import { prisma } from "@repo/db";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LeaderboardScreen } from "@/components/leaderboard/leaderboard-screen";
import { getSession } from "@/lib/dal";
import { leaderboardSeason, MAX_PAGE, parseFilters, resolveBoard } from "@/lib/leaderboard";
import { liveProject } from "@/lib/projects-server";

export const metadata: Metadata = {
  title: "Leaderboard — Mergio",
  description: "Who is leading Mergio this season: overall, this week, per project, per college and mentors.",
};

type Search = { [key: string]: string | string[] | undefined };
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const INTRO: Record<string, string> = {
  overall: "Points from merged, scored pull requests this season.",
  weekly: "Points this week. The board resets every Monday at 00:00 IST.",
  project: "Contributors ranked by the points they earned on this project.",
  colleges: "Colleges ranked by the points of their students on the leaderboard.",
  mentors: "Mentor points: approving reviews on scored pull requests and labelled issues that got one.",
};

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<Search> }) {
  const raw = await searchParams;
  const view = first(raw.view) ?? "overall";
  const projectSlug = first(raw.project)?.trim() || null;
  const page = Math.min(MAX_PAGE, Math.max(1, Number.parseInt(first(raw.page) ?? "1", 10) || 1));
  const [season, session] = await Promise.all([leaderboardSeason(), getSession()]);

  if (!season) {
    return (
      <section className="panel p-10 text-center">
        <h1 className="text-2xl font-semibold">The leaderboard opens with the season</h1>
        <p className="mt-3 mb-0 text-(color:--muted)">Come back once contributions start counting.</p>
      </section>
    );
  }

  // The project tab without a project: pick one.
  if (view === "project" && !projectSlug) {
    const projects = await prisma.project.findMany({
      where: { seasonId: season.id, ...liveProject },
      orderBy: { name: "asc" },
      select: { slug: true, name: true },
    });
    return (
      <div className="w-full">
        <Link href="/leaderboard" className="text-sm text-(color:--muted) hover:text-(color:--text)">
          ← Leaderboard
        </Link>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">Project leaderboards</h1>
        <ul className="mt-6 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <li key={project.slug}>
              <Link
                href={`/leaderboard?view=project&project=${project.slug}`}
                className="panel block p-5 font-medium hover:text-(color:--ice)"
              >
                {project.name}
              </Link>
            </li>
          ))}
        </ul>
        {projects.length === 0 && <p className="mt-6 text-(color:--muted)">No live projects yet.</p>}
      </div>
    );
  }

  const ref = view === "project" ? `project:${projectSlug}` : view;
  if (view === "college") notFound();
  const resolved = await resolveBoard(season, ref);
  if (!resolved) notFound();

  return (
    <LeaderboardScreen
      season={season}
      resolved={resolved}
      filters={parseFilters((name) => first(raw[name]))}
      page={page}
      viewerId={session?.user.id ?? null}
      path="/leaderboard"
      fixedParams={{ view: view === "overall" ? null : view, project: projectSlug }}
      title={resolved.subject ? `${resolved.subject.name} leaderboard` : "Leaderboard"}
      intro={INTRO[view] ?? INTRO.overall!}
    />
  );
}
