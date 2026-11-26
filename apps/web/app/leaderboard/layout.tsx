import Link from "next/link";
import { SkyShell } from "@/components/site/sky-shell";
import { getSession } from "@/lib/dal";

// Public leaderboards (F-08): indexable, like the project pages.
export default async function LeaderboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <SkyShell
      wide
      nav={
        <nav aria-label="Leaderboard" className="flex items-center gap-1 text-sm font-medium">
          <Link
            href="/projects"
            className="rounded-full px-3 py-1.5 text-(color:--muted) transition-colors hover:text-(color:--text)"
          >
            Projects
          </Link>
          <Link
            href="/leaderboard"
            className="rounded-full px-3 py-1.5 text-(color:--muted) transition-colors hover:text-(color:--text)"
          >
            Leaderboard
          </Link>
          <Link
            href={session ? "/dashboard" : "/register"}
            className="rounded-full px-3 py-1.5 text-(color:--muted) transition-colors hover:text-(color:--text)"
          >
            {session ? "Dashboard" : "Register"}
          </Link>
        </nav>
      }
    >
      {children}
    </SkyShell>
  );
}
