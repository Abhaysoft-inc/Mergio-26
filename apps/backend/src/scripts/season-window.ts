// Sets the active season's contribution window, then rescores every PR of the season.
// Until the season admin page (F-03) exists, this is how organizers open scoring:
//   pnpm --filter backend season:window 2026-12-01 2026-12-31
// Both dates are IST calendar days; the window runs from the start of the first to the end of
// the last. With no arguments it prints the current window.
import { prisma } from "@repo/db";
import { addDays, istDayStart } from "@repo/scoring";
import { scorePullRequest } from "../scoring/score-pr";

const [start, end] = process.argv.slice(2);
const season = await prisma.season.findFirst({ where: { isActive: true } });
if (!season) {
  console.error("No active season.");
  process.exit(1);
}

if (!start || !end) {
  console.log(
    `${season.name}: ${season.codingStartsAt?.toISOString() ?? "not set"} to ${season.codingEndsAt?.toISOString() ?? "not set"}`,
  );
  process.exit(0);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
if (!DAY.test(start) || !DAY.test(end) || end < start) {
  console.error("Usage: season:window YYYY-MM-DD YYYY-MM-DD (start, end; IST days)");
  process.exit(1);
}

const codingStartsAt = istDayStart(start);
const codingEndsAt = new Date(istDayStart(addDays(end, 1)).getTime() - 1);
await prisma.season.update({ where: { id: season.id }, data: { codingStartsAt, codingEndsAt } });
console.log(`${season.name}: ${codingStartsAt.toISOString()} to ${codingEndsAt.toISOString()}`);

const prs = await prisma.pullRequest.findMany({
  where: { seasonId: season.id },
  orderBy: { mergedAt: "asc" },
  select: { id: true },
});
for (const pr of prs) await scorePullRequest(pr.id);
console.log(`Rescored ${prs.length} pull requests.`);
await prisma.$disconnect();
