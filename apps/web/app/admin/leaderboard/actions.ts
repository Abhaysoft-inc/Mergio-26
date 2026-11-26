"use server";

import { verifyBoard, type Verification } from "@repo/scoring/server";
import { revalidatePath } from "next/cache";
import { addCollege, mapCollegeAlias } from "@/lib/colleges";
import { getSession } from "@/lib/dal";
import { LEADERBOARD_ACTIONS, runLeaderboardAction, type LeaderboardAction } from "@/lib/leaderboard-admin";
import { activeSeason } from "@/lib/projects-server";
import { istWeekKey } from "@repo/scoring";

export type AdminState = { error?: string; done?: string };

export async function leaderboardAction(action: LeaderboardAction): Promise<AdminState> {
  // A bound argument comes from the client like any other, so check it.
  if (!LEADERBOARD_ACTIONS.includes(action)) return { error: "Unknown action." };
  const session = await getSession();
  if (!session) return { error: "Your session expired. Sign in with GitHub again." };
  const result = await runLeaderboardAction(session.user, action);
  if (!result.ok) return { error: result.message };
  revalidatePath("/admin/leaderboard");
  revalidatePath("/leaderboard", "layout");
  revalidatePath("/dashboard");
  return { done: result.message };
}

export type VerifyState = { error?: string; results?: Verification[] };

/** Compares the main live boards in Redis with a fresh SQL computation. */
export async function verifyAction(): Promise<VerifyState> {
  const session = await getSession();
  if (!session?.user.isAdmin) return { error: "Organizers only." };
  const season = await activeSeason();
  if (!season) return { error: "There is no active season." };
  const now = new Date();
  const results = [];
  for (const board of [
    { family: "overall" as const },
    { family: "weekly" as const, week: istWeekKey(now) },
    { family: "colleges" as const },
    { family: "mentors" as const },
  ]) {
    results.push(await verifyBoard(season.id, board, now));
  }
  return { results };
}

export async function mapCollegeAction(label: string, _prev: AdminState, formData: FormData): Promise<AdminState> {
  const session = await getSession();
  if (!session?.user.isAdmin) return { error: "Organizers only." };
  const collegeId = formData.get("collegeId")?.toString() ?? "";
  if (!collegeId) return { error: "Pick a college from the suggestions." };
  const result = await mapCollegeAlias(label, collegeId, session.user.id);
  if (!result.ok) return { error: result.message };
  revalidatePath("/admin/leaderboard");
  return { done: `Mapped ${result.mapped} ${result.mapped === 1 ? "profile" : "profiles"}.` };
}

export async function addCollegeAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const session = await getSession();
  if (!session?.user.isAdmin) return { error: "Organizers only." };
  const text = (name: string) => formData.get(name)?.toString() ?? "";
  const result = await addCollege({ name: text("name"), state: text("state"), city: text("city") });
  if (!result.ok) return { error: result.message };
  revalidatePath("/admin/leaderboard");
  return { done: `Added ${result.college.name}.` };
}
