import { prisma } from "@repo/db";
import { standingOf } from "@repo/scoring/server";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { leaderboardSeason } from "@/lib/leaderboard";

type Props = { params: Promise<{ login: string }> };

const findUser = (login: string) =>
  prisma.user.findFirst({
    where: { githubLogin: { equals: login, mode: "insensitive" } },
    select: {
      id: true,
      name: true,
      image: true,
      githubLogin: true,
      profile: {
        select: { graduationYear: true, collegeRecord: { select: { slug: true, name: true, state: true } } },
      },
    },
  });

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const user = await findUser((await params).login);
  return { title: user ? `${user.name} — Mergio leaderboard` : "Leaderboard — Mergio" };
}

const LEVEL = { BEGINNER: "Beginner", INTERMEDIATE: "Intermediate", ADVANCED: "Advanced" } as const;

/** A contributor's public profile: rank, points, badges and scored PRs. No contact details. */
export default async function UserProfilePage({ params }: Props) {
  const { login } = await params;
  const [user, season] = await Promise.all([findUser(login), leaderboardSeason()]);
  if (!user || !season) notFound();

  const [standing, badges, prs] = await Promise.all([
    standingOf(season, user.id, new Date()),
    prisma.userBadge.findMany({
      where: { userId: user.id, seasonId: season.id },
      select: { badge: { select: { key: true, name: true, description: true, sortOrder: true } } },
    }),
    prisma.pullRequest.findMany({
      where: { authorId: user.id, seasonId: season.id, scoreStatus: "SCORED" },
      orderBy: { mergedAt: "desc" },
      take: 25,
      select: { id: true, title: true, url: true, number: true, level: true, points: true, repo: { select: { owner: true, name: true } } },
    }),
  ]);
  const college = user.profile?.collegeRecord;
  const stats = [
    { label: "Rank", value: standing.rank ? `#${standing.rank}` : "—" },
    { label: "Points", value: standing.points },
    { label: "This week", value: `${standing.weeklyPoints}${standing.weeklyRank ? ` · #${standing.weeklyRank}` : ""}` },
  ];

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Link href="/leaderboard" className="text-sm text-(color:--muted) hover:text-(color:--text)">
        ← Leaderboard
      </Link>

      <section className="panel mt-6 p-8">
        <div className="flex items-center gap-5">
          {user.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote GitHub avatar, no loader configured
            <img src={user.image} alt="" width={68} height={68} className="size-17 rounded-full" />
          ) : (
            <span className="size-17 rounded-full bg-(color:--border-strong)" aria-hidden="true" />
          )}
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold tracking-tight break-words">{user.name}</h1>
            {user.githubLogin && (
              <a
                href={`https://github.com/${user.githubLogin}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-sm text-(color:--dim) hover:text-(color:--ice)"
              >
                @{user.githubLogin}
              </a>
            )}
            {college && (
              <p className="mt-1 text-sm text-(color:--muted)">
                <Link href={`/leaderboard/colleges/${college.slug}`} className="hover:text-(color:--ice)">
                  {college.name}
                </Link>
                {user.profile?.graduationYear ? ` · Class of ${user.profile.graduationYear}` : ""}
              </p>
            )}
          </div>
        </div>

        <dl className="mt-8 grid grid-cols-3 gap-4">
          {stats.map((stat) => (
            <div key={stat.label}>
              <dt className="text-xs text-(color:--dim)">{stat.label}</dt>
              <dd className="font-mono text-2xl font-semibold tabular-nums">{stat.value}</dd>
            </div>
          ))}
        </dl>

        {badges.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-2">
            {badges
              .sort((a, b) => a.badge.sortOrder - b.badge.sortOrder)
              .map(({ badge }) => (
                <span
                  key={badge.key}
                  title={badge.description}
                  className="rounded-full border border-(color:--border-strong) px-2.5 py-0.5 text-xs text-(color:--gold)"
                >
                  {badge.name}
                </span>
              ))}
          </div>
        )}
      </section>

      <section className="panel mt-6 p-6">
        <h2 className="text-lg font-semibold">Scored pull requests</h2>
        {prs.length === 0 ? (
          <p className="mt-3 text-sm text-(color:--muted)">No scored pull requests yet this season.</p>
        ) : (
          <ul className="mt-3 divide-y divide-(color:--border)">
            {prs.map((pr) => (
              <li key={pr.id} className="flex items-center justify-between gap-4 py-2.5">
                <a href={pr.url} target="_blank" rel="noopener noreferrer" className="min-w-0 hover:text-(color:--ice)">
                  <span className="block truncate font-medium">{pr.title}</span>
                  <span className="font-mono text-xs text-(color:--dim)">
                    {pr.repo.owner}/{pr.repo.name}#{pr.number}
                    {pr.level ? ` · ${LEVEL[pr.level]}` : ""}
                  </span>
                </a>
                <span className="font-mono text-sm tabular-nums">+{pr.points}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
