import { prisma } from "@repo/db";
import type { Metadata } from "next";
import Link from "next/link";
import { PrItem } from "@/components/dashboard/pr-item";
import { Icon, type IconName } from "@/components/landing/icon";
import { StatusBadge } from "@/components/projects/status-badge";
import {
  contributorPullRequests,
  contributorStats,
  recommendedIssues,
  type ContributorStats,
  type SeasonInfo,
} from "@/lib/contributor";
import { requireUser } from "@/lib/dal";
import { formatDate, formatDateTime, plural } from "@/lib/format";
import { mentorQueue } from "@/lib/mentor-dashboard";
import { linkMentorInvites } from "@/lib/mentor-service";
import { activeSeason } from "@/lib/projects-server";
import { roleInfo } from "@/lib/registration";
import { AccountNav } from "../account-nav";

export const metadata: Metadata = {
  title: "Dashboard — Mergio",
};

const statusStyle = {
  APPROVED: { label: "Approved", color: "text-(color:--green)" },
  PENDING: { label: "Under review", color: "text-(color:--gold)" },
  REJECTED: { label: "Not approved", color: "text-[#E5484D]" },
} as const;

const heading =
  "font-mono text-[13px] font-medium tracking-widest text-(color:--muted) uppercase";

export default async function DashboardPage() {
  const user = await requireUser();
  await linkMentorInvites(user);
  const [registrations, projects, season] = await Promise.all([
    prisma.registration.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    }),
    prisma.project.findMany({
      where: { ownerId: user.id, season: { isActive: true } },
      orderBy: { createdAt: "asc" },
      select: { id: true, slug: true, name: true, status: true },
    }),
    activeSeason(),
  ]);
  const maintainer = registrations.some(
    (registration) => registration.role === "MAINTAINER" && registration.status !== "REJECTED",
  );
  const contributor = registrations.some(
    (registration) => registration.role === "CONTRIBUTOR" && registration.status === "APPROVED",
  );
  const firstName = user.name.split(" ")[0] || user.githubLogin || "there";
  const registered = registrations.length > 0;

  return (
    <div className="w-full max-w-4xl">
      <AccountNav active="dashboard" user={user} />

      {registered ? (
        <section className="panel panel-featured flex flex-wrap items-center justify-between gap-6 px-8 py-7">
          <div>
            <p className="font-mono text-xs tracking-widest text-(color:--ice) uppercase">
              {season?.name ?? "Mergio"}
            </p>
            <h1 className="mt-1.5 text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">
              Hey, {firstName}
            </h1>
          </div>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {registrations.map((registration) => {
              const status = statusStyle[registration.status];
              return (
                <li
                  key={registration.id}
                  className="inline-flex items-center gap-2.5 rounded-full border border-(color:--border-strong) py-1.5 pr-3.5 pl-4 text-sm"
                >
                  <span className="font-medium">{roleInfo[registration.role].label}</span>
                  <span
                    className={`inline-flex items-center gap-1.5 font-mono text-xs tracking-wide uppercase ${status.color}`}
                  >
                    <span className="size-1.5 rounded-full bg-current" />
                    {status.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <section className="panel panel-featured px-8 py-14 text-center sm:px-14">
          <span className="mx-auto mb-7 grid size-16 place-items-center rounded-full border border-(color:--panel-border-strong) bg-(color:--ice-soft) text-(color:--ice) shadow-[0_0_32px_-6px_var(--ice-glow)]">
            <Icon name="flake" size={28} />
          </span>
          <h1 className="bg-linear-to-b from-white from-35% to-[#BFE1FF] bg-clip-text pb-1 text-4xl leading-tight font-semibold tracking-tight text-balance text-transparent sm:text-5xl light:from-[#0E1726] light:to-[#1F5FB8]">
            Hey, {firstName}
          </h1>
          <p className="mx-auto mt-4 max-w-md text-lg text-(color:--muted)">
            You haven&apos;t registered yet. It takes a minute.
          </p>
          <Link className="btn btn-primary mt-9" href="/register">
            Register now
          </Link>
        </section>
      )}

      {season && <MentoringSummary userId={user.id} season={season} />}

      {contributor && season && <ContributorView userId={user.id} season={season} />}

      {registered && !contributor && (
        <section className="panel mt-4 flex flex-wrap items-center justify-between gap-4 p-8">
          <p className="m-0 max-w-lg text-(color:--muted)">
            Want to earn points too? Register as a contributor to have your merged pull requests
            scored.
          </p>
          <Link className="btn btn-ghost btn-sm" href="/register">
            Add the contributor role
          </Link>
        </section>
      )}

      {maintainer && (
        <section className="panel mt-4 p-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className={heading}>Your projects</h2>
            <Link className="btn btn-primary btn-sm" href="/projects/new">
              Submit a project
            </Link>
          </div>
          {projects.length > 0 ? (
            <ul className="mt-5 mb-0 list-none p-0">
              {projects.map((project) => (
                <li
                  key={project.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-(color:--border) py-3.5 first:pt-0 last:border-b-0 last:pb-0"
                >
                  <Link
                    href={
                      project.status === "APPROVED"
                        ? `/dashboard/projects/${project.slug}`
                        : `/projects/${project.slug}/manage`
                    }
                    className="font-medium hover:text-(color:--ice)"
                  >
                    {project.name}
                  </Link>
                  <StatusBadge status={project.status} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-(color:--muted)">
              Apply with your open-source project for this season. You can save a draft and submit
              it when it is ready.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

/** For mentors and project admins: how many merged PRs wait for a label. */
async function MentoringSummary({ userId, season }: { userId: string; season: SeasonInfo }) {
  const { projects, pullRequests } = await mentorQueue(userId, season);
  if (projects.length === 0) return null;
  const urgent = pullRequests.filter((pr) => pr.urgent).length;
  return (
    <section className="panel mt-4 flex flex-wrap items-center justify-between gap-4 p-8">
      <div>
        <h2 className={heading}>Mentoring</h2>
        <p className="mt-2 mb-0 text-(color:--muted)">
          {pullRequests.length === 0
            ? `Every merged pull request on your ${plural(projects.length, "project")} is labelled.`
            : `${plural(pullRequests.length, "merged pull request")} waiting for a label${urgent > 0 ? `, ${urgent} urgent` : ""}.`}
        </p>
      </div>
      <Link className={`btn btn-sm ${urgent > 0 ? "btn-primary" : "btn-ghost"}`} href="/dashboard/mentor">
        Open review queue
      </Link>
    </section>
  );
}

async function ContributorView({ userId, season }: { userId: string; season: SeasonInfo }) {
  const [stats, recent, recommended] = await Promise.all([
    contributorStats(userId, season),
    contributorPullRequests(userId, season, { pageSize: 6 }),
    recommendedIssues(userId, season),
  ]);
  const windowNote = !season.codingStartsAt
    ? "Scoring opens when the contribution window starts. Dates are announced soon."
    : new Date() < season.codingStartsAt
      ? `Scoring opens ${formatDateTime(season.codingStartsAt)}.`
      : season.codingEndsAt && new Date() > season.codingEndsAt
        ? `The contribution window closed ${formatDate(season.codingEndsAt)}.`
        : null;

  return (
    <>
      {windowNote && (
        <p className="panel mt-4 mb-0 px-6 py-4 text-sm text-(color:--muted)">{windowNote}</p>
      )}
      <StatTiles stats={stats} />

      <section className="panel mt-4 p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className={heading}>Your pull requests</h2>
          {recent.total > recent.pullRequests.length && (
            <Link className="text-sm font-medium text-(color:--ice) hover:underline" href="/dashboard/prs">
              All {recent.total} pull requests
            </Link>
          )}
        </div>
        {recent.pullRequests.length > 0 ? (
          <ul className="mt-5 mb-0 list-none p-0">
            {recent.pullRequests.map((pr) => (
              <PrItem key={pr.id} pr={pr} />
            ))}
          </ul>
        ) : (
          <p className="mt-4 mb-0 text-(color:--muted)">
            Pull requests you open on participating projects show up here within a few minutes,
            with their status and points.
          </p>
        )}
      </section>

      <section className="panel mt-4 p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className={heading}>Recommended issues</h2>
          <Link className="text-sm font-medium text-(color:--ice) hover:underline" href="/projects">
            Browse projects
          </Link>
        </div>
        {recommended.issues.length > 0 ? (
          <ul className="mt-5 mb-0 list-none p-0">
            {recommended.issues.map((issue) => (
              <li
                key={issue.id}
                className="flex flex-wrap items-start justify-between gap-3 border-b border-(color:--border) py-3.5 first:pt-0 last:border-b-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <a
                    href={issue.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium break-words hover:text-(color:--ice)"
                  >
                    {issue.title}
                  </a>
                  <p className="mt-0.5 font-mono text-xs text-(color:--dim)">
                    {issue.repo}#{issue.number} · {issue.project.name}
                  </p>
                </div>
                {issue.levelName && (
                  <span className="font-mono text-xs whitespace-nowrap text-(color:--muted)">
                    {issue.levelName} · {issue.points} pts
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 mb-0 text-(color:--muted)">
            No open, unassigned issues yet. Labelled issues from participating projects appear
            here as soon as maintainers add them.
          </p>
        )}
      </section>

      {stats.badges.length > 0 && (
        <section className="panel mt-4 p-8">
          <h2 className={heading}>
            Badges · {stats.badges.length} of {stats.totalBadges}
          </h2>
          <ul className="mt-5 mb-0 flex list-none flex-wrap gap-2 p-0">
            {stats.badges.map((badge) => (
              <li
                key={badge.key}
                title={`${badge.description} Earned ${formatDate(badge.earnedAt)}.`}
                className="inline-flex items-center gap-2 rounded-full border border-(color:--border-strong) px-3.5 py-1.5 text-sm"
              >
                <span className="text-(color:--gold)">
                  <Icon name="award" size={14} />
                </span>
                {badge.name}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function StatTiles({ stats }: { stats: ContributorStats }) {
  const progress = stats.nextBadge;
  return (
    <section aria-label="Your stats" className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Tile
        icon="chart"
        label="Points"
        value={String(stats.points)}
        detail={
          stats.heldPoints > 0
            ? `+${stats.heldPoints} held by the daily cap`
            : plural(stats.pullRequests.scored, "scored PR")
        }
      />
      <Tile
        icon="trophy"
        label="Rank"
        value={stats.rank ? `#${stats.rank}` : "—"}
        detail={
          stats.leaderboardPhase !== "live"
            ? stats.leaderboardPhase === "final"
              ? "Final rank"
              : "Frozen rank · your points still count"
            : stats.rank && stats.rankedContributors
              ? `of ${stats.rankedContributors} ranked`
              : "Score a PR to get ranked"
        }
      />
      <Tile
        icon="calendar"
        label="This week"
        value={stats.weeklyRank ? `#${stats.weeklyRank}` : "—"}
        detail={`${stats.weeklyPoints} pts since ${formatDate(stats.weekStart)}`}
      />
      <div className="panel flex flex-col p-6">
        <p className="flex items-center gap-2 font-mono text-xs tracking-widest text-(color:--muted) uppercase">
          <Icon name="award" size={14} /> Next badge
        </p>
        {progress ? (
          <>
            <p className="mt-3 text-xl font-semibold">{progress.name}</p>
            <div
              className="mt-3 h-1.5 overflow-hidden rounded-full bg-(color:--border-strong)"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={progress.target}
              aria-valuenow={progress.current}
              aria-label={`${progress.name} progress`}
            >
              <div
                className="h-full rounded-full bg-(color:--ice)"
                style={{ width: `${(progress.current / progress.target) * 100}%` }}
              />
            </div>
            <p className="mt-2 mb-0 text-xs text-(color:--dim)">
              {progress.current} of {progress.target} · {progress.description}
            </p>
          </>
        ) : (
          <p className="mt-3 mb-0 text-sm text-(color:--muted)">Every count badge earned.</p>
        )}
      </div>
    </section>
  );
}

function Tile({
  icon,
  label,
  value,
  detail,
}: {
  icon: IconName;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="panel flex flex-col p-6">
      <p className="flex items-center gap-2 font-mono text-xs tracking-widest text-(color:--muted) uppercase">
        <Icon name={icon} size={14} /> {label}
      </p>
      <p className="mt-3 text-3xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 mb-0 text-xs text-(color:--dim)">{detail}</p>
    </div>
  );
}
