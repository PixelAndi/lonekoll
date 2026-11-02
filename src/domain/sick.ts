import type { DayRecord } from './model.ts';
import { addDays, daysBetween, type LocalDate } from './time.ts';

// A sick period as the law counts it (Sjuklönelagen): calendar days from the
// first sick day. Day 1 has the karensavdrag; the employer pays sick pay
// (80 %) for days 1–14; from day 8 a doctor's certificate (läkarintyg) is
// needed – the employer may ask for one earlier; from day 15 sjukpenning is
// applied for at Försäkringskassan. Falling ill again within five days of
// the last sick day continues the same period (återinsjuknande, 8 §).

/** Days between two sick days that still make one period (återinsjuknande). */
export const RELAPSE_DAYS = 5;

export interface SickPeriod {
  start: LocalDate;
  /** The last day registered as sick. */
  last: LocalDate;
  /** Calendar day of the period on `today` (1 = the first sick day). */
  dayNo: number;
  /** From this day a doctor's certificate is needed (day 8). */
  certificateFrom: LocalDate;
  /** From this day Försäkringskassan pays (day 15). */
  insuranceFrom: LocalDate;
  /** Sick days registered in the period. */
  sickDays: number;
}

/** The sick period going on (its last sick day today or yesterday), or null. */
export function currentSickPeriod(days: DayRecord[], today: LocalDate): SickPeriod | null {
  const sick = days
    .filter((d) => d.absence?.type === 'sick' && d.date <= today)
    .map((d) => d.date)
    .sort();
  const last = sick[sick.length - 1];
  if (!last || daysBetween(last, today) > 1) return null;
  let start = last;
  for (let i = sick.length - 2; i >= 0; i--) {
    if (daysBetween(sick[i], start) > RELAPSE_DAYS + 1) break;
    start = sick[i];
  }
  return {
    start,
    last,
    dayNo: daysBetween(start, today) + 1,
    certificateFrom: addDays(start, 7),
    insuranceFrom: addDays(start, 14),
    sickDays: sick.filter((d) => d >= start).length,
  };
}
