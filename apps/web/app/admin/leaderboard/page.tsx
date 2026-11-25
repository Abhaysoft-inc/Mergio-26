import { prisma } from "@repo/db";
import { autoFreezeAt, boardPhase } from "@repo/scoring";
import { readBoard, type BoardRow, type LeaderboardSeason } from "@repo/scoring/server";
import type { Metadata } from "next";
import Link from "next/link";
import { unmatchedColleges } from "@/lib/colleges";
import { requireAdmin } from "@/lib/dal";
import { formatDateTime } from "@/lib/format";
import { activeSeason } from "@/lib/projects-server";
import { addCollegeAction, leaderboardAction, mapCollegeAction, verifyAction } from "./actions";
import { ActionButton, AddCollegeForm, MapCollegeForm, VerifyButton } from "./controls";

export const metadata: Metadata = { title: "Leaderboard — Mergio admin" };

const heading = "font-mono text-xs tracking-widest text-(color:--muted) uppercase";

/** The same season, with the freeze ignored: what the live ledger says right now. */
const liveView = (season: LeaderboardSeason): LeaderboardSeason => ({
  ...season,
  leaderboardFrozenAt: null,
  freezeSnapshotId: null,
  finalizedAt: null,
  finalSnapshotId: null,
});

export default async function AdminLeaderboardPage() {
  const user = await requireAdmin();
  const season = await activeSeason();
  if (!season) {
    return <p className="text-(color:--muted)">There is no active season.</p>;
  }
  const phase = boardPhase(season);
  const [publicTop, liveTop, unmatched, people] = await Promise.all([
    readBoard(season, { family: "overall" }, 0, 15),
    phase.phase === "live" ? null : readBoard(liveView(season), { family: "overall" }, 0, 15),
    unmatchedColleges(),
    prisma.user.findMany({
      where: { id: { in: [season.leaderboardFrozenById, season.finalizedById].filter((id): id is string => !!id) } },
      select: { id: true, githubLogin: true, name: true },
    }),
  ]);
  const who = (id: string | null) => {
    if (!id) return "automatically";
    const person = people.find((p) => p.id === id);
    return person ? `by @${person.githubLogin ?? person.name}` : "by an organizer";
  };
  const freezeAt = autoFreezeAt(season);

  return (
    <div className="w-full">
      <h1 className="text-4xl leading-tight font-semibold tracking-tight">Leaderboard</h1>
      <p className="mt-2 max-w-2xl text-(color:--muted)">
        Freeze, finalize and check the boards for {season.name}. While frozen, every rank shown
        (public boards, the API and contributors&apos; dashboards) is the frozen one; scoring carries on.
        <Link href="/leaderboard" className="ml-2 text-(color:--ice) hover:underline">
          Open the public board
        </Link>
      </p>

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <section className="panel p-6">
            <h2 className={heading}>State</h2>
            <p className="mt-3 mb-0 text-2xl font-semibold">
              {phase.phase === "final" ? "Finalized" : phase.phase === "frozen" ? "Frozen" : "Live"}
            </p>
            <ul className="mt-3 mb-0 list-none space-y-1 p-0 text-sm text-(color:--muted)">
              <li>
                Coding ends:{" "}
                {season.codingEndsAt ? formatDateTime(season.codingEndsAt) : "not set"}
              </li>
              <li>
                Automatic freeze:{" "}
                {!season.leaderboardAutoFreeze
                  ? "off (an organizer unfroze the board)"
                  : freezeAt
                    ? formatDateTime(freezeAt)
                    : "once coding has an end date"}
              </li>
              {season.leaderboardFrozenAt && (
                <li>
                  Frozen {formatDateTime(season.leaderboardFrozenAt)} {who(season.leaderboardFrozenById)}
                </li>
              )}
              {season.finalizedAt && (
                <li>
                  Finalized {formatDateTime(season.finalizedAt)} {who(season.finalizedById)}. The ledger is
                  locked.
                </li>
              )}
            </ul>

            <div className="mt-5 flex flex-wrap gap-4">
              {phase.phase === "live" && (
                <ActionButton
                  action={leaderboardAction.bind(null, "freeze")}
                  label="Freeze now"
                  confirm="Freeze the leaderboard? Everyone will see today's ranks until it is unfrozen or finalized."
                  primary
                />
              )}
              {phase.phase === "frozen" && (
                <ActionButton
                  action={leaderboardAction.bind(null, "unfreeze")}
                  label="Unfreeze"
                  confirm="Show live ranks again? The board won't freeze by itself again this season."
                />
              )}
              {phase.phase !== "final" && (
                <ActionButton
                  action={leaderboardAction.bind(null, "finalize")}
                  label="Finalize results"
                  confirm="Finalize? This locks the ledger: no more points, mentor points or badges, and the current live ranks become the official results."
                  primary={phase.phase === "frozen"}
                />
              )}
              {phase.phase === "final" && user.isSuperAdmin === true && (
                <ActionButton
                  action={leaderboardAction.bind(null, "unfinalize")}
                  label="Unfinalize"
                  confirm="Unfinalize? The ledger opens again and the official results are withdrawn."
                />
              )}
              {phase.phase === "final" && user.isSuperAdmin !== true && (
                <p className="m-0 text-sm text-(color:--dim)">Only a Super Admin can unfinalize.</p>
              )}
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-2">
            <TopList title={phase.phase === "live" ? "Top 15 (live)" : "Top 15 (public)"} rows={publicTop.rows} />
            {liveTop && <TopList title="Top 15 (live, hidden)" rows={liveTop.rows} />}
          </div>

          <section className="panel p-6">
            <h2 className={heading}>Colleges to map · {unmatched.total}</h2>
            <p className="mt-1 text-sm text-(color:--muted)">
              What people typed that matches no college. Mapping a spelling applies to everyone who typed it, now
              and later.
            </p>
            {unmatched.groups.length > 0 ? (
              <ul className="mt-4 mb-0 list-none space-y-4 p-0">
                {unmatched.groups.map((group) => (
                  <li key={group.normalized} className="border-t border-(color:--border) pt-4 first:border-t-0 first:pt-0">
                    <p className="m-0 mb-2 text-sm">
                      <b>{group.label}</b>{" "}
                      <span className="text-(color:--dim)">
                        · {group.count} {group.count === 1 ? "person" : "people"}
                      </span>
                    </p>
                    <MapCollegeForm
                      action={mapCollegeAction.bind(null, group.label)}
                      inputId={`map-${group.normalized.replace(/\W+/g, "-")}`}
                      label={group.label}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 mb-0 text-sm text-(color:--muted)">Everyone&apos;s college is matched.</p>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-4">
          <section className="panel p-6">
            <h2 className={heading}>Check</h2>
            <p className="mt-1 mb-4 text-sm text-(color:--muted)">
              Redis serves the boards; Postgres is the source of truth. The worker compares every board nightly and
              rebuilds any that differ.
            </p>
            <VerifyButton action={verifyAction} />
            <div className="mt-5">
              <ActionButton
                action={leaderboardAction.bind(null, "rebuild")}
                label="Rebuild all live boards"
                confirm="Drop the cached live boards? Each one rebuilds from Postgres on its next read."
              />
            </div>
          </section>

          <section className="panel p-6">
            <h2 className={heading}>Add a college</h2>
            <p className="mt-1 mb-4 text-sm text-(color:--muted)">
              For institutions missing from the AICTE and UGC lists.
            </p>
            <AddCollegeForm action={addCollegeAction} />
          </section>
        </div>
      </div>
    </div>
  );
}

function TopList({ title, rows }: { title: string; rows: BoardRow[] }) {
  return (
    <section className="panel p-6">
      <h2 className={heading}>{title}</h2>
      {rows.length > 0 ? (
        <ol className="mt-4 mb-0 list-none p-0 text-sm">
          {rows.map((row) => (
            <li key={row.id} className="flex justify-between gap-3 border-b border-(color:--border) py-1.5 last:border-b-0">
              <span className="min-w-0 truncate">
                <span className="mr-2 font-mono text-(color:--dim)">#{row.rank}</span>
                {row.entity?.kind === "user" ? (row.entity.login ? `@${row.entity.login}` : row.entity.name) : row.id}
              </span>
              <span className="font-mono tabular-nums">{row.points}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-3 mb-0 text-sm text-(color:--muted)">Nobody ranked yet.</p>
      )}
    </section>
  );
}
