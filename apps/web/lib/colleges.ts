import "server-only";
import { prisma, Prisma } from "@repo/db";
import { collegeSlug, normaliseCollegeName } from "@repo/scoring";
import { enqueueJobs } from "@repo/scoring/server";
import { activeSeason } from "./projects-server";

// The curated college list (F-08): AICTE and UGC institutions plus ones organizers add. A profile
// keeps what the person typed; it points at a College when they picked one from the list, or when
// an organizer mapped that spelling to a college (a CollegeAlias, a separate relationship that
// then applies to everyone who typed the same thing).

export type CollegeOption = { id: string; slug: string; name: string; state: string; city: string | null };

const optionSelect = { id: true, slug: true, name: true, state: true, city: true } as const;

/** Colleges matching a search, by name, alias or state. */
export async function searchColleges(query: string, limit = 10): Promise<CollegeOption[]> {
  const text = query.trim();
  if (text.length < 2) return [];
  const normalized = normaliseCollegeName(text);
  return prisma.college.findMany({
    where: {
      OR: [
        { name: { contains: text, mode: "insensitive" } },
        ...(normalized ? [{ aliases: { some: { normalized: { contains: normalized } } } }] : []),
      ],
    },
    orderBy: [{ name: "asc" }],
    take: limit,
    select: optionSelect,
  });
}

/**
 * Which college a registration points at: the one picked from the list (if its name still matches
 * what was submitted), else an organizer's alias for the typed text, else none yet.
 */
export async function resolveCollege(pickedId: string | null, typed: string) {
  if (pickedId) {
    const picked = await prisma.college.findUnique({ where: { id: pickedId }, select: optionSelect });
    if (picked && normaliseCollegeName(picked.name) === normaliseCollegeName(typed)) {
      return { collegeId: picked.id, collegeMatch: "USER" as const, college: picked.name };
    }
  }
  const alias = await prisma.collegeAlias.findUnique({
    where: { normalized: normaliseCollegeName(typed) },
    select: { collegeId: true },
  });
  return alias
    ? { collegeId: alias.collegeId, collegeMatch: "ALIAS" as const, college: typed }
    : { collegeId: null, collegeMatch: null, college: typed };
}

/** The live leaderboards re-read these users (their college changed). */
export async function refreshLeaderboardUsers(userIds: string[]) {
  const season = await activeSeason();
  if (!season || userIds.length === 0) return;
  await enqueueJobs(
    userIds.map((id) => ({
      kind: "LEADERBOARD_REFRESH" as const,
      payload: { seasonId: season.id, kind: "user" as const, id },
    })),
  );
}

/** What people typed that matches no college yet, most common first. */
export async function unmatchedColleges(limit = 50) {
  const profiles = await prisma.profile.findMany({
    where: { collegeId: null },
    select: { college: true },
  });
  const groups = new Map<string, { normalized: string; label: string; count: number }>();
  for (const { college } of profiles) {
    const normalized = normaliseCollegeName(college);
    if (!normalized) continue;
    const group = groups.get(normalized) ?? { normalized, label: college.trim(), count: 0 };
    group.count++;
    groups.set(normalized, group);
  }
  const list = [...groups.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { total: list.length, groups: list.slice(0, limit) };
}

/**
 * Maps a spelling to a college for everyone who typed it (and anyone who types it later). Profiles
 * that already point at a college keep it.
 */
export async function mapCollegeAlias(label: string, collegeId: string, actorId: string) {
  const normalized = normaliseCollegeName(label);
  if (!normalized) return { ok: false as const, message: "That name is empty." };
  const college = await prisma.college.findUnique({ where: { id: collegeId }, select: { id: true } });
  if (!college) return { ok: false as const, message: "Pick a college from the list." };
  await prisma.collegeAlias.upsert({
    where: { normalized },
    create: { normalized, label: label.trim(), collegeId, createdById: actorId },
    update: { collegeId, label: label.trim(), createdById: actorId },
  });
  const candidates = await prisma.profile.findMany({
    where: { collegeId: null },
    select: { id: true, userId: true, college: true },
  });
  const matched = candidates.filter((profile) => normaliseCollegeName(profile.college) === normalized);
  if (matched.length > 0) {
    await prisma.profile.updateMany({
      where: { id: { in: matched.map((profile) => profile.id) } },
      data: { collegeId, collegeMatch: "ALIAS" },
    });
    await refreshLeaderboardUsers(matched.map((profile) => profile.userId));
  }
  return { ok: true as const, mapped: matched.length };
}

/** An organizer adds a college the datasets don't have. */
export async function addCollege(input: { name: string; state: string; city?: string }) {
  const name = input.name.trim();
  const state = input.state.trim();
  const city = input.city?.trim() || null;
  if (name.length < 3 || state.length < 2) return { ok: false as const, message: "Give the name and the state." };
  const base = collegeSlug(name, city);
  for (let attempt = 0; attempt < 20; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    try {
      const college = await prisma.college.create({
        data: { name, state, city, slug, source: "ADMIN" },
        select: optionSelect,
      });
      await prisma.collegeAlias.upsert({
        where: { normalized: normaliseCollegeName(name) },
        create: { normalized: normaliseCollegeName(name), label: name, collegeId: college.id },
        update: {},
      });
      return { ok: true as const, college };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
      throw error;
    }
  }
  return { ok: false as const, message: "Couldn't find a free slug for that name." };
}

/** Corrects a college's details (organizers). The slug stays, so links keep working. */
export async function updateCollege(id: string, input: { name: string; state: string; city?: string }) {
  const name = input.name.trim();
  const state = input.state.trim();
  if (name.length < 3 || state.length < 2) return { ok: false as const, message: "Give the name and the state." };
  const college = await prisma.college.update({
    where: { id },
    data: { name, state, city: input.city?.trim() || null },
    select: { id: true, profiles: { select: { userId: true } } },
  });
  await refreshLeaderboardUsers(college.profiles.map((profile) => profile.userId));
  return { ok: true as const };
}

/** States that have at least one college, for the leaderboard filter. */
export async function collegeStates(): Promise<string[]> {
  const rows = await prisma.college.findMany({ distinct: ["state"], select: { state: true }, orderBy: { state: "asc" } });
  return rows.map((row) => row.state);
}
