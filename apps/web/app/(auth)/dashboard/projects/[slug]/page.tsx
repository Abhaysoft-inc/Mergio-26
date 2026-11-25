import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Chip } from "@/components/dashboard/pr-item";
import { StatusBadge } from "@/components/projects/status-badge";
import { requireUser } from "@/lib/dal";
import { formatDate, signed } from "@/lib/format";
import { githubAppInstallUrl } from "@/lib/project-status";
import { adminProject, projectAdminView } from "@/lib/project-dashboard";
import { activeSeason } from "@/lib/projects-server";
import { addMentorAction, removeMentorAction } from "../../actions";
import { MentorsPanel } from "./mentors-panel";

export const metadata: Metadata = {
  title: "Project dashboard - Mergio",
};

const heading = "font-mono text-[13px] font-medium tracking-widest text-(color:--muted) uppercase";

const STATUS_LABELS: Record<string, { label: string; tone: "ice" | "muted" | "gold" | "green" | "red" }> = {
  OPEN: { label: "Open", tone: "ice" },
  CLOSED: { label: "Closed", tone: "muted" },
  AWAITING_LABEL: { label: "Needs label", tone: "gold" },
  SCORED: { label: "Scored", tone: "green" },
  NOT_ELIGIBLE: { label: "Not eligible", tone: "red" },
  INVALIDATED: { label: "Invalidated", tone: "red" },
};

