import type { DayRecord } from './model.ts';
import { addDays, daysBetween, type LocalDate } from './time.ts';

// Sickness as the Sick Pay Act counts it (Sjuklönelagen, SFS 1991:1047):
// - a sick period is the time sick without a break (registered working days
//   with a weekend between them are one period);
// - the employer pays sick pay, 80 %, for the first 14 calendar days, with
//   the karensavdrag on the first (6–7 §§); from day 15 Försäkringskassan;
// - a period that begins within five days of the end of the one before
//   continues it: the 14 days count across both, and no new karensavdrag
//   (7 §, återinsjuknande);
// - from the seventh calendar day after the sick report – day 8 – a doctor's
//   certificate is needed (8 §); Försäkringskassan can require one earlier
//   (10 §), and under the agreement the employer can, naming the doctor and
//   paying for it (Livsmedelsavtalet §5.4).

/** A period beginning within this many days of the last one's end continues it (7 §). */
export const RELAPSE_DAYS = 5;
/** Registered sick days this far apart (a weekend between) are one period. */
const SAME_PERIOD_GAP = 3;
const SICK_PAY_DAYS = 14;

export interface SickPeriod {
  /** The first day of this period (the sick report). */
  start: LocalDate;
  /** The last day registered as sick. */
  last: LocalDate;
  /** Calendar day of the period on the given day (1 = the first sick day). */
  dayNo: number;
  /** It continues a period that ended at most five days before: no new karensavdrag. */
  relapse: boolean;
  /** From this day a doctor's certificate is needed (day 8 of this period). */
  certificateFrom: LocalDate;
  /** From this day Försäkringskassan pays (after 14 days of sick pay, across a relapse). */
  insuranceFrom: LocalDate;
}

/** Sick days as periods: runs of sick days, joined across a weekend (not across a day worked). */
function periods(sickDates: LocalDate[], worked: LocalDate[]): { start: LocalDate; last: LocalDate }[] {
  const out: { start: LocalDate; last: LocalDate }[] = [];
  for (const d of [...sickDates].sort()) {
    const cur = out[out.length - 1];
    if (cur && daysBetween(cur.last, d) <= SAME_PERIOD_GAP && !worked.some((w) => w > cur.last && w < d)) cur.last = d;
    else out.push({ start: d, last: d });
  }
  return out;
}

/** The sick period a day falls in (with any sick days added that aren't saved yet), or null. */
export function sickPeriodOn(days: DayRecord[], date: LocalDate, added: LocalDate[] = []): SickPeriod | null {
  const sick = [...new Set([...days.filter((d) => d.absence?.type === 'sick').map((d) => d.date), ...added])].filter((d) => d <= date);
  const all = periods(
    sick,
    days.filter((d) => d.rows.length > 0).map((d) => d.date),
  );
  // The latest period begun by the day, still going (or within a weekend of its last sick day).
  let i = -1;
  for (let k = all.length - 1; k >= 0 && i < 0; k--) if (all[k].start <= date && date <= addDays(all[k].last, SAME_PERIOD_GAP)) i = k;
  if (i < 0) return null;
  const p = all[i];
  // Sick pay days used in the periods it continues (each beginning within five days of the one before).
  let used = 0;
  let relapse = false;
  for (let j = i; j > 0 && daysBetween(all[j - 1].last, all[j].start) <= RELAPSE_DAYS; j--) {
    relapse = true;
    used += daysBetween(all[j - 1].start, all[j - 1].last) + 1;
  }
  const left = Math.max(0, SICK_PAY_DAYS - used);
  return {
    start: p.start,
    last: p.last,
    dayNo: daysBetween(p.start, date) + 1,
    relapse,
    certificateFrom: addDays(p.start, 7),
    insuranceFrom: addDays(p.start, left),
  };
}

/** The sick period going on (its last sick day today or yesterday), or null. */
export function currentSickPeriod(days: DayRecord[], today: LocalDate): SickPeriod | null {
  const p = sickPeriodOn(days, today);
  return p && daysBetween(p.last, today) <= 1 ? p : null;
}
