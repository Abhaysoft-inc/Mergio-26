import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Chip, Pagination } from "@/components/dashboard/pr-item";
import { contributorLedger, contributorStats, isContributor } from "@/lib/contributor";
import { requireUser } from "@/lib/dal";
import { formatDate, formatDateTime, signed } from "@/lib/format";
import { activeSeason } from "@/lib/projects-server";
import { AccountNav } from "../../account-nav";

export const metadata: Metadata = {
  title: "Points — Mergio",
};

const KIND_LABELS = {
  AWARD: null,
  REVERSAL: "Reversal",
  ADJUSTMENT: "Adjustment",
  DISPUTE_CORRECTION: "Dispute correction",
} as const;

export default async function PointsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const user = await requireUser();
  if (!(await isContributor(user.id))) redirect("/dashboard");
  const rawPage = (await searchParams).page;
  const page = Math.max(1, Number.parseInt((Array.isArray(rawPage) ? rawPage[0] : rawPage) ?? "1", 10) || 1);

  const season = await activeSeason();
  const [ledger, stats] = season
    ? await Promise.all([contributorLedger(user.id, season, { page }), contributorStats(user.id, season)])
    : [null, null];

  return (
    <div className="w-full max-w-4xl">
      <AccountNav active="points" user={user} />

      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Points</h1>
          <p className="mt-2 mb-0 max-w-xl text-(color:--muted)">
            Every change to your score, with the reason. Points are never edited: a correction is a
            new entry.
          </p>
        </div>
        {stats && (
          <div className="text-right">
            <p className="m-0 text-4xl font-semibold tabular-nums">{stats.points}</p>
            <p className="m-0 font-mono text-xs text-(color:--dim)">
              points{stats.heldPoints > 0 ? ` · +${stats.heldPoints} held` : ""}
            </p>
          </div>
        )}
      </div>

      <section className="panel mt-6 p-8">
        {ledger && ledger.entries.length > 0 ? (
          <>
            <ul className="m-0 list-none p-0">
              {ledger.entries.map((entry) => (
                <li
                  key={entry.id}
                  className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-b border-(color:--border) py-4 first:pt-0 last:border-b-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="m-0 flex flex-wrap items-center gap-2 font-medium">
                      {entry.description}
                      {KIND_LABELS[entry.kind] && <Chip tone="muted">{KIND_LABELS[entry.kind]}</Chip>}
                      {entry.held && <Chip tone="gold">Held</Chip>}
                    </p>
                    {entry.pullRequest && (
                      <a
                        href={entry.pullRequest.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-0.5 block font-mono text-xs break-words text-(color:--dim) hover:text-(color:--ice)"
                      >
                        {entry.pullRequest.repo}#{entry.pullRequest.number} · {entry.pullRequest.title}
                      </a>
                    )}
                    {entry.reason && (
                      <p className="mt-1.5 mb-0 text-sm text-(color:--muted)">{entry.reason.text}</p>
                    )}
                    {entry.held && (
                      <p className="mt-1.5 mb-0 text-sm text-(color:--muted)">
                        Over the daily cap, so these count from {formatDateTime(entry.effectiveAt)}.
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p
                      className={`m-0 font-mono text-lg font-semibold tabular-nums ${entry.points > 0 ? "text-(color:--green)" : "text-[#E5484D]"}`}
                    >
                      {signed(entry.points)}
                    </p>
                    <p className="m-0 font-mono text-xs text-(color:--dim)">{formatDate(entry.effectiveAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
            <Pagination
              page={ledger.page}
              pages={ledger.pages}
              href={(n) => (n > 1 ? `/dashboard/points?page=${n}` : "/dashboard/points")}
            />
          </>
        ) : (
          <p className="m-0 text-(color:--muted)">
            No points yet. They appear here as soon as a merged pull request is scored.
          </p>
        )}
      </section>
    </div>
  );
}
