// Load test for the leaderboard API (F-08 acceptance: p95 under 300 ms at 20,000 ranked users).
// Run against a seeded season (leaderboard:seed) with the web app running:
//
//   pnpm --filter backend leaderboard:load [--base http://localhost:3001] [--requests 2000] [--concurrency 20]
//
// The request mix: random pages of the overall and weekly boards, searches, filters and the
// colleges board. Cold caches are warmed first, so a one-off rebuild doesn't count.
const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
};
const base = flag("--base", "http://localhost:3001").replace(/\/$/, "");
const total = Number(flag("--requests", "2000"));
const concurrency = Number(flag("--concurrency", "20"));

const paths = [
  () => `/api/v1/leaderboards/overall?page=${1 + Math.floor(Math.random() * 400)}`,
  () => `/api/v1/leaderboards/overall?page=${1 + Math.floor(Math.random() * 400)}`,
  () => `/api/v1/leaderboards/weekly?page=${1 + Math.floor(Math.random() * 100)}`,
  () => `/api/v1/leaderboards/overall?q=lt-user-${Math.floor(Math.random() * 20_000)}`,
  () => `/api/v1/leaderboards/overall?state=Kerala&page=${1 + Math.floor(Math.random() * 20)}`,
  () => `/api/v1/leaderboards/overall?gradYear=2027&page=${1 + Math.floor(Math.random() * 40)}`,
  () => `/api/v1/leaderboards/colleges?page=${1 + Math.floor(Math.random() * 6)}`,
  () => `/api/v1/leaderboards/college:loadtest-college-${1 + Math.floor(Math.random() * 300)}`,
];

async function time(path: string) {
  const started = performance.now();
  const response = await fetch(base + path);
  await response.arrayBuffer();
  if (!response.ok) throw new Error(`${response.status} ${path}`);
  return { ms: performance.now() - started, source: response.headers.get("x-leaderboard-source") };
}

console.log("Warming caches…");
for (const path of ["/api/v1/leaderboards/overall", "/api/v1/leaderboards/weekly", "/api/v1/leaderboards/colleges"]) {
  await time(path);
}

const durations: number[] = [];
const sources = new Map<string, number>();
let errors = 0;
let issued = 0;
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (issued < total) {
      issued++;
      try {
        const { ms, source } = await time(paths[Math.floor(Math.random() * paths.length)]!());
        durations.push(ms);
        sources.set(source ?? "?", (sources.get(source ?? "?") ?? 0) + 1);
      } catch (error) {
        errors++;
        if (errors <= 5) console.error(error instanceof Error ? error.message : error);
      }
    }
  }),
);

durations.sort((a, b) => a - b);
const percentile = (p: number) => durations[Math.min(durations.length - 1, Math.floor((p / 100) * durations.length))] ?? 0;
console.log(`${durations.length} requests, ${errors} errors, concurrency ${concurrency}`);
console.log(`p50 ${percentile(50).toFixed(0)} ms · p95 ${percentile(95).toFixed(0)} ms · p99 ${percentile(99).toFixed(0)} ms`);
console.log(`served from: ${[...sources].map(([source, count]) => `${source} ${count}`).join(", ")}`);
process.exit(percentile(95) < 300 && errors === 0 ? 0 : 1);
