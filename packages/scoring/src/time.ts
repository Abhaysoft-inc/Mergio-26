// The program runs on India Standard Time (UTC+5:30, no daylight saving): days and weeks
// (Monday 00:00 IST) for caps, weekly ranks and streaks are all IST calendar days.

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** The IST calendar day of an instant, as "YYYY-MM-DD". */
export function istDay(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The instant an IST calendar day ("YYYY-MM-DD") starts. */
export function istDayStart(day: string): Date {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) - IST_OFFSET_MS);
}

/** The calendar day `days` after `day`. */
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Monday 00:00 IST of the week containing `date`. */
export function istWeekStart(date: Date): Date {
  const day = istDay(date);
  const weekday = (new Date(`${day}T00:00:00.000Z`).getUTCDay() + 6) % 7; // Monday = 0
  return istDayStart(addDays(day, -weekday));
}

/** The week containing `date`, named by its Monday ("YYYY-MM-DD"). */
export function istWeekKey(date: Date): string {
  return istDay(istWeekStart(date));
}

export const HOUR_MS = 3_600_000;
export { DAY_MS };
