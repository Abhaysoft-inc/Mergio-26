// Compares every live leaderboard in Redis with a fresh SQL computation, rank by rank (F-08
// acceptance: "ranks match a fresh SQL computation"). Exits 1 if any board differs.
//
//   pnpm --filter backend leaderboard:verify [--rebuild]
//
// --rebuild rebuilds each board from Postgres first (checks the build path rather than the
// incremental updates). The worker runs the same check nightly.
import { prisma } from "@repo/db";
import { kv, liveBoardsOf, rebuildLiveBoard, verifyBoard } from "@repo/scoring/server";

const rebuild = process.argv.includes("--rebuild");
const season = await prisma.season.findFirst({ where: { isActive: true } });
if (!season) {
  console.error("No active season.");
  process.exit(1);
}
if (!kv()) {
  console.error("No Redis configured (REDIS_URL or UPSTASH_REDIS_REST_URL); nothing to compare.");
  process.exit(1);
}

const now = new Date();
let failed = 0;
for (const board of await liveBoardsOf(season.id, now)) {
  if (rebuild) await rebuildLiveBoard(season.id, board);
  const result = await verifyBoard(season.id, board, now);
  console.log(`${result.ok ? "ok  " : "DIFF"} ${result.board.padEnd(40)} ${result.redisCount} redis / ${result.sqlCount} sql`);
  for (const difference of result.differences) console.log(`       ${difference}`);
  if (!result.ok) failed++;
}
console.log(failed ? `${failed} boards differ.` : "Every board matches.");
await prisma.$disconnect();
process.exit(failed ? 1 : 0);
