import { prisma } from "@repo/db";
import type { Metadata } from "next";
import Link from "next/link";
import { Chip } from "@/components/dashboard/pr-item";
import { Icon } from "@/components/landing/icon";
import { requireUser } from "@/lib/dal";
import { formatDate, formatDateTime, signed } from "@/lib/format";
import { mentorOverview } from "@/lib/mentor-dashboard";
import { linkMentorInvites } from "@/lib/mentor-service";
import { activeSeason } from "@/lib/projects-server";
import { AccountNav } from "../../account-nav";

export const metadata: Metadata = {
  title: "Mentoring — Mergio",
};

const heading = "font-mono text-[13px] font-medium tracking-widest text-(color:--muted) uppercase";

export default async function MentorPage({
  searchParams,
}: {
  searchParams: Promise<{ flagged?: string | string[] }>;
}) {
  const user = await requireUser();
  await linkMentorInvites(user);
  const [season, mentorRegistration, flagged] = await Promise.all([
    activeSeason(),
    prisma.registration.findUnique({
      where: { userId_role: { userId: user.id, role: "MENTOR" } },
      select: { status: true },
    }),
    searchParams.then((params) => params.flagged === "1"),
  ]);
  const view = season ? await mentorOverview(user.id, season) : null;

  const nav = (
    <AccountNav active="mentor" user={user} />
  );

  if (!view || view.projects.length === 0) {
    return (
      <div className="w-full max-w-4xl">
        {nav}
        <section className="panel p-10 text-center">
          <h1 className="text-2xl font-semibold">No projects to mentor yet</h1>
          <p className="mx-auto mt-3 mb-0 max-w-md text-(color:--muted)">
            {mentorRegistration?.status === "PENDING"
              ? "Your mentor registration is waiting for an organizer. Once approved and added to a project by its admin, the project's review queue appears here."
              : mentorRegistration?.status === "APPROVED"
                ? "You're an approved mentor. A project admin adds you to their project from its dashboard, using your GitHub username."
                : "Register as a mentor, and ask a project admin to add you by your GitHub username."}
          </p>
          {!mentorRegistration && (
            <Link className="btn btn-primary mt-7" href="/register?role=mentor">
              Register as a mentor
            </Link>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl">
      {nav}

      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Mentoring</h1>
          <ul className="mt-3 mb-0 flex list-none flex-wrap gap-2 p-0">
            {view.projects.map((project) => (
              <li key={project.id}>
                <Link
                  href={project.role === "ADMIN" ? `/dashboard/projects/${project.slug}` : `/projects/${project.slug}`}
                  className="inline-flex items-center gap-2 rounded-full border border-(color:--border-strong) px-3.5 py-1 text-sm hover:text-(color:--ice)"
                >
                  {project.name}
                  <span className="font-mono text-[11px] text-(color:--dim) uppercase">
                    {project.role === "ADMIN" ? "Admin" : "Mentor"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="text-right">
          <p className="m-0 text-4xl font-semibold tabular-nums">{view.mentorPoints}</p>
          <p className="m-0 font-mono text-xs text-(color:--dim)">mentor points</p>
        </div>
      </div>

      {flagged && (
        <p className="panel mt-4 mb-0 px-5 py-3 text-sm" role="status">
          Flag sent to the organizers. Thanks for keeping the program fair.
        </p>
      )}

      {view.accessWarnings.length > 0 && (
        <section className="panel mt-4 border-(color:--gold)! p-6" role="alert">
          <p className="m-0 font-medium text-(color:--gold)">You can&apos;t apply labels on some repos yet</p>
          <p className="mt-1 mb-2 text-sm text-(color:--muted)">
            Mentors need at least triage permission on GitHub. Ask the project admin to grant it.
          </p>
          <ul className="m-0 pl-5 text-sm">
            {view.accessWarnings.map((warning) => (
              <li key={warning.repo}>
                <span className="font-mono">{warning.repo}</span> ({warning.project}): your role is{" "}
                {warning.role}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel mt-4 p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className={heading}>Waiting for a label</h2>
          {view.urgentCount > 0 && <Chip tone="gold">{view.urgentCount} urgent</Chip>}
        </div>
        {view.queue.length > 0 ? (
          <ul className="mt-5 mb-0 list-none p-0">
            {view.queue.map((pr) => (
              <li
                key={pr.id}
                className="border-b border-(color:--border) py-4 first:pt-0 last:border-b-0 last:pb-0"
              >
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <a
                      href={pr.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium break-words hover:text-(color:--ice)"
                    >
                      {pr.title}
                    </a>
                    <p className="mt-0.5 mb-0 font-mono text-xs text-(color:--dim)">
                      {pr.repo}#{pr.number} · @{pr.authorLogin}
                      {pr.mergedAt ? ` · merged ${formatDate(pr.mergedAt)}` : ""}
                    </p>
                  </div>
                  {pr.urgent ? <Chip tone="gold">Urgent</Chip> : <Chip tone="muted">Past 72 h</Chip>}
                </div>
                <p className="mt-2 mb-0 text-sm text-(color:--muted)">
                  <span className="font-medium text-(color:--text)">{pr.action}.</span>{" "}
                  {pr.urgent && pr.labelDeadline
                    ? `Scored automatically if labelled by ${formatDateTime(pr.labelDeadline)}.`
                    : "It still scores as soon as it is labelled."}
                </p>
                <FlagLink id={pr.id} flagged={pr.flaggedByYou} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 mb-0 text-(color:--muted)">
            Every merged pull request on your projects has its labels. Nice.
          </p>
        )}
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-[3fr_2fr]">
        <section className="panel p-8">
          <h2 className={heading}>Recently scored</h2>
          {view.recentScored.length > 0 ? (
            <ul className="mt-5 mb-0 list-none p-0">
              {view.recentScored.map((pr) => (
                <li
                  key={pr.id}
                  className="border-b border-(color:--border) py-3.5 first:pt-0 last:border-b-0 last:pb-0"
                >
                  <div className="flex items-start justify-between gap-3">
                    <a
                      href={pr.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-w-0 font-medium break-words hover:text-(color:--ice)"
                    >
                      {pr.title}
                    </a>
                    <span className="font-mono text-sm font-semibold text-(color:--green) tabular-nums">
                      {signed(pr.points)}
                    </span>
                  </div>
                  <p className="mt-0.5 mb-0 font-mono text-xs text-(color:--dim)">
                    {pr.repo}#{pr.number} · @{pr.authorLogin}
                    {pr.levelName ? ` · ${pr.levelName}` : ""}
                  </p>
                  <FlagLink id={pr.id} flagged={pr.flaggedByYou} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 mb-0 text-(color:--muted)">No scored pull requests yet.</p>
          )}
        </section>

        <section className="panel p-8">
          <h2 className={heading}>Mentor points</h2>
          <p className="mt-2 mb-0 text-sm text-(color:--muted)">
            Earned for approving reviews on scored PRs and for labelling issues that get a scored PR.
          </p>
          {view.ledger.length > 0 ? (
            <ul className="mt-5 mb-0 list-none p-0">
              {view.ledger.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-start justify-between gap-3 border-b border-(color:--border) py-3 first:pt-0 last:border-b-0 last:pb-0"
                >
                  <div className="min-w-0 text-sm">
                    <p className="m-0">{entry.description}</p>
                    {entry.pullRequest && (
                      <a
                        href={entry.pullRequest.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs break-words text-(color:--dim) hover:text-(color:--ice)"
                      >
                        {entry.pullRequest.repo}#{entry.pullRequest.number}
                      </a>
                    )}
                  </div>
                  <span
                    className={`font-mono text-sm font-semibold tabular-nums ${entry.points > 0 ? "text-(color:--green)" : "text-[#E5484D]"}`}
                  >
                    {signed(entry.points)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 mb-0 text-sm text-(color:--dim)">None yet.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function FlagLink({ id, flagged }: { id: string; flagged: boolean }) {
  return flagged ? (
    <p className="mt-2 mb-0 font-mono text-xs text-(color:--dim)">Flagged by you</p>
  ) : (
    <Link
      href={`/dashboard/mentor/flag/${id}`}
      className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-(color:--muted) hover:text-[#E5484D]"
    >
      <Icon name="help" size={12} /> Flag the author
    </Link>
  );
}
