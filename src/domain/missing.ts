import { isHoliday } from './holidays.ts';
import type { DayRecord, Settings } from './model.ts';
import { scheduledShift } from './schedule.ts';
import { addDays, datesInRange, monthEnd, type LocalDate } from './time.ts';

// What is missing between the start of the employment and today, month by
// month: so nothing is overlooked before a report is made or an old period
// is claimed. Only what can be known is flagged: a month with no days at
// all, days the schedule planned that have neither stamps nor an absence
// (when a schedule is set), a month without a pay slip (once it is surely
// paid), and dates without a wage set.

export type MissingKind = 'noDays' | 'planned' | 'noSlip' | 'noWage';

export interface MonthCheck {
  /** "2022-03". */
  month: string;
  /** Days with stamps or an absence. */
  days: number;
  /** Planned days (by the schedule) with neither stamps nor an absence, up to yesterday. */
  planned: LocalDate[];
  /** A pay slip covers the month. */
  slip: boolean;
  /** Dates in the month with no wage set (before the first wage's start). */
  noWageFrom?: LocalDate;
  /** The month is still going on. */
  current: boolean;
  missing: MissingKind[];
}

/** A month's pay slip is surely out this many days after the month ends (paid the 25th the month after). */
const SLIP_DUE_DAYS = 40;

export function checkMonths(
  start: LocalDate,
  today: LocalDate,
  days: DayRecord[],
  /** The periods the pay slips are for. */
  slips: { from: LocalDate; to: LocalDate }[],
  settings: Settings,
): MonthCheck[] {
  if (start > today) return [];
  const byDate = new Map(days.map((d) => [d.date, d]));
  const hasData = (d: DayRecord | undefined) => !!d && (d.rows.length > 0 || !!d.absence);
  const firstWage = [...settings.wages].map((w) => w.from).sort()[0];
  const out: MonthCheck[] = [];
  for (let first = `${start.slice(0, 7)}-01`; first <= today; first = addDays(monthEnd(first), 1)) {
    const month = first.slice(0, 7);
    const from = first < start ? start : first;
    const end = monthEnd(first);
    const current = end >= today;
    const upTo = current ? addDays(today, -1) : end;
    const dates = from <= upTo ? datesInRange(from, upTo) : [];
    const withData = datesInRange(first, end).filter((d) => hasData(byDate.get(d))).length;
    const planned =
      settings.scheduleMode !== 'none'
        ? dates.filter((d) => !isHoliday(d) && scheduledShift(settings, d, byDate.get(d)) && !hasData(byDate.get(d)))
        : [];
    const slip = slips.some((s) => s.from <= end && s.to >= first);
    const noWageFrom = !firstWage || firstWage > from ? from : undefined;
    const missing: MissingKind[] = [];
    if (!current && withData === 0) missing.push('noDays');
    if (planned.length) missing.push('planned');
    if (!slip && addDays(end, SLIP_DUE_DAYS) < today) missing.push('noSlip');
    if (noWageFrom && (withData > 0 || !current)) missing.push('noWage');
    out.push({ month, days: withData, planned, slip, noWageFrom, current, missing });
  }
  return out;
}
