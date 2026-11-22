import type { Award } from "./evaluate";
import type { Level } from "./rules";
import { addDays, istDay, istDayStart } from "./time";

// Turns "what this PR should be worth now" into ledger entries. The ledger is append-only
// (PRD §4.3): a change in worth is a new entry for the difference, never an edit. Running the
// plan again after it was written gives no entries, which makes scoring idempotent.

export type ExistingEntry = { ruleKey: string; points: number };

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
  /** Points already counted per IST day ("YYYY-MM-DD") for this contributor, from all PRs. */
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
 * Rule keys the engine owns: the level points and the bonuses. Other entries on a PR (organizer
 * adjustments, dispute corrections) are never touched by rescoring.
 */
export const isRuleKey = (ruleKey: string) => ruleKey === "base" || ruleKey.startsWith("bonus:");

export function planLedger(input: LedgerPlanInput): PlannedEntry[] {
  const current = new Map<string, number>();
  for (const entry of input.existing) {
    if (!isRuleKey(entry.ruleKey)) continue;
    current.set(entry.ruleKey, (current.get(entry.ruleKey) ?? 0) + entry.points);
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
      entries.push({
        ruleKey,
        kind: "REVERSAL",
        points: delta,
        description: input.reversalDescription,
        effectiveAt: input.now,
      });
    }
  }
  return entries;
}
