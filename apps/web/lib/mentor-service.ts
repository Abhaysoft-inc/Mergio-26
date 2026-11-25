import "server-only";
import { prisma, Prisma, type RegistrationStatus } from "@repo/db";
import { enqueueJobs, projectStaffIds } from "@repo/scoring/server";
import { deliverAfterResponse, escapeHtml, queueEmail } from "./email";
import { flagSchema, mentorLoginSchema, type FlagFormState, type MentorState } from "./mentoring";
import type { Actor, Failure, Result } from "./project-service";

// Mentor management (F-05) and flags (F-12). Like project-service.ts, every function checks who
// is acting and returns a result with an HTTP status the API passes through.

const fail = (status: Failure["status"], message: string): Failure => ({ ok: false, status, message });

const siteUrl = () => process.env.BETTER_AUTH_URL ?? "https://mergio.in";
/** Where to send someone invited as a mentor: sign-up with the mentor role picked. */
export const mentorInviteUrl = () => `${siteUrl()}/register?role=mentor`;

/** Links invites sent to this person's GitHub login before they had an account. */
export async function linkMentorInvites(user: { id: string; githubLogin?: string | null }) {
  if (!user.githubLogin) return;
  const linked = await prisma.projectMentor.updateManyAndReturn({
    where: { userId: null, githubLogin: user.githubLogin.toLowerCase() },
    data: { userId: user.id },
    select: { projectId: true },
  });
  if (linked.length === 0) return;
  await enqueueJobs([
    { kind: "USER_RESCORE", payload: { userId: user.id } },
    ...linked.map((row) => ({ kind: "MENTOR_ACCESS" as const, payload: { projectId: row.projectId } })),
  ]);
}

/** Where an attachment stands, from the user's mentor registration. */
export function mentorState(
  userId: string | null,
  mentorRegistration: { status: RegistrationStatus } | null | undefined,
): MentorState {
  if (!userId) return "INVITED";
  switch (mentorRegistration?.status) {
    case "APPROVED":
      return "ACTIVE";
    case "PENDING":
      return "AWAITING_APPROVAL";
    case "REJECTED":
      return "REJECTED";
    default:
      return "NOT_REGISTERED";
  }
}

async function managedProject(actor: Actor, projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, ownerId: true, status: true, name: true },
  });
  // Anyone but the project admin and organizers gets the same 404 as a missing project.
  if (!project || (project.ownerId !== actor.id && actor.isAdmin !== true)) return null;
  return project;
}

/** Attaches a mentor by GitHub login. Unknown logins become an invite that links on sign-in. */
export async function addMentor(
  actor: Actor,
  projectId: string,
  rawLogin: unknown,
): Promise<Result<{ mentor: { id: string; githubLogin: string; state: MentorState }; inviteUrl: string | null }>> {
  const project = await managedProject(actor, projectId);
  if (!project) return fail(404, "Project not found.");
  if (project.status === "REJECTED") return fail(409, "This project wasn't approved, so it can't have mentors.");

  const parsed = mentorLoginSchema.safeParse(rawLogin ?? "");
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Enter a GitHub username.");
  const login = parsed.data;

  const user = await prisma.user.findFirst({
    where: { githubLogin: { equals: login, mode: "insensitive" } },
    select: {
      id: true,
      registrations: { where: { role: "MENTOR" }, select: { status: true } },
    },
  });
  if (user?.id === project.ownerId) {
    return fail(409, "You're the project admin already, so you don't need to be a mentor too.");
  }

  try {
    const mentor = await prisma.projectMentor.create({
      data: {
        projectId,
        githubLogin: login.toLowerCase(),
        userId: user?.id ?? null,
        invitedById: actor.id,
      },
      select: { id: true, githubLogin: true },
    });
    await enqueueJobs([
      { kind: "MENTOR_ACCESS", payload: { projectId } },
      // Their own PRs on this project stop counting, and earlier reviews may earn mentor points.
      ...(user ? [{ kind: "USER_RESCORE" as const, payload: { userId: user.id } }] : []),
    ]);
    const state = mentorState(user?.id ?? null, user?.registrations[0]);
    return {
      ok: true,
      mentor: { ...mentor, state },
      inviteUrl: state === "ACTIVE" || state === "AWAITING_APPROVAL" ? null : mentorInviteUrl(),
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return fail(409, `@${login} is already a mentor on this project.`);
    }
    throw error;
  }
}

