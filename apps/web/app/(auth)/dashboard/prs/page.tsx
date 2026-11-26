import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Pagination, PrItem } from "@/components/dashboard/pr-item";
import {
  LEVEL_FILTERS,
  PR_FILTERS,
  contributorProjects,
  contributorPullRequests,
  isContributor,
  parseLevelFilter,
  parsePrFilter,
  type LevelFilter,
  type PrFilter,
} from "@/lib/contributor";
import { requireUser } from "@/lib/dal";
import { activeSeason } from "@/lib/projects-server";
import { AccountNav } from "../../account-nav";

export const metadata: Metadata = {
  title: "Pull requests — Mergio",
};

type Search = { status?: string; level?: string; project?: string; page?: string; disputed?: string };
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function query(filters: { status: PrFilter | null; level: LevelFilter | null; project: string | null }, page = 1) {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.level) params.set("level", filters.level);
  if (filters.project) params.set("project", filters.project);
  if (page > 1) params.set("page", String(page));
  const text = params.toString();
  return text ? `/dashboard/prs?${text}` : "/dashboard/prs";
}

export default async function PullRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ [K in keyof Search]?: string | string[] }>;
}) {
  const user = await requireUser();
  if (!(await isContributor(user.id))) redirect("/dashboard");
  const raw = await searchParams;
  const filters = {
    status: parsePrFilter(first(raw.status)),
    level: parseLevelFilter(first(raw.level)),
    project: first(raw.project)?.trim() || null,
  };
  const page = Math.max(1, Number.parseInt(first(raw.page) ?? "1", 10) || 1);

  const season = await activeSeason();
  const [result, projects] = season
    ? await Promise.all([
        contributorPullRequests(user.id, season, { ...filters, page }),
        contributorProjects(user.id, season),
      ])
    : [null, []];

  const filtered = Boolean(filters.status || filters.level || filters.project);

  return (
    <div className="w-full max-w-4xl">
      <AccountNav active="prs" user={user} />

      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Pull requests</h1>
      <p className="mt-2 text-(color:--muted)">
        Every pull request you opened on a participating project this season, and how it scored.
      </p>
      {first(raw.disputed) === "1" && (
        <p className="panel mt-4 mb-0 px-5 py-3 text-sm" role="status">
          Dispute sent. The organizers will review it, and its status shows on the pull request.
        </p>
      )}

      <nav aria-label="Filter by status" className="mt-6 flex flex-wrap gap-2">
        <FilterLink href={query({ ...filters, status: null })} active={!filters.status} label="All" />
        {(Object.keys(PR_FILTERS) as PrFilter[]).map((key) => (
          <FilterLink
            key={key}
            href={query({ ...filters, status: key })}
            active={filters.status === key}
            label={PR_FILTERS[key].label}
          />
        ))}
      </nav>

      <form method="get" action="/dashboard/prs" className="mt-4 flex flex-wrap items-end gap-3">
        {filters.status && <input type="hidden" name="status" value={filters.status} />}
        <label className="field max-w-48">
          <span className="mb-1.5 text-sm text-(color:--muted)">Level</span>
          <select name="level" defaultValue={filters.level ?? ""}>
            <option value="">Any level</option>
            {(Object.keys(LEVEL_FILTERS) as LevelFilter[]).map((key) => (
              <option key={key} value={key}>
                {key[0]!.toUpperCase() + key.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label className="field max-w-64">
          <span className="mb-1.5 text-sm text-(color:--muted)">Project</span>
          <select name="project" defaultValue={filters.project ?? ""}>
            <option value="">Any project</option>
            {projects.map((project) => (
              <option key={project.slug} value={project.slug}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-ghost btn-sm mb-0.5" type="submit">
          Apply
        </button>
        {filtered && (
          <Link className="mb-2.5 text-sm text-(color:--muted) hover:text-(color:--text)" href="/dashboard/prs">
            Clear filters
          </Link>
        )}
      </form>

      <section className="panel mt-6 p-8">
        {result && result.pullRequests.length > 0 ? (
          <>
            <p className="mt-0 mb-5 font-mono text-xs text-(color:--dim)">
              {result.total} {result.total === 1 ? "pull request" : "pull requests"}
            </p>
            <ul className="m-0 list-none p-0">
              {result.pullRequests.map((pr) => (
                <PrItem key={pr.id} pr={pr} />
              ))}
            </ul>
            <Pagination page={result.page} pages={result.pages} href={(n) => query(filters, n)} />
          </>
        ) : (
          <p className="m-0 text-(color:--muted)">
            {filtered
              ? "No pull requests match these filters."
              : "No pull requests yet. Ones you open on participating projects appear here within a few minutes."}
          </p>
        )}
      </section>
    </div>
  );
}

function FilterLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-full border px-3 py-1 text-sm transition-colors ${
        active
          ? "border-(color:--ice) bg-(color:--ice-soft) text-(color:--text)"
          : "border-(color:--border-strong) text-(color:--muted) hover:text-(color:--text)"
      }`}
    >
      {label}
    </Link>
  );
}
