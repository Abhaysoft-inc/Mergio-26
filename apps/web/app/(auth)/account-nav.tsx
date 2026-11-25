import { prisma } from "@repo/db";
import Link from "next/link";
import { activeMentor } from "@repo/scoring/server";
import { signOutAction } from "./actions";

const tabs = [
  { key: "dashboard", href: "/dashboard", label: "Dashboard", show: "all" },
  { key: "prs", href: "/dashboard/prs", label: "Pull requests", show: "contributor" },
  { key: "points", href: "/dashboard/points", label: "Points", show: "contributor" },
  { key: "mentor", href: "/dashboard/mentor", label: "Mentoring", show: "mentoring" },
  { key: "profile", href: "/profile", label: "My profile", show: "all" },
] as const;

/** Which role tabs a user gets: contributors get their PRs and points, staff get mentoring. */
async function rolesOf(userId: string) {
  const [contributor, mentoring] = await Promise.all([
    prisma.registration.count({ where: { userId, role: "CONTRIBUTOR", status: "APPROVED" } }),
    prisma.project.count({
      where: {
        season: { isActive: true },
        status: "APPROVED",
        OR: [{ ownerId: userId }, { mentors: { some: { AND: [{ userId }, activeMentor] } } }],
      },
    }),
  ]);
  return { contributor: contributor > 0, mentoring: mentoring > 0 };
}

export async function AccountNav({
  active,
  user,
}: {
  active: (typeof tabs)[number]["key"];
  user: { id: string; isAdmin?: boolean | null };
}) {
  const roles = await rolesOf(user.id);
  const visible = tabs.filter(
    (tab) => tab.show === "all" || tab.key === active || roles[tab.show],
  );

  return (
    <nav aria-label="Account" className="mb-6 flex flex-wrap items-center gap-3">
      <div className="flex flex-wrap gap-1 rounded-3xl border border-(color:--border-strong) p-1">
        {visible.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={tab.key === active ? "page" : undefined}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              tab.key === active
                ? "bg-(color:--ice-soft) text-(color:--text)"
                : "text-(color:--muted) hover:text-(color:--text)"
            }`}
          >
            {tab.label}
          </Link>
        ))}
        {user.isAdmin === true && (
          <Link
            href="/admin/projects"
            className="rounded-full px-4 py-1.5 text-sm font-medium text-(color:--muted) transition-colors hover:text-(color:--text)"
          >
            Organizer
          </Link>
        )}
      </div>
      <form action={signOutAction} className="ml-auto">
        <button className="btn btn-ghost btn-sm" type="submit">
          Sign out
        </button>
      </form>
    </nav>
  );
}
