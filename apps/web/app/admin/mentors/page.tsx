import { prisma, type RegistrationStatus } from "@repo/db";
import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/dal";
import { formatDate } from "@/lib/format";
import { reviewMentorAction } from "./actions";
import { ReviewButtons } from "./review-buttons";

export const metadata: Metadata = { title: "Mentor reviews — Mergio" };

const TABS: { key: string; label: string; status: RegistrationStatus }[] = [
  { key: "pending", label: "Waiting", status: "PENDING" },
  { key: "approved", label: "Approved", status: "APPROVED" },
  { key: "rejected", label: "Not approved", status: "REJECTED" },
];

export default async function AdminMentorsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireAdmin();
  const { tab: tabParam } = await searchParams;
  const tab = TABS.find((t) => t.key === tabParam) ?? TABS[0]!;

  const [counts, registrations] = await Promise.all([
    Promise.all(TABS.map((t) => prisma.registration.count({ where: { role: "MENTOR", status: t.status } }))),
    prisma.registration.findMany({
      where: { role: "MENTOR", status: tab.status },
      // Oldest first, so nobody waits longest.
      orderBy: { createdAt: "asc" },
      take: 200,
      include: {
        user: {
          select: {
            name: true,
            githubLogin: true,
            profile: { select: { college: true, graduationYear: true } },
            mentorships: { select: { project: { select: { slug: true, name: true } } } },
          },
        },
      },
    }),
  ]);

  return (
    <div className="w-full">
      <h1 className="text-4xl leading-tight font-semibold tracking-tight">Mentors</h1>
      <p className="mt-2 max-w-xl text-(color:--muted)">
        Approve people who registered as mentors. Project admins then add them to their projects; a
        mentor only becomes active on a project once approved here.
      </p>

      <nav aria-label="Mentor status" className="mt-6 flex flex-wrap gap-2">
        {TABS.map((t, index) => (
          <Link
            key={t.key}
            href={`/admin/mentors?tab=${t.key}`}
            aria-current={t.key === tab.key ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm transition-colors ${
              t.key === tab.key
                ? "border-(color:--ice) bg-(color:--ice-soft) text-(color:--text)"
                : "border-(color:--border-strong) text-(color:--muted) hover:text-(color:--text)"
            }`}
          >
            {t.label} · {counts[index]}
          </Link>
        ))}
      </nav>

      <section className="panel mt-6 p-8">
        {registrations.length > 0 ? (
          <ul className="m-0 list-none p-0">
            {registrations.map((registration) => (
              <li
                key={registration.id}
                className="flex flex-wrap items-center justify-between gap-4 border-b border-(color:--border) py-4 first:pt-0 last:border-b-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="m-0 font-medium">
                    {registration.user.name}
                    {registration.user.githubLogin && (
                      <a
                        href={`https://github.com/${registration.user.githubLogin}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-2 font-mono text-sm text-(color:--muted) hover:text-(color:--ice)"
                      >
                        @{registration.user.githubLogin}
                      </a>
                    )}
                  </p>
                  <p className="mt-0.5 mb-0 text-sm text-(color:--dim)">
                    {[
                      registration.user.profile?.college,
                      registration.user.profile ? `class of ${registration.user.profile.graduationYear}` : null,
                      `registered ${formatDate(registration.createdAt)}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {registration.user.mentorships.length > 0 && (
                    <p className="mt-1 mb-0 text-sm text-(color:--muted)">
                      Invited to:{" "}
                      {registration.user.mentorships.map((mentorship, index) => (
                        <span key={mentorship.project.slug}>
                          {index > 0 && ", "}
                          <Link href={`/projects/${mentorship.project.slug}`} className="hover:text-(color:--ice)">
                            {mentorship.project.name}
                          </Link>
                        </span>
                      ))}
                    </p>
                  )}
                </div>
                <ReviewButtons
                  current={registration.status}
                  approve={reviewMentorAction.bind(null, registration.id, "APPROVED")}
                  reject={reviewMentorAction.bind(null, registration.id, "REJECTED")}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-(color:--muted)">Nobody here.</p>
        )}
      </section>
    </div>
  );
}
