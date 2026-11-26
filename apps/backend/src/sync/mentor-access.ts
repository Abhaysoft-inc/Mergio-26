import { prisma } from "@repo/db";
import { installationToken, restGet } from "../github/client";

// Mentors apply labels on GitHub, which needs at least triage permission on the repo (F-05).
// Records each mentor's role per repo so the project admin sees who is missing it.

type Permission = { permission: string; role_name?: string };

export async function checkMentorAccess(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      repos: { where: { approval: "APPROVED", removedAt: null, installationId: { not: null } } },
      mentors: { include: { user: { select: { githubLogin: true } } } },
    },
  });
  if (!project || project.repos.length === 0 || project.mentors.length === 0) return;

  const tokens = new Map<string, string>();
  const tokenFor = async (installationId: bigint) => {
    const key = installationId.toString();
    if (!tokens.has(key)) tokens.set(key, await installationToken(installationId));
    return tokens.get(key)!;
  };

  for (const mentor of project.mentors) {
    // The login they have now (renames are picked up at sign-in), else the one invited.
    const login = mentor.user?.githubLogin ?? mentor.githubLogin;
    const access: Record<string, string> = {};
    for (const repo of project.repos) {
      const token = await tokenFor(repo.installationId!);
      const result = await restGet<Permission>(
        `/repos/${repo.owner}/${repo.name}/collaborators/${encodeURIComponent(login)}/permission`,
        token,
      );
      // 404: not a collaborator (or no such user), so no permission beyond public read.
      access[`${repo.owner}/${repo.name}`] = result?.role_name ?? result?.permission ?? "none";
    }
    await prisma.projectMentor.update({
      where: { id: mentor.id },
      data: { repoAccess: access, accessCheckedAt: new Date() },
    });
  }
}
