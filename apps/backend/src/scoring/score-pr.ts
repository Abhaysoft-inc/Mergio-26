import { prisma, type ScoreReason } from "@repo/db";
import {
  evaluatePullRequest,
  istDay,
  istWeekStart,
  planLedger,
  reasonTitle,
  resolveRules,
  type Evaluation,
} from "@repo/scoring";
import { enqueueJobs, projectStaffIds } from "@repo/scoring/server";
import { awardBadges } from "./badges";
import { scoreMentorPoints } from "./mentor-points";

// Applies the scoring engine to one stored PR: gathers the facts, evaluates, and writes the
// difference to the ledger. Safe to call any number of times; unchanged facts write nothing.

const DAY_MS = 86_400_000;

/** The Mergio user behind a GitHub account id, if they have signed in. */
async function userForGithubId(githubId: bigint) {
  const account = await prisma.account.findUnique({
    where: { providerId_accountId: { providerId: "github", accountId: githubId.toString() } },
    select: { userId: true },
  });
  return account?.userId ?? null;
}

function statusFields(evaluation: Evaluation) {
  switch (evaluation.status) {
    case "OPEN":
    case "CLOSED":
      return { scoreReason: null, level: null, labelDeadline: null, scoreNotes: [] };
    case "AWAITING_LABEL":
      return {
        scoreReason: null,
        level: evaluation.level,
        labelDeadline: evaluation.labelDeadline,
        scoreNotes: [],
      };
    case "NOT_ELIGIBLE":
    case "INVALIDATED":
      return {
        scoreReason: evaluation.reason as ScoreReason,
        level: evaluation.level,
        labelDeadline: null,
        scoreNotes: [],
      };
    case "SCORED":
      return {
        scoreReason: null,
        level: evaluation.level,
        labelDeadline: null,
        scoreNotes: evaluation.notes,
      };
  }
}

