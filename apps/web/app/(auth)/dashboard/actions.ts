"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/dal";
import { openDispute } from "@/lib/dispute-service";
import { splitLinks, type DisputeFormState } from "@/lib/disputes";
import { addMentor, createFlag, removeMentor } from "@/lib/mentor-service";
import type { FlagFormState, MentorFormState } from "@/lib/mentoring";

const EXPIRED = "Your session expired. Sign in with GitHub again.";

export async function disputeAction(
  pullRequestId: string,
  _prev: DisputeFormState,
  formData: FormData,
): Promise<DisputeFormState> {
  const session = await getSession();
  if (!session) return { errors: { form: EXPIRED } };
  const result = await openDispute(session.user.id, {
    pullRequestId,
    category: formData.get("category")?.toString() ?? "",
    text: formData.get("text")?.toString() ?? "",
    evidenceUrls: splitLinks(formData.get("evidenceUrls")?.toString() ?? ""),
  });
  if (!result.ok) return { errors: result.errors };
  redirect("/dashboard/prs?disputed=1");
}

export async function addMentorAction(
  projectId: string,
  slug: string,
  _prev: MentorFormState,
  formData: FormData,
): Promise<MentorFormState> {
  const session = await getSession();
  if (!session) return { error: EXPIRED };
  const result = await addMentor(session.user, projectId, formData.get("githubLogin")?.toString());
  if (!result.ok) return { error: result.message };
  revalidatePath(`/dashboard/projects/${slug}`);
  revalidatePath(`/projects/${slug}`);
  const { githubLogin, state } = result.mentor;
  return {
    done:
      state === "ACTIVE"
        ? `@${githubLogin} is now a mentor on this project.`
        : state === "AWAITING_APPROVAL"
          ? `@${githubLogin} was added. They become active once an organizer approves their mentor registration.`
          : `@${githubLogin} was invited. Send them the link below so they can register as a mentor.`,
    inviteUrl: result.inviteUrl ?? undefined,
  };
}

export async function removeMentorAction(projectId: string, slug: string, mentorId: string) {
  const session = await getSession();
  if (!session) return { error: EXPIRED };
  const result = await removeMentor(session.user, projectId, mentorId);
  if (!result.ok) return { error: result.message };
  revalidatePath(`/dashboard/projects/${slug}`);
  revalidatePath(`/projects/${slug}`);
  return { done: "Mentor removed." };
}

export async function flagAction(
  pullRequestId: string,
  _prev: FlagFormState,
  formData: FormData,
): Promise<FlagFormState> {
  const session = await getSession();
  if (!session) return { errors: { form: EXPIRED } };
  const result = await createFlag(session.user, {
    pullRequestId,
    category: formData.get("category")?.toString() ?? "",
    note: formData.get("note")?.toString() ?? "",
  });
  if (!result.ok) return { errors: result.errors };
  redirect("/dashboard/mentor?flagged=1");
}