export default async function ProjectDashboardPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await requireUser();
  const [{ slug }, season] = await Promise.all([params, activeSeason()]);
  if (!season) notFound();
  // Only the project admin (and organizers) get anything but a 404.
  const project = await adminProject(slug, season, user);
  if (!project) notFound();
  const view = await projectAdminView(project.id, season);
  const installUrl = githubAppInstallUrl();
  const notTracked = view.repos.filter((repo) => repo.approval === "APPROVED" && repo.trackingStatus !== "ACTIVE");

  return (
    <div className="w-full max-w-4xl">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/dashboard" className="text-sm text-(color:--muted) hover:text-(color:--text)">
          ← Dashboard
        </Link>
        <Link href={`/projects/${project.slug}`} className="ml-auto text-sm text-(color:--ice) hover:underline">
          View project page
        </Link>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <h1 className="text-3xl font-semibold tracking-tight break-words sm:text-4xl">{project.name}</h1>
        <StatusBadge status={project.status} />
        <Link className="btn btn-ghost btn-sm ml-auto" href={`/projects/${project.slug}/manage`}>
          Edit project and repos
        </Link>
      </div>

      <section aria-label="Pull request stats" className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Pull requests" value={view.stats.total} detail={`${view.stats.open} open · ${view.stats.merged} merged`} />
        <Stat
          label="Scored"
          value={view.stats.scored}
          detail={view.stats.byLevel.map((level) => `${level.count} ${level.name.toLowerCase()}`).join(" · ")}
        />
        <Stat label="Points awarded" value={view.stats.points} detail={`${view.contributors.length} contributors`} />
        <Stat
          label="Needs attention"
          value={view.stats.awaitingLabel}
          detail={`waiting for a label · ${view.stats.notEligible} not eligible`}
        />
      </section>

      <section className="panel mt-4 p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className={heading}>Repo health</h2>
          {notTracked.length > 0 && installUrl && (
            <a className="btn btn-primary btn-sm" href={installUrl} target="_blank" rel="noopener noreferrer">
              Install the GitHub App
            </a>
          )}
        </div>
        <ul className="mt-5 mb-0 list-none p-0">
          {view.repos.map((repo) => (
            <li
              key={repo.id}
              className="border-b border-(color:--border) py-3.5 first:pt-0 last:border-b-0 last:pb-0"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <a
                  href={`https://github.com/${repo.fullName}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-sm hover:text-(color:--ice)"
                >
                  {repo.fullName}
                </a>
                <div className="flex flex-wrap gap-2">
                  {repo.approval !== "APPROVED" && (
                    <Chip tone={repo.approval === "PENDING" ? "gold" : "red"}>
                      {repo.approval === "PENDING" ? "Waiting for organizer" : "Not accepted"}
                    </Chip>
                  )}
                  <Chip tone={repo.trackingStatus === "ACTIVE" ? "green" : repo.trackingStatus === "SUSPENDED" ? "red" : "gold"}>
                    {repo.trackingStatus === "ACTIVE"
                      ? "App installed"
                      : repo.trackingStatus === "SUSPENDED"
                        ? "Tracking suspended"
                        : "App not installed"}
                  </Chip>
                  <Chip
                    tone={repo.missingLabels === null ? "muted" : repo.missingLabels.length === 0 ? "green" : "gold"}
                  >
                    {repo.missingLabels === null
                      ? "Labels not checked"
                      : repo.missingLabels.length === 0
                        ? "Labels ready"
                        : `${repo.missingLabels.length} labels missing`}
                  </Chip>
                </div>
              </div>
              {repo.missingLabels && repo.missingLabels.length > 0 && (
                <p className="mt-1.5 mb-0 text-sm text-(color:--muted)">
                  Create these on GitHub, or give the app Issues write permission: {repo.missingLabels.join(", ")}
                </p>
              )}
              {repo.lastSyncedAt && (
                <p className="mt-1 mb-0 font-mono text-xs text-(color:--dim)">Last synced {formatDate(repo.lastSyncedAt)}</p>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-4 mb-0 text-xs text-(color:--dim)">Program labels: {view.labelNames.join(", ")}</p>
      </section>

      <section className="panel mt-4 p-8">
        <h2 className={heading}>
          Mentors · {view.activeMentors} active
          {project.expectedMentors > 0 ? ` of ${project.expectedMentors} expected` : ""}
        </h2>
        <div className="mt-5">
          <MentorsPanel
            mentors={view.mentors}
            inviteUrl={view.inviteUrl}
            addAction={addMentorAction.bind(null, project.id, project.slug)}
            removeAction={removeMentorAction.bind(null, project.id, project.slug)}
          />
        </div>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="panel p-8">
          <h2 className={heading}>Contributors</h2>
          {view.contributors.length > 0 ? (
            <ol className="mt-5 mb-0 list-none p-0">
              {view.contributors.slice(0, 25).map((person) => (
                <li
                  key={person.login}
                  className="flex items-center justify-between gap-3 border-b border-(color:--border) py-2.5 first:pt-0 last:border-b-0 last:pb-0"
                >
                  <a
                    href={`https://github.com/${person.login}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 truncate hover:text-(color:--ice)"
                  >
                    @{person.login}
                    {!person.registered && <span className="ml-2 font-mono text-[11px] text-(color:--dim)">not registered</span>}
                  </a>
                  <span className="font-mono text-xs whitespace-nowrap text-(color:--muted) tabular-nums">
                    {person.scored}/{person.prs} scored · {person.points} pts
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-4 mb-0 text-(color:--muted)">No pull requests yet.</p>
          )}
        </section>

        <section className="panel p-8">
          <h2 className={heading}>Recent pull requests</h2>
          {view.recent.length > 0 ? (
            <ul className="mt-5 mb-0 list-none p-0">
              {view.recent.map((pr) => {
                const status = STATUS_LABELS[pr.status]!;
                return (
                  <li
                    key={pr.id}
                    className="border-b border-(color:--border) py-3 first:pt-0 last:border-b-0 last:pb-0"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <a
                        href={pr.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-w-0 text-sm font-medium break-words hover:text-(color:--ice)"
                      >
                        {pr.title}
                      </a>
                      <Chip tone={status.tone}>{status.label}</Chip>
                    </div>
                    <p className="mt-0.5 mb-0 font-mono text-xs text-(color:--dim)">
                      {pr.repo}#{pr.number} · @{pr.authorLogin}
                      {pr.levelName ? ` · ${pr.levelName}` : ""}
                      {pr.status === "SCORED" ? ` · ${signed(pr.points)}` : ""}
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-4 mb-0 text-(color:--muted)">No pull requests yet.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="panel flex flex-col p-6">
      <p className="m-0 font-mono text-xs tracking-widest text-(color:--muted) uppercase">{label}</p>
      <p className="mt-3 mb-0 text-3xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 mb-0 text-xs text-(color:--dim)">{detail}</p>
    </div>
  );
}
