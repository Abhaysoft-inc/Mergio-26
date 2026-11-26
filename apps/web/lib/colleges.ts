import "server-only";
import { prisma, Prisma } from "@repo/db";
import { collegeSlug, normaliseCollegeName } from "@repo/scoring";
import { enqueueJobs } from "@repo/scoring/server";
import { unstable_cache } from "next/cache";
import { activeSeason } from "./projects-server";
import { likeText } from "./search";

// The curated college list (F-08): AICTE and UGC institutions plus ones organizers add. A profile
// keeps what the person typed; it points at a College when they picked one from the list, or when
// an organizer mapped that spelling to a college (a CollegeAlias, a separate relationship that
// then applies to everyone who typed the same thing).

export type CollegeOption = { id: string; slug: string; name: string; state: string; city: string | null };

const optionSelect = { id: true, slug: true, name: true, state: true, city: true } as const;

const fetchCollegePage = unstable_cache(
  async (text: string, limit: number, offset: number): Promise<{ colleges: CollegeOption[]; hasMore: boolean }> => {
    const normalized = normaliseCollegeName(text);
    const where: Prisma.CollegeWhereInput =
      text.length === 0
        ? {}
        : text.length === 1
          ? { name: { startsWith: likeText(text), mode: "insensitive" } }
          : {
              OR: [
                { name: { contains: likeText(text), mode: "insensitive" } },
                { city: { contains: likeText(text), mode: "insensitive" } },
                { state: { contains: likeText(text), mode: "insensitive" } },
                ...(normalized ? [{ aliases: { some: { normalized: { contains: likeText(normalized) } } } }] : []),
              ],
            };

    const rows = await prisma.college.findMany({
      where,
      orderBy: [{ name: "asc" }],
      skip: offset,
      take: limit + 1,
      select: optionSelect,
    });
    const hasMore = rows.length > limit;
    return { colleges: hasMore ? rows.slice(0, limit) : rows, hasMore };
  },
  ["colleges-search-v1"],
  { revalidate: 3600 },
);

/** Paginated colleges matching a search (by name, city, state, or alias), cached for 1 hour. */
export async function searchColleges(
  query: string,
  { limit = 20, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<{ colleges: CollegeOption[]; hasMore: boolean }> {
  return fetchCollegePage(query.trim().toLowerCase(), limit, offset);
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
    select: { collegeId: true, createdById: true, college: { select: { name: true } } },
  });
  // Every college's own name is an alias, but the first college imported with a shared name
  // ("Government Polytechnic") owns it. Typing such a name without picking from the list says
  // nothing about which one, so leave it unmatched for an organizer instead of guessing. An
  // organizer's own mapping (createdById set) is a decision, and always applies.
  const ambiguous =
    alias &&
    !alias.createdById &&
    normaliseCollegeName(alias.college.name) === normaliseCollegeName(typed) &&
    (await prisma.college.count({ where: { name: { equals: alias.college.name, mode: "insensitive" } } })) > 1;
  return alias && !ambiguous
    ? { collegeId: alias.collegeId, collegeMatch: "ALIAS" as const, college: typed }
    : { collegeId: null, collegeMatch: null, college: typed };
}

/**
 * The live leaderboards re-read these users (their college changed). Pass the colleges they left
 * too: the cache only knows a user's old college if that college's own board was built, so
 * without this the old college's total on the colleges board could keep their points.
 */
export async function refreshLeaderboardUsers(userIds: string[], previousColleges: string[] = []) {
  const season = await activeSeason();
  if (!season || userIds.length === 0) return;
  await enqueueJobs([
    ...userIds.map((id) => ({
      kind: "LEADERBOARD_REFRESH" as const,
      payload: { seasonId: season.id, kind: "user" as const, id },
    })),
    ...[...new Set(previousColleges)].map((id) => ({
      kind: "LEADERBOARD_REFRESH" as const,
      payload: { seasonId: season.id, kind: "college" as const, id },
    })),
  ]);
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
  // Its own entry on the colleges board shows the name and state too.
  await refreshLeaderboardUsers(college.profiles.map((profile) => profile.userId), [college.id]);
  return { ok: true as const };
}

/** States that have at least one college, for the leaderboard filter (cached 1h). */
export const collegeStates = unstable_cache(
  async (): Promise<string[]> => {
    const rows = await prisma.college.findMany({ distinct: ["state"], select: { state: true }, orderBy: { state: "asc" } });
    return rows.map((row) => row.state);
  },
  ["colleges-states-v1"],
  { revalidate: 3600 },
);
