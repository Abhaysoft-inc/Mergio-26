import Link from "next/link";
import type { PullRequestView, StatusTone } from "@/lib/contributor";
import { DISPUTE_STATUS_LABELS } from "@/lib/disputes";
import { formatDate, formatDateTime, signed } from "@/lib/format";

export const toneClass: Record<StatusTone, string> = {
  muted: "text-(color:--muted)",
  ice: "text-(color:--ice)",
  gold: "text-(color:--gold)",
  green: "text-(color:--green)",
  red: "text-[#E5484D]",
};

export function Chip({ tone, children }: { tone: StatusTone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-(color:--border-strong) px-2.5 py-0.5 font-mono text-[11px] tracking-wide whitespace-nowrap uppercase ${toneClass[tone]}`}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {children}
    </span>
  );
}

/** One PR in the timeline: status, points, and exactly why when it didn't count. */
export function PrItem({ pr }: { pr: PullRequestView }) {
  const when = pr.mergedAt
    ? `merged ${formatDate(pr.mergedAt)}`
    : pr.closedAt
      ? `closed ${formatDate(pr.closedAt)}`
      : `opened ${formatDate(pr.openedAt)}`;

  return (
    <li className="border-b border-(color:--border) py-4 first:pt-0 last:border-b-0 last:pb-0">
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
          <p className="mt-0.5 font-mono text-xs text-(color:--dim)">
            {pr.repo}#{pr.number} · {pr.project.name} · {when}
            {pr.levelName ? ` · ${pr.levelName}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Chip tone={pr.display.tone}>{pr.display.label}</Chip>
          {(pr.status === "SCORED" || pr.points !== 0) && (
            <span
              className={`font-mono text-sm font-semibold tabular-nums ${pr.points > 0 ? "text-(color:--green)" : "text-(color:--muted)"}`}
            >
              {signed(pr.points)}
            </span>
          )}
        </div>
      </div>

      {pr.reason && (
        <p className="mt-2 text-sm text-(color:--muted)">
          <span className="font-medium text-(color:--text)">{pr.reason.title}.</span>{" "}
          {pr.reason.text}
        </p>
      )}
      {pr.status === "AWAITING_LABEL" && pr.labelDeadline && (
        <p className="mt-2 text-sm text-(color:--muted)">
          Merged, waiting for a mentor to add the level label. If none is added by{" "}
          {formatDateTime(pr.labelDeadline)}, it won&apos;t count.
        </p>
      )}
      {pr.notes.length > 0 && (
        <ul className="mt-2 mb-0 list-disc pl-5 text-sm text-(color:--muted)">
          {pr.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      {(pr.dispute || pr.canDispute) && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {pr.dispute && (
            <Chip tone={pr.dispute.status === "UPHELD" ? "green" : pr.dispute.status === "REJECTED" ? "red" : "gold"}>
              {DISPUTE_STATUS_LABELS[pr.dispute.status]}
            </Chip>
          )}
          {pr.canDispute && (
            <Link
              href={`/dashboard/prs/${pr.id}/dispute`}
              className="text-sm font-medium text-(color:--ice) hover:underline"
            >
              Raise a dispute
            </Link>
          )}
        </div>
      )}
    </li>
  );
}

export function Pagination({
  page,
  pages,
  href,
}: {
  page: number;
  pages: number;
  href: (page: number) => string;
}) {
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pages" className="mt-6 flex items-center justify-between gap-4">
      {page > 1 ? (
        <Link className="btn btn-ghost btn-sm" href={href(page - 1)}>
          Newer
        </Link>
      ) : (
        <span />
      )}
      <span className="font-mono text-xs text-(color:--dim)">
        Page {page} of {pages}
      </span>
      {page < pages ? (
        <Link className="btn btn-ghost btn-sm" href={href(page + 1)}>
          Older
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
