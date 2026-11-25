import { prisma } from "@repo/db";
import { BADGES } from "../../badges";

// What a leaderboard row shows besides its standing: the person (or college) behind an id. Kept
// in a Redis hash per season and filled from Postgres when an id is missing.

export type CollegeRef = { id: string; slug: string; name: string; state: string };

export type EntityInfo =
  | {
      kind: "user";
      name: string;
      login: string | null;
      image: string | null;
      college: CollegeRef | null;
      graduationYear: number | null;
      /** Up to three badge names, the rarest first. */
      badges: string[];
    }
  | { kind: "college"; name: string; slug: string; state: string; city: string | null };

const badgeRank = new Map(BADGES.map((badge, index) => [badge.key, index]));

/** Users' and colleges' display data, keyed by id. Unknown ids are left out. */
export async function loadEntities(seasonId: string, ids: string[]): Promise<Map<string, EntityInfo>> {
  const unique = [...new Set(ids)];
  const result = new Map<string, EntityInfo>();
  if (unique.length === 0) return result;
  const [users, colleges] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: unique } },
      select: {
        id: true,
        name: true,
        githubLogin: true,
        image: true,
        profile: {
          select: {
            graduationYear: true,
            collegeRecord: { select: { id: true, slug: true, name: true, state: true } },
          },
        },
        badges: { where: { seasonId }, select: { badgeKey: true } },
      },
    }),
    prisma.college.findMany({
      where: { id: { in: unique } },
      select: { id: true, slug: true, name: true, state: true, city: true },
    }),
  ]);
  for (const user of users) {
    result.set(user.id, {
      kind: "user",
      name: user.name || user.githubLogin || "Contributor",
      login: user.githubLogin,
      image: user.image,
      college: user.profile?.collegeRecord ?? null,
      graduationYear: user.profile?.graduationYear ?? null,
      // Later badges in BADGES are the harder ones.
      badges: user.badges
        .map((badge) => badge.badgeKey)
        .sort((a, b) => (badgeRank.get(b) ?? -1) - (badgeRank.get(a) ?? -1))
        .slice(0, 3)
        .map((key) => BADGES.find((badge) => badge.key === key)?.name ?? key),
    });
  }
  for (const college of colleges) {
    result.set(college.id, {
      kind: "college",
      name: college.name,
      slug: college.slug,
      state: college.state,
      city: college.city,
    });
  }
  return result;
}
