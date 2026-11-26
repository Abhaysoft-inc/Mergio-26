// Badges (PRD §4.6, F-15). Each badge is a rule key plus a threshold, so a new badge only needs a
// row here (and, for a new rule key, one case in badgeValue). Badges are per season.

export type BadgeRule =
  | "scored_prs"
  | "advanced_prs"
  | "projects"
  | "week_streak"
  | "rank_at_most"
  | "quality_bonus";

export type BadgeDefinition = {
  key: string;
  name: string;
  description: string;
  rule: BadgeRule;
  threshold: number;
};

export const BADGES: readonly BadgeDefinition[] = [
  { key: "first-merge", name: "First Merge", description: "Your first scored pull request.", rule: "scored_prs", threshold: 1 },
  { key: "prs-5", name: "5 PRs", description: "Five scored pull requests.", rule: "scored_prs", threshold: 5 },
  { key: "prs-10", name: "10 PRs", description: "Ten scored pull requests.", rule: "scored_prs", threshold: 10 },
  { key: "prs-25", name: "25 PRs", description: "Twenty-five scored pull requests.", rule: "scored_prs", threshold: 25 },
  { key: "advanced-slayer", name: "Advanced Slayer", description: "Three scored advanced pull requests.", rule: "advanced_prs", threshold: 3 },
  { key: "explorer", name: "Explorer", description: "Scored pull requests on three or more projects.", rule: "projects", threshold: 3 },
  { key: "streak", name: "Streak", description: "A scored pull request in four weeks in a row.", rule: "week_streak", threshold: 4 },
  { key: "top-100", name: "Top 100", description: "Reached the top 100 of the season leaderboard.", rule: "rank_at_most", threshold: 100 },
  { key: "top-10", name: "Top 10", description: "Reached the top 10 of the season leaderboard.", rule: "rank_at_most", threshold: 10 },
  { key: "mentors-pick", name: "Mentor's Pick", description: "A mentor gave one of your pull requests the quality bonus.", rule: "quality_bonus", threshold: 1 },
];

export type BadgeStats = {
  scoredPrs: number;
  advancedPrs: number;
  /** Distinct projects with at least one scored PR. */
  projects: number;
  /** Weeks with a scored PR, named by their Monday ("YYYY-MM-DD"), in any order. */
  weeks: string[];
  /** Overall season rank, or null when unranked. */
  rank: number | null;
  qualityBonuses: number;
};

/** The longest run of consecutive weeks in `weeks`. */
export function longestWeekStreak(weeks: string[]): number {
  const sorted = [...new Set(weeks)].sort();
  let best = 0;
  let run = 0;
  let previous: number | null = null;
  for (const week of sorted) {
    const time = Date.parse(`${week}T00:00:00.000Z`);
    run = previous !== null && time - previous === 7 * 86_400_000 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = time;
  }
  return best;
}

/** How far the contributor is along a count-based rule. Rank isn't a count, so it is null. */
export function badgeValue(rule: BadgeRule, stats: BadgeStats): number | null {
  switch (rule) {
    case "scored_prs":
      return stats.scoredPrs;
    case "advanced_prs":
      return stats.advancedPrs;
    case "projects":
      return stats.projects;
    case "week_streak":
      return longestWeekStreak(stats.weeks);
    case "quality_bonus":
      return stats.qualityBonuses;
    case "rank_at_most":
      return null;
  }
}

export function meetsBadge(badge: BadgeDefinition, stats: BadgeStats): boolean {
  if (badge.rule === "rank_at_most") return stats.rank !== null && stats.rank <= badge.threshold;
  return (badgeValue(badge.rule, stats) ?? 0) >= badge.threshold;
}

export type BadgeProgress = { badge: BadgeDefinition; current: number; target: number };

/**
 * The unearned badge the contributor is closest to, for "progress to next badge". Only count-based
 * badges qualify (a rank can go down). Ties go to the badge listed first.
 */
export function nextBadge(stats: BadgeStats, earned: ReadonlySet<string>): BadgeProgress | null {
  let best: BadgeProgress | null = null;
  for (const badge of BADGES) {
    if (earned.has(badge.key) || badge.rule === "rank_at_most") continue;
    const current = Math.min(badgeValue(badge.rule, stats) ?? 0, badge.threshold);
    if (current >= badge.threshold) continue;
    if (!best || current / badge.threshold > best.current / best.target) {
      best = { badge, current, target: badge.threshold };
    }
  }
  return best;
}