export async function scorePullRequest(pullRequestId: string, now = new Date()) {
  const pr = await prisma.pullRequest.findUnique({
    where: { id: pullRequestId },
    include: { repo: { include: { project: { include: { season: true } } } } },
  });
  if (!pr) return;
  const { repo } = pr;
  const { project } = repo;
  const { season } = project;
  // A finalized season's ledger is locked (PRD §4.8): nothing is rescored until a Super Admin
  // unfinalizes it.
  if (season.finalizedAt) return;
  const rules = resolveRules(season.scoringRules);

  const authorId = pr.authorId ?? (await userForGithubId(pr.authorGithubId));
  const mergedAt = pr.mergedAt;

  const [staff, registration, author, revert, beginnerCount, qualityThisWeek] = await Promise.all([
    projectStaffIds(project.id),
    authorId
      ? prisma.registration.findFirst({
          where: { userId: authorId, role: "CONTRIBUTOR", status: "APPROVED" },
          select: { id: true },
        })
      : null,
    authorId
      ? prisma.user.findUnique({ where: { id: authorId }, select: { scoringSuspendedAt: true } })
      : null,
    prisma.pullRequest.findFirst({
      where: { repoId: repo.id, revertsNumber: pr.number, state: "MERGED" },
      orderBy: { mergedAt: "asc" },
      select: { mergedAt: true },
    }),
    authorId && mergedAt
      ? prisma.pullRequest.count({
          where: {
            id: { not: pr.id },
            authorId,
            seasonId: season.id,
            repo: { projectId: project.id },
            scoreStatus: "SCORED",
            level: "BEGINNER",
            mergedAt: { lt: mergedAt },
          },
        })
      : 0,
    authorId && mergedAt
      ? prisma.scoreEvent
          .groupBy({
            by: ["pullRequestId"],
            where: {
              userId: authorId,
              seasonId: season.id,
              ruleKey: "bonus:quality",
              pullRequestId: { not: pr.id },
              pullRequest: {
                repo: { projectId: project.id },
                mergedAt: {
                  gte: istWeekStart(mergedAt),
                  lt: new Date(istWeekStart(mergedAt).getTime() + 7 * DAY_MS),
                },
              },
            },
            _sum: { points: true },
          })
          .then((groups) => groups.filter((group) => (group._sum.points ?? 0) > 0).length)
      : 0,
  ]);

  const evaluation = evaluatePullRequest(
    {
      state: pr.state,
      mergedAt,
      labels: pr.labels,
      linkedIssueLabels: pr.linkedIssueLabels,
      baseRef: pr.baseRef,
      defaultBranch: repo.defaultBranch,
      changedLines: pr.changedLines,
      selfMerged: pr.mergedByGithubId !== null && pr.mergedByGithubId === pr.authorGithubId,
      revertedAt: revert?.mergedAt ?? null,
    },
    {
      registered: Boolean(registration),
      // The project admin and the project's active mentors can't score on it.
      projectStaff: authorId !== null && staff.has(authorId),
      scoringSuspendedAt: author?.scoringSuspendedAt ?? null,
    },
    {
      repoTracked:
        repo.approval === "APPROVED" &&
        project.status === "APPROVED" &&
        (!repo.removedAt || (mergedAt !== null && repo.removedAt > mergedAt)),
      codingStartsAt: season.codingStartsAt,
      codingEndsAt: season.codingEndsAt,
      beginnerPrsScoredInProject: beginnerCount,
      qualityBonusesInProjectThisWeek: qualityThisWeek,
      now,
    },
    rules,
  );

  const fields = statusFields(evaluation);
  const desired = evaluation.status === "SCORED" ? evaluation.awards : [];
  const reason =
    evaluation.status === "NOT_ELIGIBLE" || evaluation.status === "INVALIDATED"
      ? evaluation.reason
      : null;

  if (!authorId) {
    // No account, so nothing can be on the ledger; just record the outcome.
    await prisma.pullRequest.update({
      where: { id: pr.id },
      data: { scoreStatus: evaluation.status, ...fields, points: 0, scoredAt: now },
    });
    await scoreMentorPoints(pr.id);
    return;
  }

  await prisma.$transaction(async (tx) => {
    // One contributor's PRs are scored one at a time, so the daily cap can't be overrun.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`score:${authorId}`}))`;

    const [existing, awards] = await Promise.all([
      tx.scoreEvent.findMany({
        where: { pullRequestId: pr.id },
        select: { ruleKey: true, points: true },
      }),
      tx.scoreEvent.findMany({
        where: { userId: authorId, seasonId: season.id, kind: "AWARD" },
        select: { points: true, effectiveAt: true },
      }),
    ]);
    const dailyUsed = new Map<string, number>();
    for (const award of awards) {
      const day = istDay(award.effectiveAt);
      dailyUsed.set(day, (dailyUsed.get(day) ?? 0) + award.points);
    }

    const plan = planLedger({
      desired,
      existing,
      mergedAt: mergedAt ?? now,
      now,
      dailyUsed,
      dailyCap: rules.caps.dailyPoints,
      reversalDescription: reason
        ? `Taken back: ${reasonTitle(reason)}`
        : "Taken back: the PR's level or bonus labels changed",
    });

    if (plan.length > 0) {
      await tx.scoreEvent.createMany({
        data: plan.map((entry, index) => ({
          seasonId: season.id,
          userId: authorId,
          pullRequestId: pr.id,
          kind: entry.kind,
          ruleKey: entry.ruleKey,
          points: entry.points,
          level: entry.level ?? null,
          description: entry.description,
          reason: entry.kind === "REVERSAL" ? (reason as ScoreReason | null) : null,
          effectiveAt: entry.effectiveAt,
          // The sequence makes a concurrent duplicate write fail rather than double count.
          idempotencyKey: `${pr.id}:${entry.ruleKey}:${existing.length + index}`,
        })),
      });
      // In the same transaction, so a ledger change can't miss its leaderboard update.
      await enqueueJobs(
        [{ kind: "LEADERBOARD_REFRESH", payload: { seasonId: season.id, kind: "user", id: authorId } }],
        { client: tx },
      );
    }

    const net =
      existing.reduce((sum, entry) => sum + entry.points, 0) +
      plan.reduce((sum, entry) => sum + entry.points, 0);

    await tx.pullRequest.update({
      where: { id: pr.id },
      data: { authorId, scoreStatus: evaluation.status, ...fields, points: net, scoredAt: now },
    });

    // Spam strikes (PRD §10): enough of them suspend scoring until an organizer reviews it.
    if (reason === "SPAM_LABEL") {
      const strikes = await tx.pullRequest.count({
        where: { authorId, seasonId: season.id, scoreReason: "SPAM_LABEL" },
      });
      if (strikes >= rules.spamStrikesToSuspend) {
        await tx.user.updateMany({
          where: { id: authorId, scoringSuspendedAt: null },
          data: { scoringSuspendedAt: now },
        });
      }
    }
  });

  await scoreMentorPoints(pr.id);
  if (evaluation.status === "SCORED") await awardBadges(season.id, authorId, now);
}
