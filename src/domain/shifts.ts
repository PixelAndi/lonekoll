import type { DayRecord } from './model.ts';
import { localToUtc, toMinutes, utcToLocal, addDays, MINUTE_MS, type LocalDate } from './time.ts';

// Turns the clock's per-day stamps into work intervals and shifts.
// The clock shows a shift that crosses midnight as an "In" without "Ut" on
// one day and an "Ut" without "In" on the next; here they become one shift.

export interface Interval {
  start: number; // UTC ms
  end: number;
}

export interface Shift {
  /** Local date the shift starts on. */
  date: LocalDate;
  intervals: Interval[];
  start: number;
  end: number;
  workedMinutes: number;
  /** Dates whose stamps the shift is built from. */
  dates: LocalDate[];
}

export type StampIssueCode = 'missing-out' | 'missing-in' | 'too-long';

export interface StampIssue {
  date: LocalDate;
  code: StampIssueCode;
  time: string;
}

/** Breaks longer than this split a day into separate shifts. */
const MAX_BREAK_MINUTES = 180;
/** An In and an Ut further apart than this are not paired. */
const MAX_INTERVAL_MINUTES = 16 * 60;

interface StampEvent {
  kind: 'in' | 'out';
  at: number;
  date: LocalDate;
  time: string;
}

function eventsOf(days: DayRecord[]): StampEvent[] {
  const events: StampEvent[] = [];
  for (const day of days) {
    for (const row of day.rows) {
      if (row.in) events.push({ kind: 'in', at: localToUtc(day.date, row.in), date: day.date, time: row.in });
      if (row.out) {
        // Typed by hand as one row, a night shift ends "before" it starts: next day.
        const nextDay = row.in !== null && toMinutes(row.out) < toMinutes(row.in);
        const outDate = nextDay ? addDays(day.date, 1) : day.date;
        events.push({ kind: 'out', at: localToUtc(outDate, row.out), date: day.date, time: row.out });
      }
    }
  }
  // Same instant: an Ut closes the earlier shift before the next In opens.
  return events.sort((a, b) => a.at - b.at || (a.kind === 'out' ? -1 : 1));
}

export function buildShifts(days: DayRecord[]): { shifts: Shift[]; issues: StampIssue[] } {
  const issues: StampIssue[] = [];
  const intervals: (Interval & { dates: LocalDate[] })[] = [];
  let open: StampEvent | null = null;
  for (const e of eventsOf(days)) {
    if (e.kind === 'in') {
      if (open) issues.push({ date: open.date, code: 'missing-out', time: open.time });
      open = e;
      continue;
    }
    if (!open) {
      issues.push({ date: e.date, code: 'missing-in', time: e.time });
      continue;
    }
    if (e.at - open.at > MAX_INTERVAL_MINUTES * MINUTE_MS) {
      issues.push({ date: open.date, code: 'too-long', time: open.time });
      issues.push({ date: e.date, code: 'missing-in', time: e.time });
      open = null;
      continue;
    }
    intervals.push({ start: open.at, end: e.at, dates: [...new Set([open.date, e.date])] });
    open = null;
  }
  if (open) issues.push({ date: open.date, code: 'missing-out', time: open.time });

  const shifts: Shift[] = [];
  for (const iv of intervals) {
    const last = shifts[shifts.length - 1];
    if (last && iv.start - last.end <= MAX_BREAK_MINUTES * MINUTE_MS) {
      last.intervals.push({ start: iv.start, end: iv.end });
      last.end = iv.end;
      last.workedMinutes += Math.round((iv.end - iv.start) / MINUTE_MS);
      for (const d of iv.dates) if (!last.dates.includes(d)) last.dates.push(d);
    } else {
      shifts.push({
        date: utcToLocal(iv.start).date,
        intervals: [{ start: iv.start, end: iv.end }],
        start: iv.start,
        end: iv.end,
        workedMinutes: Math.round((iv.end - iv.start) / MINUTE_MS),
        dates: [...iv.dates],
      });
    }
  }
  return { shifts, issues };
}
