import { isHoliday } from './holidays.ts';
import type { DayRecord, ScheduledShift, Settings } from './model.ts';
import { buildShifts } from './shifts.ts';
import { addDays, fromMinutes, isoWeekday, MINUTE_MS, toMinutes, utcToLocal, weekStart, type LocalDate, type LocalTime } from './time.ts';

// Finding the user's work pattern in the stamps: which weekdays they usually
// work and when they start, to suggest a schedule or the rules without one.
// Only the start is used for the schedule: at the end of a production line
// the end time follows the work, so the ordinary end is the start plus the
// ordinary shift length, and what goes beyond it is overtime.

/** How far back the stamps are looked at. */
const WEEKS_BACK = 12;
/** Needed before anything is suggested. */
const MIN_SHIFTS = 8;
const MIN_WEEKS = 2;
/** A weekday worked in at least this share of the weeks is a regular workday. */
const REGULAR_SHARE = 0.5;
/** Starts within this range (the middle 80 %) count as a steady start. */
const STEADY_START_MINUTES = 60;
/** Ends spread wider than this count as varying. */
const VARYING_END_MINUTES = 60;
/** Suggested starts are rounded to this, since people stamp in a little early or late. */
const START_ROUNDING = 15;

export interface DayPattern {
  /** 1 = Monday … 7 = Sunday. */
  weekday: number;
  /** Weeks this day was worked, of the weeks looked at. */
  worked: number;
  weeks: number;
  /** Typical start, rounded. */
  start: LocalTime;
  /** The middle 80 % of the starts and ends. */
  startFrom: LocalTime;
  startTo: LocalTime;
  endFrom: LocalTime;
  endTo: LocalTime;
  /** Typical stamped break, minutes. */
  breakMinutes: number;
}

export interface WorkPattern {
  shifts: number;
  weeks: number;
  /** The regular workdays, Monday first. */
  days: DayPattern[];
  /** Every regular day starts within STEADY_START_MINUTES: a schedule fits. */
  steadyStart: boolean;
  /** The end times vary widely. */
  endsVary: boolean;
  /** When ordinary working time starts on a Monday. */
  ordinaryStart: LocalTime;
  /** A one-week schedule: start as usual, end after the ordinary shift length and the break. */
  week: (ScheduledShift | null)[];
}

const minutesOfDay = (utcMs: number) => utcToLocal(utcMs).minute;

/** Clock minutes around a reference, so 23:50 and 00:10 are 20 minutes apart. */
const around = (values: number[]) => {
  const ref = values[0];
  return values.map((v) => ref + ((((v - ref + 720) % 1440) + 1440) % 1440) - 720).sort((a, b) => a - b);
};
const pick = (sorted: number[], q: number) => sorted[Math.round(q * (sorted.length - 1))];
const clock = (m: number) => fromMinutes(Math.round(m));

export function suggestWorkPattern(days: DayRecord[], settings: Settings, today: LocalDate): WorkPattern | null {
  const from = weekStart(addDays(today, -7 * WEEKS_BACK));
  const recent = days.filter((d) => d.date >= addDays(from, -1) && d.date <= today);
  const shifts = buildShifts(recent).shifts.filter((s) => s.date >= from && s.date <= today);
  const weeks = new Set(shifts.map((s) => weekStart(s.date)));
  if (shifts.length < MIN_SHIFTS || weeks.size < MIN_WEEKS) return null;

  const result: DayPattern[] = [];
  for (let weekday = 1; weekday <= 7; weekday++) {
    const own = shifts.filter((s) => isoWeekday(s.date) === weekday && !isHoliday(s.date));
    // Weeks where this weekday was a holiday don't count against it.
    const possible = [...weeks].filter((w) => !isHoliday(addDays(w, weekday - 1))).length;
    const worked = new Set(own.map((s) => weekStart(s.date))).size;
    if (possible === 0 || worked / possible < REGULAR_SHARE) continue;
    const starts = around(own.map((s) => minutesOfDay(s.start)));
    const ends = around(own.map((s) => minutesOfDay(s.end)));
    const breaks = own
      .map((s) => Math.round((s.end - s.start) / MINUTE_MS) - s.workedMinutes)
      .sort((a, b) => a - b);
    result.push({
      weekday,
      worked,
      weeks: possible,
      start: clock(Math.round(pick(starts, 0.5) / START_ROUNDING) * START_ROUNDING),
      startFrom: clock(pick(starts, 0.1)),
      startTo: clock(pick(starts, 0.9)),
      endFrom: clock(pick(ends, 0.1)),
      endTo: clock(pick(ends, 0.9)),
      breakMinutes: Math.round(pick(breaks, 0.5) / 5) * 5,
    });
  }
  if (result.length === 0) return null;

  const spread = (a: LocalTime, b: LocalTime) => around([toMinutes(a), toMinutes(b)]).reduce((x, y) => Math.abs(y - x));
  const week: (ScheduledShift | null)[] = Array(7).fill(null);
  for (const d of result) {
    week[d.weekday - 1] = { start: d.start, end: clock(toMinutes(d.start) + settings.ordinaryShiftMinutes + d.breakMinutes), breakMinutes: d.breakMinutes };
  }
  return {
    shifts: shifts.length,
    weeks: weeks.size,
    days: result,
    steadyStart: result.every((d) => spread(d.startFrom, d.startTo) <= STEADY_START_MINUTES),
    endsVary: result.some((d) => spread(d.endFrom, d.endTo) > VARYING_END_MINUTES),
    ordinaryStart: (result.find((d) => d.weekday === 1) ?? result[0]).start,
    week,
  };
}
