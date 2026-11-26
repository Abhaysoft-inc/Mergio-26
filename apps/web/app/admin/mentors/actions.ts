"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/dal";
import { reviewParticipant } from "@/lib/mentor-service";

export async function reviewMentorAction(registrationId: string, decision: "APPROVED" | "REJECTED") {
  const session = await getSession();
  if (!session) return { error: "Your session expired. Sign in with GitHub again." };
  const result = await reviewParticipant(session.user, registrationId, decision);
  if (!result.ok) return { error: result.message };
  revalidatePath("/admin/mentors");
  return { done: decision === "APPROVED" ? "Approved." : "Rejected." };
}
