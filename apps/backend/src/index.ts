import { prisma } from "@repo/db";
import { app } from "./app";
import { env } from "./env";
import { startWorker } from "./worker";

const server = app.listen(env.port, () => {
  console.log(`Backend running on http://localhost:${env.port}`);
});

const stopWorker = env.runWorker ? startWorker() : null;

async function shutdown() {
  server.close();
  await stopWorker?.();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
