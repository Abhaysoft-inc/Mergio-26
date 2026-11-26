// Queues a reconciliation of one tracked repo, or all of them (the same as the nightly run):
//   pnpm --filter backend resync            every tracked repo of the active season
//   pnpm --filter backend resync owner/name one repo
// The worker does the work, so it must be running.
import { prisma } from "@repo/db";
import { enqueueJobs } from "@repo/scoring/server";

const target = process.argv[2];
const [owner, name] = target?.split("/") ?? [];

const repos = await prisma.projectRepo.findMany({
  where: {
    project: { season: { isActive: true } },
    removedAt: null,
    ...(owner && name
      ? { owner: { equals: owner, mode: "insensitive" }, name: { equals: name, mode: "insensitive" } }
      : {}),
  },
  select: { githubRepoId: true, owner: true, name: true },
  distinct: ["githubRepoId"],
});
if (repos.length === 0) {
  console.error(target ? `${target} isn't a repo of the active season.` : "No repos to sync.");
  process.exit(1);
}
await enqueueJobs(
  repos.map((repo) => ({
    kind: "REPO_RESYNC" as const,
    payload: { githubRepoId: repo.githubRepoId.toString() },
  })),
);
console.log(`Queued ${repos.map((repo) => `${repo.owner}/${repo.name}`).join(", ")}`);
await prisma.$disconnect();
