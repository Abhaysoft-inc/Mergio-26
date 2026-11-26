import type { Award } from "./evaluate";
import type { Level } from "./rules";
import { addDays, istDay, istDayStart } from "./time";

// Turns "what this PR should be worth now" into ledger entries. The ledger is append-only
// (PRD §4.3): a change in worth is a new entry for the difference, never an edit. Running the
// plan again after it was written gives no entries, which makes scoring idempotent.

/**
 * `effectiveAt` is needed to take points back on the days they counted. Without it a reversal
 * counts from `now`.
 */
export type ExistingEntry = { ruleKey: string; points: number; effectiveAt?: Date };

export type PlannedEntry = {
  ruleKey: string;
  kind: "AWARD" | "REVERSAL";
  /** Signed: awards are positive, reversals negative. */
  points: number;
  level?: Level;
  description: string;
  /** When the points count. Later than the merge when the daily cap held them back. */
  effectiveAt: Date;
};

export type LedgerPlanInput = {
  desired: Award[];
  existing: ExistingEntry[];
  mergedAt: Date;
  now: Date;
  /**
   * Points already counted per IST day ("YYYY-MM-DD") for this contributor, from all PRs: awards
   * minus what was taken back on that day, so points that were reversed free up their cap room.
   */
  dailyUsed: ReadonlyMap<string, number>;
  /** Points per contributor per IST day; 0 turns the cap off. */
  dailyCap: number;
  /** Why points are being taken back, shown on reversal entries. */
  reversalDescription: string;
};

/**
 * Splits `points` over IST days starting with the merge day, filling each up to the daily cap.
 * The first part counts from the merge; later parts from the start of their day.
 */
export function allocateDaily(
  points: number,
  mergedAt: Date,
  dailyUsed: ReadonlyMap<string, number>,
  dailyCap: number,
): { points: number; effectiveAt: Date }[] {
  if (dailyCap <= 0) return [{ points, effectiveAt: mergedAt }];
  const used = new Map(dailyUsed);
  const parts: { points: number; effectiveAt: Date }[] = [];
  let remaining = points;
  let day = istDay(mergedAt);
  // A guard against a runaway loop; 366 days is far more than any season.
  for (let i = 0; remaining > 0 && i < 366; i++, day = addDays(day, 1)) {
    const room = dailyCap - (used.get(day) ?? 0);
    if (room <= 0) continue;
    const take = Math.min(room, remaining);
    used.set(day, (used.get(day) ?? 0) + take);
    parts.push({ points: take, effectiveAt: i === 0 ? mergedAt : istDayStart(day) });
    remaining -= take;
  }
  return parts;
}

/**
 * Splits a reversal of `points` (positive) over the days the rule's awards counted on, latest day
 * first (those are the ones held back by the cap, so the most recent points go first). Each part
 * counts from the same moment as the award it cancels, so the net is right on every day: a held
 * award that is reverted never shows as a loss before it would have counted, and a PR from last
 * week doesn't cost this week's points. Anything left over (older data without dates) counts now.
 */
function allocateReversal(
  points: number,
  entries: ExistingEntry[],
  now: Date,
): { points: number; effectiveAt: Date }[] {
  const days = new Map<string, { net: number; effectiveAt: Date }>();
  for (const entry of entries) {
    if (!entry.effectiveAt) continue;
    const day = istDay(entry.effectiveAt);
    const bucket = days.get(day) ?? { net: 0, effectiveAt: entry.effectiveAt };
    bucket.net += entry.points;
    // The reversal must not count before the latest award it cancels on that day.
    if (entry.points > 0 && entry.effectiveAt > bucket.effectiveAt) bucket.effectiveAt = entry.effectiveAt;
    days.set(day, bucket);
  }
  const parts: { points: number; effectiveAt: Date }[] = [];
  let remaining = points;
  for (const day of [...days.keys()].sort().reverse()) {
    if (remaining <= 0) break;
    const bucket = days.get(day)!;
    if (bucket.net <= 0) continue;
    const take = Math.min(bucket.net, remaining);
    parts.push({ points: take, effectiveAt: bucket.effectiveAt });
    remaining -= take;
  }
  if (remaining > 0) parts.push({ points: remaining, effectiveAt: now });
  return parts;
}

/**
 * Rule keys the engine owns: the level points and the bonuses. Other entries on a PR (organizer
 * adjustments, dispute corrections) are never touched by rescoring.
 */
export const isRuleKey = (ruleKey: string) => ruleKey === "base" || ruleKey.startsWith("bonus:");

export function planLedger(input: LedgerPlanInput): PlannedEntry[] {
  const current = new Map<string, number>();
  const byRule = new Map<string, ExistingEntry[]>();
  for (const entry of input.existing) {
    if (!isRuleKey(entry.ruleKey)) continue;
    current.set(entry.ruleKey, (current.get(entry.ruleKey) ?? 0) + entry.points);
    byRule.set(entry.ruleKey, [...(byRule.get(entry.ruleKey) ?? []), entry]);
  }
  const desired = new Map(input.desired.map((award) => [award.ruleKey, award]));
  const ruleKeys = [...new Set([...desired.keys(), ...current.keys()])].sort(
    // Base points first so they use the day's room before bonuses do.
    (a, b) => (a === "base" ? -1 : b === "base" ? 1 : a.localeCompare(b)),
  );

  const used = new Map(input.dailyUsed);
  const entries: PlannedEntry[] = [];
  for (const ruleKey of ruleKeys) {
    const award = desired.get(ruleKey);
    const delta = (award?.points ?? 0) - (current.get(ruleKey) ?? 0);
    if (delta > 0 && award) {
      for (const part of allocateDaily(delta, input.mergedAt, used, input.dailyCap)) {
        const day = istDay(part.effectiveAt);
        used.set(day, (used.get(day) ?? 0) + part.points);
        entries.push({
          ruleKey,
          kind: "AWARD",
          points: part.points,
          level: award.level,
          description: award.description,
          effectiveAt: part.effectiveAt,
        });
      }
    } else if (delta < 0) {
      // Entries added by this plan count too, so a rule reversed twice in one run can't overshoot.
      for (const part of allocateReversal(-delta, byRule.get(ruleKey) ?? [], input.now)) {
        const day = istDay(part.effectiveAt);
        used.set(day, (used.get(day) ?? 0) - part.points);
        entries.push({
          ruleKey,
          kind: "REVERSAL",
          points: -part.points,
          description: input.reversalDescription,
          effectiveAt: part.effectiveAt,
        });
      }
    }
  }
  return entries;
}
