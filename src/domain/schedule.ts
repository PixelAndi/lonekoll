import type { DayRecord, Schedule, ScheduledShift, Settings } from './model.ts';
import { addDays, daysBetween, isoWeekday, localToUtc, MINUTE_MS, toMinutes, weekStart, type LocalDate } from './time.ts';

// Working out what someone was scheduled to work on a given day, for people
// with a fixed (possibly rotating) schedule.

export function rotationWeek(schedule: Schedule, date: LocalDate): number {
  const n = schedule.weeks.length;
  if (n === 0) return 0;
  const weeks = Math.floor(daysBetween(schedule.startMonday, weekStart(date)) / 7);
  return ((weeks % n) + n) % n;
}

/** The scheduled shift for a date (a per-day change wins over the regular schedule). */
export function scheduledShift(settings: Settings, date: LocalDate, day?: DayRecord): ScheduledShift | null {
  if (settings.scheduleMode !== 'fixed') return null;
  if (day?.scheduleOverride === 'off') return null;
  const shift = day?.scheduleOverride ?? settings.schedule.weeks[rotationWeek(settings.schedule, date)]?.[isoWeekday(date) - 1] ?? null;
  // A half-filled day in the schedule editor isn't a shift yet.
  return shift && shift.start && shift.end ? shift : null;
}

/** Start and end of a scheduled shift as UTC instants. */
export function scheduledWindow(date: LocalDate, shift: ScheduledShift): { start: number; end: number } {
  const endDate = toMinutes(shift.end) <= toMinutes(shift.start) ? addDays(date, 1) : date;
  return { start: localToUtc(date, shift.start), end: localToUtc(endDate, shift.end) };
}

/** Paid minutes of a scheduled shift (length minus the break). */
export function scheduledMinutes(date: LocalDate, shift: ScheduledShift): number {
  const w = scheduledWindow(date, shift);
  return Math.max(0, Math.round((w.end - w.start) / MINUTE_MS) - shift.breakMinutes);
}

/** The shift as work intervals, with the break placed in the middle. */
export function scheduledIntervals(date: LocalDate, shift: ScheduledShift): { start: number; end: number }[] {
  const w = scheduledWindow(date, shift);
  if (shift.breakMinutes <= 0) return [w];
  const mid = w.start + (w.end - w.start) / 2;
  const half = (shift.breakMinutes * MINUTE_MS) / 2;
  return [
    { start: w.start, end: Math.round((mid - half) / MINUTE_MS) * MINUTE_MS },
    { start: Math.round((mid + half) / MINUTE_MS) * MINUTE_MS, end: w.end },
  ].filter((iv) => iv.end > iv.start);
}

/** Shifts in one pass of the rotation, as dates in the rotation's first weeks. */
export function rotationShifts(schedule: Schedule): { date: LocalDate; shift: ScheduledShift }[] {
  const out: { date: LocalDate; shift: ScheduledShift }[] = [];
  schedule.weeks.forEach((week, w) =>
    week.forEach((shift, d) => {
      if (shift?.start && shift.end) out.push({ date: addDays(schedule.startMonday, w * 7 + d), shift });
    }),
  );
  return out;
}
