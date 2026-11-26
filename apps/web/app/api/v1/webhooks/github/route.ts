import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@repo/db";
import { enqueueJobs, type Job } from "@repo/scoring/server";

// POST /api/v1/webhooks/github — the Mergio GitHub App's webhook (F-06).
// Verifies the signature, records the delivery (its id is the key, so redeliveries are no-ops),
// queues a job and answers 202. Nothing is processed here: the worker in apps/backend refetches
// the current state from GitHub, so out-of-order or missed deliveries can't corrupt scores.

type Payload = {
  action?: string;
  repository?: { id: number };
  installation?: { id: number };
  pull_request?: { number: number };
  issue?: { number: number; pull_request?: unknown };
  repositories?: { id: number }[];
  repositories_added?: { id: number }[];
  repositories_removed?: { id: number }[];
};

function validSignature(body: string, header: string | null, secret: string) {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`);
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

const ids = (list?: { id: number }[]) => (list ?? []).map((repo) => String(repo.id));

/** The jobs a delivery calls for. Events we don't use queue nothing. */
function jobsFor(event: string, payload: Payload): Job[] {
  const repoId = payload.repository ? String(payload.repository.id) : null;
  switch (event) {
    case "pull_request":
    case "pull_request_review":
      return repoId && payload.pull_request
        ? [{ kind: "PULL_REQUEST", payload: { githubRepoId: repoId, number: payload.pull_request.number } }]
        : [];
    case "issues":
      return repoId && payload.issue && !payload.issue.pull_request
        ? [{ kind: "ISSUE", payload: { githubRepoId: repoId, number: payload.issue.number } }]
        : [];
    case "label":
      // A renamed or deleted label changes every PR and issue that had it.
      return repoId && payload.action !== "created"
        ? [{ kind: "REPO_RESYNC", payload: { githubRepoId: repoId } }]
        : [];
    case "installation":
    case "installation_repositories":
      return payload.installation && payload.action
        ? [
            {
              kind: "INSTALLATION",
              payload: {
                installationId: String(payload.installation.id),
                action: payload.action,
                githubRepoIds: [
                  ...ids(payload.repositories),
                  ...ids(payload.repositories_added),
                  ...ids(payload.repositories_removed),
                ].sort(),
              },
            },
          ]
        : [];
    case "repository":
      return repoId && payload.action
        ? [{ kind: "REPOSITORY", payload: { githubRepoId: repoId, action: payload.action } }]
        : [];
    default:
      return [];
  }
}

export async function POST(request: Request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    console.error("GITHUB_WEBHOOK_SECRET is not set; rejecting GitHub webhooks.");
    return new Response("Webhook secret not configured", { status: 503 });
  }

  const body = await request.text();
  if (!validSignature(body, request.headers.get("x-hub-signature-256"), secret)) {
    return new Response("Invalid signature", { status: 401 });
  }

  const event = request.headers.get("x-github-event") ?? "";
  const deliveryId = request.headers.get("x-github-delivery") ?? "";
  if (!event || !deliveryId) return new Response("Missing GitHub headers", { status: 400 });
  if (event === "ping") return new Response(null, { status: 204 });

  let payload: Payload;
  try {
    payload = JSON.parse(body) as Payload;
  } catch {
    return new Response("Body is not JSON", { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    const inserted = await tx.webhookDelivery.createMany({
      data: {
        id: deliveryId,
        event,
        action: payload.action ?? null,
        githubRepoId: payload.repository ? BigInt(payload.repository.id) : null,
        installationId: payload.installation ? BigInt(payload.installation.id) : null,
        payload: JSON.parse(body),
      },
      skipDuplicates: true,
    });
    // A redelivery of something already recorded queues nothing new.
    if (inserted.count === 0) return;
    await enqueueJobs(jobsFor(event, payload), { client: tx });
  });

  return new Response(null, { status: 202 });
}
