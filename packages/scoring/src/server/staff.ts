import { prisma, type Prisma } from "@repo/db";

// Who counts as a project's staff: its project admin (owner) and its active mentors. Staff can't
// score as contributors on the project (AUTHOR_IS_MENTOR) and are the ones who earn mentor points.

/** A mentor attachment that is in effect: linked to a user whose mentor role is approved. */
export const activeMentor = {
  userId: { not: null },
  user: { registrations: { some: { role: "MENTOR", status: "APPROVED" } } },
} satisfies Prisma.ProjectMentorWhereInput;

/** User ids of the project's staff. */
export async function projectStaffIds(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      ownerId: true,
      mentors: { where: activeMentor, select: { userId: true } },
    },
  });
  if (!project) return new Set<string>();
  return new Set([
    project.ownerId,
    ...project.mentors.flatMap((mentor) => (mentor.userId ? [mentor.userId] : [])),
  ]);
}

/** Projects of a season where the user is staff, with their role on each. */
export async function staffProjectsOf(userId: string, seasonId: string) {
  const projects = await prisma.project.findMany({
    where: {
      seasonId,
      OR: [{ ownerId: userId }, { mentors: { some: { AND: [{ userId }, activeMentor] } } }],
    },
    select: { id: true, slug: true, name: true, status: true, ownerId: true },
    orderBy: { name: "asc" },
  });
  return projects.map((project) => ({
    ...project,
    role: project.ownerId === userId ? ("ADMIN" as const) : ("MENTOR" as const),
  }));
}
