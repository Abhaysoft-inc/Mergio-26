import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/dal";
import { flaggablePullRequest } from "@/lib/mentor-dashboard";
import { FlagForm } from "./flag-form";

export const metadata: Metadata = {
  title: "Flag a contributor — Mergio",
};

export default async function FlagPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  // Only staff of the PR's project (and organizers) see anything but a 404.
  const pr = await flaggablePullRequest(user.id, user.isAdmin === true, id);
  if (!pr) notFound();

  return (
    <div className="w-full max-w-2xl">
      <Link href="/dashboard/mentor" className="text-sm text-(color:--muted) hover:text-(color:--text)">
        ← Mentoring
      </Link>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Flag @{pr.authorLogin}</h1>

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
          {pr.repo.owner}/{pr.repo.name}#{pr.number} · {pr.repo.project.name}
        </p>
      </section>

      <section className="panel mt-4 p-8">
        {pr.authorId === user.id ? (
          <p className="m-0 text-(color:--muted)">This is your own pull request.</p>
        ) : (
          <>
            <p className="mt-0 mb-6 text-(color:--muted)">
              For spam, copied work, low-quality AI output or multiple accounts. To stop a PR from
              counting right away, add the invalid or spam label on GitHub too.
            </p>
            <FlagForm pullRequestId={pr.id} />
          </>
        )}
      </section>
    </div>
  );
}
