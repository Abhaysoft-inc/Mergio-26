import type { Metadata } from "next";
import Link from "next/link";
import { SkyShell } from "@/components/site/sky-shell";

// Account pages are for signed-in people and have no use in search results.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const link =
    "rounded-full px-3 py-1.5 text-(color:--muted) transition-colors hover:text-(color:--text)";
  return (
    <SkyShell
      nav={
        <nav aria-label="Site" className="flex items-center gap-1 text-sm font-medium">
          <Link href="/projects" className={link}>
            Projects
          </Link>
          <Link href="/leaderboard" className={link}>
            Leaderboard
          </Link>
        </nav>
      }
    >
      {children}
    </SkyShell>
  );
}
