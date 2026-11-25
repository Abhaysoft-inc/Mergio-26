import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Chip } from "@/components/dashboard/pr-item";
import { contributorPullRequest } from "@/lib/contributor";
import { requireUser } from "@/lib/dal";
import { DISPUTE_STATUS_LABELS } from "@/lib/disputes";
import { formatDateTime, signed } from "@/lib/format";
import { DisputeForm } from "./dispute-form";

export const metadata: Metadata = {
  title: "Raise a dispute — Mergio",
};

export default async function DisputePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  // Only the PR's author gets anything but a 404.
  const found = await contributorPullRequest(user.id, id);
  if (!found) notFound();
  const { pr } = found;

  return (
    <div className="w-full max-w-2xl">
      <Link href="/dashboard/prs" className="text-sm text-(color:--muted) hover:text-(color:--text)">
        ← Pull requests
      </Link>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Raise a dispute</h1>

      <section className="panel mt-6 p-6">
        <a
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium break-words hover:text-(color:--ice)"
        >
          {pr.title}
        </a>
        <p className="mt-0.5 mb-0 font-mono text-xs text-(color:--dim)">
          {pr.repo}#{pr.number} · {pr.project.name}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Chip tone={pr.display.tone}>{pr.display.label}</Chip>
          <span className="font-mono text-sm tabular-nums">{signed(pr.points)} pts</span>
        </div>
        {pr.reason && (
          <p className="mt-3 mb-0 text-sm text-(color:--muted)">
            <span className="font-medium text-(color:--text)">{pr.reason.title}.</span> {pr.reason.text}
          </p>
        )}
      </section>

      <section className="panel mt-4 p-8">
        {pr.canDispute ? (
          <>
            <p className="mt-0 mb-6 text-(color:--muted)">
              Disputes go to the organizers and the project&apos;s mentors. You can dispute until{" "}
              {pr.disputeUntil ? formatDateTime(pr.disputeUntil) : "the window closes"}.
            </p>
            <DisputeForm pullRequestId={pr.id} />
          </>
        ) : (
          <p className="m-0 text-(color:--muted)">
            {pr.dispute && ["OPEN", "IN_REVIEW"].includes(pr.dispute.status)
              ? `${DISPUTE_STATUS_LABELS[pr.dispute.status]}: the organizers will get back to you.`
              : !pr.mergedAt
                ? "Only merged pull requests can be disputed."
                : pr.status === "AWAITING_LABEL"
                  ? "This pull request is still waiting for its labels. Check back once it has been scored."
                  : "The dispute window for this pull request has closed."}
          </p>
        )}
      </section>
    </div>
  );
}
