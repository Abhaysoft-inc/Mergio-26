import { prisma, type Prisma } from "@repo/db";
import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/dal";
import { formatDate } from "@/lib/format";
import { isSuperAdmin, parseStaffRole } from "@/lib/roles";
import { UserControls } from "./user-controls";

export const metadata: Metadata = { title: "Users — Mergio" };

type TabKey = "all" | "staff" | "banned";

const TABS: { key: TabKey; label: string; where: Prisma.UserWhereInput }[] = [
  { key: "all", label: "All", where: {} },
  {
    key: "staff",
    label: "Staff",
    where: { OR: [{ staffRole: { not: null } }, { isAdmin: true }, { isSuperAdmin: true }] },
  },
  { key: "banned", label: "Banned", where: { bannedAt: { not: null } } },
];

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string }>;
}) {
  const [actor, params] = await Promise.all([requireAdmin(), searchParams]);
  const tab = TABS.find((t) => t.key === params.tab) ?? TABS[0]!;
  const query = params.q?.trim() ?? "";
  const canEditStaffRole = isSuperAdmin(actor);

  const searchWhere: Prisma.UserWhereInput = query
    ? {
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { email: { contains: query, mode: "insensitive" } },
          { githubLogin: { contains: query, mode: "insensitive" } },
        ],
      }
    : {};

  const [counts, users] = await Promise.all([
    Promise.all(TABS.map((t) => prisma.user.count({ where: t.where }))),
    prisma.user.findMany({
      where: { AND: [tab.where, searchWhere] },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        name: true,
        email: true,
        githubLogin: true,
        staffRole: true,
        isAdmin: true,
        isSuperAdmin: true,
        bannedAt: true,
        banReason: true,
        createdAt: true,
        _count: { select: { sessions: true } },
      },
    }),
  ]);

  return (
    <div className="w-full">
      <h1 className="text-4xl leading-tight font-semibold tracking-tight">Users</h1>
      <p className="mt-2 max-w-xl text-(color:--muted)">
        Manage user bans, active sessions, and platform staff roles.
      </p>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <nav aria-label="User filter" className="flex flex-wrap gap-2">
          {TABS.map((t, index) => (
            <Link
              key={t.key}
              href={`/admin/users?tab=${t.key}${query ? `&q=${encodeURIComponent(query)}` : ""}`}
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

        <form action="/admin/users" method="get" className="flex items-center gap-2">
          <input type="hidden" name="tab" value={tab.key} />
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search name, @login, email"
            aria-label="Search users"
            className="w-60 rounded-full border border-(color:--border-strong) bg-(color:--surface-2) px-3.5 py-1.5 text-sm text-(color:--text)"
          />
          <button type="submit" className="btn btn-ghost btn-sm">
            Search
          </button>
        </form>
      </div>

      <section className="panel mt-6 p-8">
        {users.length > 0 ? (
          <ul className="m-0 list-none p-0">
            {users.map((u) => {
              const staffRole =
                parseStaffRole(u.staffRole) ??
                (u.isSuperAdmin ? "SUPER_ADMIN" : u.isAdmin ? "ORGANIZER" : null);
              return (
                <li
                  key={u.id}
                  className="flex flex-wrap items-start justify-between gap-4 border-b border-(color:--border) py-4 first:pt-0 last:border-b-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="m-0 font-medium">{u.name}</p>
                      {u.githubLogin && (
                        <a
                          href={`https://github.com/${u.githubLogin}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-sm text-(color:--muted) hover:text-(color:--ice)"
                        >
                          @{u.githubLogin}
                        </a>
                      )}
                      {staffRole && (
                        <span className="rounded-full border border-(color:--ice) bg-(color:--ice-soft) px-2 py-0.5 font-mono text-[11px] uppercase">
                          {staffRole === "SUPER_ADMIN" ? "Super Admin" : "Organizer"}
                        </span>
                      )}
                      {u.bannedAt && (
                        <span className="rounded-full border border-[#E5484D]/40 bg-[#E5484D]/10 px-2 py-0.5 font-mono text-[11px] text-[#E5484D] uppercase">
                          Banned
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 mb-0 text-sm text-(color:--dim)">
                      {[
                        u.email,
                        `${u._count.sessions} active ${u._count.sessions === 1 ? "session" : "sessions"}`,
                        `joined ${formatDate(u.createdAt)}`,
                      ].join(" · ")}
                    </p>
                    {u.bannedAt && u.banReason && (
                      <p className="mt-1 mb-0 text-xs text-[#E5484D]">Reason: {u.banReason}</p>
                    )}
                  </div>

                  <UserControls
                    userId={u.id}
                    isSelf={u.id === actor.id}
                    isBanned={Boolean(u.bannedAt)}
                    isTargetSuperAdmin={staffRole === "SUPER_ADMIN"}
                    isTargetOrganizer={staffRole === "ORGANIZER"}
                    currentStaffRole={staffRole}
                    canEditStaffRole={canEditStaffRole}
                    sessionCount={u._count.sessions}
                  />
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="m-0 text-(color:--muted)">No users matched.</p>
        )}
      </section>
    </div>
  );
}
