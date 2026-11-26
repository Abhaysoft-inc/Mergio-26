import { prisma } from "@repo/db";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Icon } from "@/components/landing/icon";
import { collegeStates } from "@/lib/colleges";
import { formatDateTime } from "@/lib/format";
import {
  boardPage,
  hasFilters,
  myPosition,
  phaseOf,
  type Filters,
  type ResolvedBoard,
} from "@/lib/leaderboard";
import type { BoardRow, LeaderboardSeason } from "@repo/scoring/server";

// One leaderboard page: tabs, the freeze banner, search and filters, "jump to me", the table and
// paging. Used by /leaderboard and /leaderboard/colleges/[slug].

const TABS = [
  { view: "overall", label: "Overall" },
  { view: "weekly", label: "This week" },
  { view: "project", label: "Projects" },
  { view: "colleges", label: "Colleges" },
  { view: "mentors", label: "Mentors" },
] as const;

const heading = "font-mono text-[13px] font-medium tracking-widest text-(color:--muted) uppercase";

type Params = Record<string, string | number | null | undefined>;

function href(path: string, params: Params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "" && !(key === "page" && value === 1)) {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text ? `${path}?${text}` : path;
}

export async function LeaderboardScreen({
  season,
  resolved,
  filters,
  page,
  viewerId,
  path,
  fixedParams,
  title,
  intro,
}: {
  season: LeaderboardSeason & { name: string };
  resolved: ResolvedBoard;
  filters: Filters;
  page: number;
  viewerId: string | null;
  /** The page's own path, and the params that select its board (view, project). */
  path: string;
  fixedParams: Params;
  title: string;
  intro: string;
}) {
  const now = new Date();
  const people = resolved.view !== "colleges" && resolved.view !== "mentors";
  const [result, mine, states, colleges] = await Promise.all([
    boardPage(season, resolved, filters, page, now),
    viewerId ? myPosition(season, resolved, viewerId, now) : null,
    collegeStates(),
    // Colleges with someone registered, for the filter.
    people && resolved.view !== "college"
      ? prisma.college.findMany({
          where: { profiles: { some: {} } },
          select: { slug: true, name: true },
          orderBy: { name: "asc" },
          take: 500,
        })
      : [],
  ]);
  const phase = phaseOf(season);
  const filterParams: Params = {
    q: filters.q,
    college: filters.college,
    state: filters.state,
    gradYear: filters.graduationYear,
  };
  const pageHref = (n: number) => href(path, { ...fixedParams, ...filterParams, page: n });
  // Past the last page (an old link, or a board that shrank): go to the last one.
  if (result.page > result.pages) redirect(pageHref(result.pages));

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs tracking-widest text-(color:--ice) uppercase">{season.name}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
          <p className="mt-2 mb-0 max-w-2xl text-(color:--muted)">{intro}</p>
        </div>
        {mine?.page && (
          <Link
            className="btn btn-ghost btn-sm"
            href={`${href(path, { ...fixedParams, page: mine.page })}#me`}
          >
            Jump to me · #{mine.row?.rank}
          </Link>
        )}
      </div>

      {phase.phase !== "live" && (
        <p
          className="panel mt-5 mb-0 flex items-start gap-3 border-(color:--gold)! px-5 py-4 text-sm"
          role="status"
        >
          <span className="text-(color:--gold)">
            <Icon name="flake" size={16} />
          </span>
          <span>
            {phase.phase === "final" ? (
              <>
                <b>Final results.</b> These ranks were made official on {formatDateTime(phase.since)}.
              </>
            ) : (
              <>
                <b>The leaderboard is frozen</b> as of {formatDateTime(phase.since)}, for the last 48
                hours of the season. Pull requests still score; the final ranks are revealed when the
                organizers publish the results.
              </>
            )}
          </span>
        </p>
      )}

      <nav aria-label="Leaderboards" className="mt-6 flex flex-wrap gap-2">
        {TABS.map((tab) => {
          const active =
            resolved.view === tab.view || (tab.view === "colleges" && resolved.view === "college");
          return (
            <Link
              key={tab.view}
              href={tab.view === "overall" ? "/leaderboard" : `/leaderboard?view=${tab.view}`}
              aria-current={active ? "page" : undefined}
              className={`rounded-full border px-3.5 py-1 text-sm transition-colors ${
                active
                  ? "border-(color:--ice) bg-(color:--ice-soft) text-(color:--text)"
                  : "border-(color:--border-strong) text-(color:--muted) hover:text-(color:--text)"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <form method="get" action={path} className="mt-5 flex flex-wrap items-end gap-3" role="search">
        {Object.entries(fixedParams).map(([key, value]) =>
          value ? <input key={key} type="hidden" name={key} value={String(value)} /> : null,
        )}
        <label className="field max-w-64 flex-1">
          <span className="mb-1.5 text-sm text-(color:--muted)">
            {resolved.view === "colleges" ? "College" : "Name or GitHub login"}
          </span>
          <input type="search" name="q" defaultValue={filters.q ?? ""} placeholder="Search" />
        </label>
        {colleges.length > 0 && (
          <label className="field max-w-64">
            <span className="mb-1.5 text-sm text-(color:--muted)">College</span>
            <select name="college" defaultValue={filters.college ?? ""}>
              <option value="">Any college</option>
              {colleges.map((college) => (
                <option key={college.slug} value={college.slug}>
                  {college.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {resolved.view !== "mentors" && resolved.view !== "college" && states.length > 0 && (
          <label className="field max-w-48">
            <span className="mb-1.5 text-sm text-(color:--muted)">State</span>
            <select name="state" defaultValue={filters.state ?? ""}>
              <option value="">Any state</option>
              {states.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
          </label>
        )}
        {people && (
          <label className="field max-w-36">
            <span className="mb-1.5 text-sm text-(color:--muted)">Graduating</span>
            <select name="gradYear" defaultValue={filters.graduationYear ?? ""}>
              <option value="">Any year</option>
              {Array.from({ length: 9 }, (_, i) => now.getFullYear() - 2 + i).map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="btn btn-ghost btn-sm mb-0.5" type="submit">
          Apply
        </button>
        {hasFilters(filters) && (
          <Link className="mb-2.5 text-sm text-(color:--muted) hover:text-(color:--text)" href={href(path, fixedParams)}>
            Clear
          </Link>
        )}
      </form>

      <section className="panel mt-5 overflow-x-auto p-0">
        {result.rows.length > 0 ? (
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <caption className="sr-only">
              {title}, page {result.page} of {result.pages}
            </caption>
            <thead>
              <tr className="border-b border-(color:--border) text-left">
                <th scope="col" className={`${heading} px-5 py-3 text-xs!`}>Rank</th>
                <th scope="col" className={`${heading} px-3 py-3 text-xs!`}>
                  {resolved.view === "colleges" ? "College" : resolved.view === "mentors" ? "Mentor" : "Contributor"}
                </th>
                {people && <th scope="col" className={`${heading} px-3 py-3 text-xs!`}>College</th>}
                {resolved.view !== "mentors" && (
                  <th scope="col" className={`${heading} px-3 py-3 text-right text-xs!`}>
                    <abbr title="Scored PRs: beginner · intermediate · advanced">PRs B·I·A</abbr>
                  </th>
                )}
                {people && <th scope="col" className={`${heading} px-3 py-3 text-xs!`}>Badges</th>}
                <th scope="col" className={`${heading} px-5 py-3 text-right text-xs!`}>Points</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <Row
                  key={row.id}
                  row={row}
                  view={resolved.view}
                  mine={Boolean(mine?.row && mine.row.id === row.id)}
                />
              ))}
            </tbody>
          </table>
        ) : (
          <p className="m-0 p-8 text-(color:--muted)">
            {hasFilters(filters)
              ? "Nobody on this board matches these filters."
              : "No one is ranked yet. The board fills up as merged pull requests are scored."}
          </p>
        )}
      </section>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
        <p className="m-0 font-mono text-xs text-(color:--dim)">
          {hasFilters(filters)
            ? `${result.total} of ${result.boardTotal} ranked match`
            : `${result.total} ranked`}
          {" · ranks are positions on the whole board"}
        </p>
        {result.pages > 1 && (
          <nav aria-label="Pages" className="flex items-center gap-3">
            {result.page > 1 && (
              <Link className="btn btn-ghost btn-sm" href={pageHref(result.page - 1)}>
                Previous
              </Link>
            )}
            <span className="font-mono text-xs text-(color:--dim)">
              Page {result.page} of {result.pages}
            </span>
            {result.page < result.pages && (
              <Link className="btn btn-ghost btn-sm" href={pageHref(result.page + 1)}>
                Next
              </Link>
            )}
          </nav>
        )}
      </div>
    </div>
  );
}

function Change({ change }: { change: number | null }) {
  if (change === null) return <span className="text-(color:--dim)">·</span>;
  if (change === 0) return <span className="text-(color:--dim)" title="No change since yesterday">–</span>;
  return change > 0 ? (
    <span className="text-(color:--green)" title={`Up ${change} since yesterday`}>
      ▲{change}
    </span>
  ) : (
    <span className="text-[#E5484D]" title={`Down ${-change} since yesterday`}>
      ▼{-change}
    </span>
  );
}

function Row({ row, view, mine }: { row: BoardRow; view: ResolvedBoard["view"]; mine: boolean }) {
  const people = view !== "colleges" && view !== "mentors";
  const entity = row.entity;
  return (
    <tr
      id={mine ? "me" : undefined}
      className={`border-b border-(color:--border) last:border-b-0 ${mine ? "bg-(color:--ice-soft)" : ""}`}
    >
      <td className="px-5 py-3 whitespace-nowrap">
        <span className="font-mono font-semibold tabular-nums">#{row.rank}</span>{" "}
        <span className="ml-1 font-mono text-xs">
          <Change change={row.change} />
        </span>
      </td>
      <td className="px-3 py-3">
        {entity?.kind === "college" ? (
          <Link href={`/leaderboard/colleges/${entity.slug}`} className="font-medium hover:text-(color:--ice)">
            {entity.name}
            <span className="block text-xs font-normal text-(color:--dim)">
              {[entity.city, entity.state].filter(Boolean).join(", ")}
            </span>
          </Link>
        ) : entity?.kind === "user" ? (
          <span className="flex items-center gap-3">
            {entity.image ? (
              // eslint-disable-next-line @next/next/no-img-element -- remote GitHub avatar, no loader configured
              <img src={entity.image} alt="" width={28} height={28} className="size-7 rounded-full" loading="lazy" />
            ) : (
              <span className="size-7 rounded-full bg-(color:--border-strong)" aria-hidden="true" />
            )}
            <span className="min-w-0">
              <span className="block truncate font-medium">
                {entity.login ? (
                  <Link href={`/leaderboard/users/${entity.login}`} className="hover:text-(color:--ice)">
                    {entity.name}
                  </Link>
                ) : (
                  entity.name
                )}
                {mine && <span className="ml-2 font-mono text-[11px] text-(color:--ice)">YOU</span>}
              </span>
              {entity.login && (
                <a
                  href={`https://github.com/${entity.login}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block font-mono text-xs text-(color:--dim) hover:text-(color:--ice)"
                >
                  @{entity.login}
                </a>
              )}
            </span>
          </span>
        ) : (
          <span className="text-(color:--dim)">Unknown</span>
        )}
      </td>
      {people && (
        <td className="px-3 py-3 text-(color:--muted)">
          {entity?.kind === "user" && entity.college ? (
            <Link href={`/leaderboard/colleges/${entity.college.slug}`} className="hover:text-(color:--ice)">
              {entity.college.name}
            </Link>
          ) : (
            <span className="text-(color:--dim)">—</span>
          )}
        </td>
      )}
      {view !== "mentors" && (
        <td className="px-3 py-3 text-right font-mono text-xs whitespace-nowrap text-(color:--muted) tabular-nums">
          {row.beginner} · {row.intermediate} · {row.advanced}
        </td>
      )}
      {people && (
        <td className="px-3 py-3">
          {entity?.kind === "user" && entity.badges.length > 0 ? (
            <span className="flex flex-wrap gap-1">
              {entity.badges.map((badge) => (
                <span
                  key={badge}
                  className="rounded-full border border-(color:--border-strong) px-2 py-0.5 text-[11px] whitespace-nowrap text-(color:--gold)"
                >
                  {badge}
                </span>
              ))}
            </span>
          ) : null}
        </td>
      )}
      <td className="px-5 py-3 text-right font-mono text-base font-semibold tabular-nums">{row.points}</td>
    </tr>
  );
}
