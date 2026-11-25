// Runs only the sync worker, for deployments that keep it out of the API process
// (then set RUN_WORKER=false on the API).
import { prisma } from "@repo/db";
import { startWorker } from "./worker";

const stop = startWorker();

async function shutdown() {
  await stop();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
