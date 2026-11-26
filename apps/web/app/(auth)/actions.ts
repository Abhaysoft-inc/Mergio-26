"use server";

import { prisma } from "@repo/db";
import { enqueueJobs } from "@repo/scoring/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { refreshLeaderboardUsers, resolveCollege } from "@/lib/colleges";
import { getSession } from "@/lib/dal";
import { linkMentorInvites } from "@/lib/mentor-service";
import { githubSignInUrl } from "@/lib/sign-in";
import {
  parseRole,
  registrationSchema,
  type RegistrationState,
} from "@/lib/registration";

export async function signInWithGitHub(formData: FormData) {
  // Only ever return to our own registration page. The role is validated, never echoed raw.
  const role = parseRole(formData.get("role")?.toString());
  // "signin" lets the register page send people who are already registered on to their dashboard.
  const next = role ? `/register?signin=1&role=${role.toLowerCase()}` : "/register?signin=1";
  redirect(await githubSignInUrl(next));
}

/** Sign-in from /login. `next` is checked by githubSignInUrl, so it can only be a local path. */
export async function logInWithGitHub(formData: FormData) {
  redirect(await githubSignInUrl(formData.get("next")?.toString()));
}

export async function signOutAction() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/");
}

export async function registerAction(
  _prev: RegistrationState,
  formData: FormData,
): Promise<RegistrationState> {
  const text = (name: string) => formData.get(name)?.toString() ?? "";
  const fields = {
    roles: formData.getAll("role").map(String),
    college: text("college"),
    graduationYear: text("graduationYear"),
    phone: text("phone"),
    discord: text("discord"),
    repoUrl: text("repoUrl"),
    updatesOptIn: formData.get("updatesOptIn") === "on",
  };

  const session = await getSession();
  if (!session) {
    return { errors: { form: "Your session expired. Sign in with GitHub again." } };
  }

  const parsed = registrationSchema.safeParse({
    ...fields,
    codeOfConduct: formData.get("codeOfConduct"),
  });
  if (!parsed.success) {
    const errors: NonNullable<RegistrationState["errors"]> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form") as keyof typeof errors;
      errors[key] ??= issue.message;
    }
    return { errors };
  }

  const data = parsed.data;
  const userId = session.user.id;
  // Picked from the curated list, or matched through an organizer's alias, or neither yet.
  const college = await resolveCollege(formData.get("collegeId")?.toString() || null, data.college);

  // Roles the person already holds keep their status; submitting again never resets a review.
  const existing = await prisma.registration.findMany({
    where: { userId },
    select: { role: true },
  });
  const held = new Set(existing.map((registration) => registration.role));
  const before = await prisma.profile.findUnique({ where: { userId }, select: { collegeId: true } });
  const newRoles = data.roles.filter((role) => !held.has(role));

  await prisma.$transaction([
    prisma.profile.upsert({
      where: { userId },
      create: {
        userId,
        ...college,
        graduationYear: data.graduationYear,
        phone: data.phone,
        discord: data.discord,
        updatesOptIn: data.updatesOptIn,
        codeOfConductAcceptedAt: new Date(),
      },
      // The original code-of-conduct acceptance time is kept.
      update: {
        ...college,
        graduationYear: data.graduationYear,
        phone: data.phone ?? null,
        discord: data.discord ?? null,
        updatesOptIn: data.updatesOptIn,
      },
    }),
    prisma.registration.createMany({
      data: newRoles.map((role) => ({
        userId,
        role,
        // Contributors are open to everyone; leads for the other roles are reviewed by the team.
        status: role === "CONTRIBUTOR" ? "APPROVED" : "PENDING",
        repoUrl: role === "MAINTAINER" ? data.repoUrl : undefined,
      })),
      skipDuplicates: true,
    }),
  ]);

  // PRs merged before the contributor registered were NOT_REGISTERED; score them now (F-06 edge case).
  if (newRoles.includes("CONTRIBUTOR")) {
    await enqueueJobs([{ kind: "USER_RESCORE", payload: { userId } }]);
  }
  // College and graduation year show on the leaderboards.
  const left = before?.collegeId && before.collegeId !== college.collegeId ? [before.collegeId] : [];
  await refreshLeaderboardUsers([userId], left);
  // Project admins may have invited this GitHub login as a mentor before they signed up.
  await linkMentorInvites(session.user);

  redirect("/dashboard");
}
