// Seeds a load-test season for the leaderboards (F-08 acceptance: p95 under 300 ms at 20,000
// ranked users). Development only.
//
//   pnpm --filter backend leaderboard:seed [--users 20000] [--yes]   make "loadtest" the active season
//   pnpm --filter backend leaderboard:seed --drop                    remove it again
//
// It creates its own season, project, repo, 300 colleges and N users (emails @loadtest.invalid)
// with scored PRs and ledger entries, including deliberate ties on points, PR levels and time so
// the tie-break rules are exercised. The previously active season is deactivated; --drop
// reactivates it.
import { prisma, type Prisma } from "@repo/db";
import { DEFAULT_RULES } from "@repo/scoring";

const SLUG = "loadtest";
const DOMAIN = "loadtest.invalid";
const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed load-test data in production.");
  process.exit(1);
}

if (args.includes("--drop")) {
  const season = await prisma.season.findUnique({ where: { slug: SLUG } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
  if (season) {
    await prisma.leaderboardSnapshot.deleteMany({ where: { seasonId: season.id } });
    await prisma.scoreEvent.deleteMany({ where: { seasonId: season.id } });
    await prisma.pullRequest.deleteMany({ where: { seasonId: season.id } });
    await prisma.project.deleteMany({ where: { seasonId: season.id } });
    await prisma.season.delete({ where: { id: season.id } });
  }
  await prisma.college.deleteMany({ where: { slug: { startsWith: "loadtest-college-" } } });
  const previous = await prisma.season.findFirst({ orderBy: { createdAt: "desc" } });
  if (previous) await prisma.season.update({ where: { id: previous.id }, data: { isActive: true } });
  console.log(`Dropped the load-test season${previous ? `; ${previous.slug} is active again` : ""}.`);
  await prisma.$disconnect();
  process.exit(0);
}

const users = Number(flag("--users") ?? 20_000);
if (!args.includes("--yes")) {
  console.error(`This makes a "${SLUG}" season with ${users} users the active season. Re-run with --yes.`);
  process.exit(1);
}
if (await prisma.season.findUnique({ where: { slug: SLUG } })) {
  console.error(`A "${SLUG}" season exists already; run with --drop first.`);
  process.exit(1);
}

const now = Date.now();
const DAY = 86_400_000;
// Deterministic pseudo-random numbers, so runs are comparable.
let state = 42;
const random = () => ((state = (state * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648);
const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;

await prisma.season.updateMany({ where: { isActive: true }, data: { isActive: false } });
const season = await prisma.season.create({
  data: {
    slug: SLUG,
    name: "Load test",
    isActive: true,
    codingStartsAt: new Date(now - 30 * DAY),
    codingEndsAt: new Date(now + 30 * DAY),
  },
});

const STATES = ["Tamil Nadu", "Maharashtra", "Karnataka", "Delhi", "West Bengal", "Telangana", "Kerala", "Gujarat", "Uttar Pradesh", "Punjab"];
await prisma.college.createMany({
  data: Array.from({ length: 300 }, (_, i) => ({
    slug: `loadtest-college-${i + 1}`,
    name: `Load Test College ${i + 1}`,
    state: STATES[i % STATES.length]!,
    city: null,
    source: "ADMIN" as const,
  })),
});
const colleges = await prisma.college.findMany({ where: { slug: { startsWith: "loadtest-college-" } }, select: { id: true } });

const ownerId = `lt_owner`;
await prisma.user.create({ data: { id: ownerId, name: "Load Test Owner", email: `owner@${DOMAIN}` } });
const project = await prisma.project.create({
  data: {
    seasonId: season.id,
    ownerId,
    slug: "loadtest-project",
    name: "Load Test Project",
    description: "Synthetic data for the leaderboard load test.",
    techStack: ["TypeScript"],
    difficultyEasy: 50,
    difficultyMedium: 30,
    difficultyHard: 20,
    license: "MIT",
    status: "APPROVED",
    approvedAt: new Date(now - 31 * DAY),
  },
});
const repo = await prisma.projectRepo.create({
  data: { projectId: project.id, githubRepoId: 999_000_001n, owner: "loadtest", name: "repo", approval: "APPROVED", trackingStatus: "ACTIVE" },
});

const LEVELS = ["BEGINNER", "BEGINNER", "BEGINNER", "INTERMEDIATE", "INTERMEDIATE", "ADVANCED"] as const;
const points = DEFAULT_RULES.points.levels;
let number = 0;
const BATCH = 1_000;
for (let start = 0; start < users; start += BATCH) {
  const batch = Array.from({ length: Math.min(BATCH, users - start) }, (_, i) => start + i);
  await prisma.user.createMany({
    data: batch.map((n) => ({
      id: `lt_${String(n).padStart(6, "0")}`,
      name: `Contributor ${n}`,
      email: `user${n}@${DOMAIN}`,
      githubLogin: `lt-user-${n}`,
    })),
  });
  await prisma.profile.createMany({
    data: batch.map((n) => ({
      userId: `lt_${String(n).padStart(6, "0")}`,
      college: "Load Test College",
      collegeId: random() < 0.9 ? pick(colleges).id : null,
      collegeMatch: "USER" as const,
      graduationYear: 2025 + Math.floor(random() * 5),
      codeOfConductAcceptedAt: new Date(),
    })),
  });
  const prs: Prisma.PullRequestCreateManyInput[] = [];
  const events: Prisma.ScoreEventCreateManyInput[] = [];
  for (const n of batch) {
    const userId = `lt_${String(n).padStart(6, "0")}`;
    const count = 1 + Math.floor(random() * 8);
    for (let k = 0; k < count; k++) {
      number++;
      const level = pick(LEVELS);
      // Merges on the hour, so many contributors reach equal totals at the same instant.
      const mergedAt = new Date(Math.floor((now - random() * 29 * DAY) / 3_600_000) * 3_600_000);
      const id = `ltpr_${number}`;
      prs.push({
        id,
        repoId: repo.id,
        seasonId: season.id,
        githubId: BigInt(900_000_000 + number),
        number,
        title: `Synthetic PR ${number}`,
        url: `https://github.com/loadtest/repo/pull/${number}`,
        authorGithubId: BigInt(800_000_000 + n),
        authorLogin: `lt-user-${n}`,
        authorId: userId,
        state: "MERGED",
        baseRef: "main",
        labels: [],
        linkedIssueNumbers: [],
        linkedIssueLabels: [],
        mergedAt,
        githubCreatedAt: mergedAt,
        githubUpdatedAt: mergedAt,
        scoreStatus: "SCORED",
        level,
        points: points[level],
        scoredAt: mergedAt,
      });
      events.push({
        seasonId: season.id,
        userId,
        pullRequestId: id,
        kind: "AWARD",
        ruleKey: "base",
        points: points[level],
        level,
        description: "Synthetic award",
        effectiveAt: mergedAt,
        idempotencyKey: `${id}:base:0`,
      });
    }
  }
  await prisma.pullRequest.createMany({ data: prs });
  await prisma.scoreEvent.createMany({ data: events });
  process.stdout.write(`\r${Math.min(start + BATCH, users)} / ${users} users`);
}
console.log(`\nSeeded ${users} users and ${number} scored PRs in season "${SLUG}" (now active).`);
await prisma.$disconnect();
