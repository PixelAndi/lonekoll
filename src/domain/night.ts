import { buildShifts, type Shift } from './shifts.ts';
import { utcToLocal, type LocalDate } from './time.ts';
import type { DayRecord } from './model.ts';

// Permanent night work (Livsmedelsavtalet §3.1.1, anm. 1): working at least
// three hours between 00:00 and 05:00 as a rule. Its ordinary week is 38
// hours, not 40; an hourly wage keeps up through skiftformstillägg, 5.3 % per
// hour worked (§4.4); a monthly salary stays whole (Bilaga F §4). Found from
// the stamps, to be confirmed by the user – the app doesn't know the schedule.

/** Three hours between 00:00 and 05:00. */
export const NIGHT_MINUTES = 180;
/** At least this share of the shifts. */
const NIGHT_SHARE = 0.75;
/** And at least this many of them. */
const LEAST_SHIFTS = 8;

const MINUTE_MS = 60_000;

/** Minutes of a shift between 00:00 and 05:00 (local time). */
export function nightMinutes(shift: Shift): number {
  let n = 0;
  for (const iv of shift.intervals)
    for (let t = iv.start; t < iv.end; t += MINUTE_MS) {
      if (utcToLocal(t).minute < 5 * 60) n++;
    }
  return n;
}

export interface NightWork {
  /** The first day of the latest stretch of night work. */
  from: LocalDate;
  /** Shifts in the stretch, and of them those with three night hours. */
  shifts: number;
  nights: number;
}

/**
 * The latest stretch where most shifts (three in four) have three hours between 00:00 and 05:00,
 * from its first night shift; null when the stamps don't show permanent night work.
 */
export function nightWork(days: DayRecord[]): NightWork | null {
  const shifts = buildShifts(days)
    .shifts.filter((s) => s.workedMinutes >= 60)
    .sort((a, b) => a.start - b.start);
  const night = shifts.map((s) => nightMinutes(s) >= NIGHT_MINUTES);
  let nights = 0;
  let best: NightWork | null = null;
  // Back from the latest shift: the earliest night shift from which on the share holds.
  for (let i = shifts.length - 1; i >= 0; i--) {
    if (night[i]) nights++;
    const count = shifts.length - i;
    if (night[i] && count >= LEAST_SHIFTS && nights / count >= NIGHT_SHARE) best = { from: shifts[i].date, shifts: count, nights };
  }
  // The latest shifts themselves must be nights: a stretch that has ended is not the work now.
  const recent = night.slice(-LEAST_SHIFTS);
  if (best && recent.filter(Boolean).length / recent.length < NIGHT_SHARE) return null;
  return best;
}