/** Removes a mentor. They lose access to the project's mentor view at once. */
export async function removeMentor(actor: Actor, projectId: string, mentorId: string): Promise<Result> {
  const project = await managedProject(actor, projectId);
  if (!project) return fail(404, "Project not found.");
  const mentor = await prisma.projectMentor.findFirst({
    where: { id: mentorId, projectId },
    select: { id: true, userId: true },
  });
  if (!mentor) return fail(404, "That mentor isn't on this project.");
  await prisma.projectMentor.delete({ where: { id: mentor.id } });
  // Mentor points they earned stay; their own PRs on the project can count again.
  if (mentor.userId) await enqueueJobs([{ kind: "USER_RESCORE", payload: { userId: mentor.userId } }]);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Organizer review of mentor and maintainer registrations (/admin/mentors)
// ---------------------------------------------------------------------------

export async function reviewParticipant(
  admin: Actor,
  registrationId: string,
  decision: unknown,
): Promise<Result<{ status: RegistrationStatus }>> {
  if (admin.isAdmin !== true) return fail(404, "Not found.");
  if (decision !== "APPROVED" && decision !== "REJECTED") {
    return fail(400, 'decision must be "APPROVED" or "REJECTED".');
  }
  const registration = await prisma.registration.findUnique({
    where: { id: registrationId },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  if (!registration || registration.role === "CONTRIBUTOR") return fail(404, "Registration not found.");
  if (registration.status === decision) return { ok: true, status: decision };

  const roleName = registration.role === "MENTOR" ? "mentor" : "maintainer";
  const emailId = await prisma.$transaction(async (tx) => {
    await tx.registration.update({
      where: { id: registration.id },
      data: { status: decision, reviewedAt: new Date(), reviewedById: admin.id },
    });
    const approved = decision === "APPROVED";
    const subject = approved
      ? `You're approved as a Mergio ${roleName}`
      : `Your Mergio ${roleName} registration`;
    const body = approved
      ? `You're approved as a ${roleName} for Mergio. ${
          registration.role === "MENTOR"
            ? "Once a project admin adds you to their project, its review queue appears on your dashboard."
            : "You can submit your project from your dashboard."
        }`
      : `Thanks for registering as a ${roleName} for Mergio. The team couldn't approve it this time. You can still take part as a contributor.`;
    const url = `${siteUrl()}/dashboard`;
    return queueEmail(tx, {
      toEmail: registration.user.email,
      toUserId: registration.user.id,
      category: "registration-status",
      subject,
      text: `Hi ${registration.user.name},\n\n${body}\n\n${url}\n`,
      html: `<p>Hi ${escapeHtml(registration.user.name)},</p><p>${escapeHtml(body)}</p><p><a href="${url}">Open your dashboard</a></p>`,
    });
  });
  deliverAfterResponse([emailId]);

  if (registration.role === "MENTOR") {
    const projects = await prisma.projectMentor.findMany({
      where: { userId: registration.userId },
      select: { projectId: true },
    });
    await enqueueJobs([
      { kind: "USER_RESCORE", payload: { userId: registration.userId } },
      ...projects.map((row) => ({ kind: "MENTOR_ACCESS" as const, payload: { projectId: row.projectId } })),
    ]);
  }
  return { ok: true, status: decision };
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

type FlagResult =
  | { ok: true; flag: { id: string; status: string; createdAt: Date } }
  | { ok: false; status: Failure["status"]; errors: NonNullable<FlagFormState["errors"]> };

/** A mentor, project admin or organizer flags the author of a PR on one of their projects. */
export async function createFlag(actor: Actor, input: unknown): Promise<FlagResult> {
  const parsed = flagSchema.safeParse(input);
  if (!parsed.success) {
    const errors: NonNullable<FlagFormState["errors"]> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]);
      const field = (key === "category" || key === "note" ? key : "form") as keyof typeof errors;
      errors[field] ??= issue.message;
    }
    return { ok: false, status: 400, errors };
  }
  const { pullRequestId, category, note } = parsed.data;

  const pr = await prisma.pullRequest.findUnique({
    where: { id: pullRequestId },
    select: {
      id: true,
      seasonId: true,
      authorId: true,
      authorLogin: true,
      repo: { select: { projectId: true } },
    },
  });
  const staff = pr ? await projectStaffIds(pr.repo.projectId) : new Set<string>();
  if (!pr || (!staff.has(actor.id) && actor.isAdmin !== true)) {
    return { ok: false, status: 404, errors: { form: "That pull request isn't on one of your projects." } };
  }
  if (pr.authorId === actor.id) {
    return { ok: false, status: 409, errors: { form: "You can't flag yourself." } };
  }
  const open = await prisma.flag.findFirst({
    where: { reporterId: actor.id, pullRequestId, status: "OPEN" },
    select: { id: true },
  });
  if (open) {
    return { ok: false, status: 409, errors: { form: "You've already flagged this pull request. The organizers have it." } };
  }
  const flag = await prisma.flag.create({
    data: {
      seasonId: pr.seasonId,
      reporterId: actor.id,
      targetUserId: pr.authorId,
      targetGithubLogin: pr.authorLogin,
      pullRequestId,
      category,
      note,
    },
    select: { id: true, status: true, createdAt: true },
  });
  return { ok: true, flag };
}
