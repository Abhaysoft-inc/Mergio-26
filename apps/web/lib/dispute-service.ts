import "server-only";
import { prisma, Prisma } from "@repo/db";
import { contributorPullRequest } from "./contributor";
import { disputeSchema, type DisputeFormState } from "./disputes";

// Opening a dispute (F-12). Resolving them is the admin console's job.

const DAY_MS = 86_400_000;
/** After this many rejected disputes, a contributor can open at most one a day. */
const REJECTED_BEFORE_LIMIT = 5;

type Result =
  | { ok: true; dispute: { id: string; status: string; createdAt: Date } }
  | { ok: false; status: number; errors: NonNullable<DisputeFormState["errors"]> };

const fail = (status: number, form: string): Result => ({ ok: false, status, errors: { form } });

export async function openDispute(userId: string, input: unknown): Promise<Result> {
  const parsed = disputeSchema.safeParse(input);
  if (!parsed.success) {
    const errors: NonNullable<DisputeFormState["errors"]> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      const field = (["category", "text", "evidenceUrls"].includes(key) ? key : "form") as keyof typeof errors;
      errors[field] ??= issue.message;
    }
    return { ok: false, status: 400, errors };
  }
  const data = parsed.data;

  const found = await contributorPullRequest(userId, data.pullRequestId);
  if (!found) return fail(404, "That pull request isn't one of yours.");
  if (!found.pr.canDispute) {
    return fail(
      409,
      found.pr.dispute && ["OPEN", "IN_REVIEW"].includes(found.pr.dispute.status)
        ? "This pull request already has a dispute under review."
        : "This pull request can't be disputed: it isn't merged, is still waiting for labels, or the dispute window has closed.",
    );
  }

  const rejected = await prisma.dispute.count({ where: { userId, status: "REJECTED" } });
  if (rejected >= REJECTED_BEFORE_LIMIT) {
    const recent = await prisma.dispute.count({
      where: { userId, createdAt: { gt: new Date(Date.now() - DAY_MS) } },
    });
    if (recent > 0) {
      return fail(429, "You can open one dispute a day. Try again tomorrow.");
    }
  }

  try {
    const dispute = await prisma.dispute.create({
      data: {
        userId,
        seasonId: found.seasonId,
        pullRequestId: data.pullRequestId,
        category: data.category,
        text: data.text,
        evidenceUrls: data.evidenceUrls,
      },
      select: { id: true, status: true, createdAt: true },
    });
    return { ok: true, dispute };
  } catch (error) {
    // The partial unique index: someone (another tab) opened one a moment ago.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return fail(409, "This pull request already has a dispute under review.");
    }
    throw error;
  }
}
