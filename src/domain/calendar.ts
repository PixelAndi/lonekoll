import type { ShiftResult } from './calc.ts';
import { specialDay } from './holidays.ts';
import type { DayRecord, Settings } from './model.ts';
import type { PaySlip } from './payslip.ts';
import { payDateFor } from './payday.ts';
import { usualWeekdays } from './reportCheck.ts';
import { sickPeriodOn } from './sick.ts';
import type { StampIssue } from './shifts.ts';
import { addDays, isoWeekday, monthEnd, type LocalDate } from './time.ts';

// The calendar's days: what each was (worked, sick, vacation, komp or other
// leave, a usual working day with nothing registered, a day still to come),
// how long was worked, whether it had OB, overtime or something to check,
// and the public holidays and the pay day. Drawn by the Kalender page as a
// year of small squares and a month of larger ones.

export type DayKind = 'worked' | 'sick' | 'vacation' | 'komp' | 'leave' | 'missing' | 'future' | 'free';

export interface CalendarDay {
  date: LocalDate;
  kind: DayKind;
  /** Minutes worked on the date. */
  minutes: number;
  ob: boolean;
  overtime: boolean;
  /** A stamp problem or a warning to look at. */
  warn: boolean;
  /** A public holiday (translation key), or an eve paid as a Sunday. */
  holiday?: { name: string; kind: 'holiday' | 'sunday' };
  /** The first day of a sick period (the karensavdrag). */
  karens: boolean;
  payDay: boolean;
  weekend: boolean;
}

export interface CalendarInput {
  days: DayRecord[];
  /** Absences the pay slips' dated lines show, for days with nothing logged (slipAbsences). */
  fromSlips?: Map<LocalDate, 'vacation' | 'sick'>;
  results: ShiftResult[];
  issues: StampIssue[];
  settings: Settings;
  today: LocalDate;
}

/** The days from `from` to `to`, each with what it was. */
export function calendarDays(from: LocalDate, to: LocalDate, input: CalendarInput): CalendarDay[] {
  const { days, results, issues, settings, today, fromSlips } = input;
  const byDate = new Map(days.map((d) => [d.date, d]));
  const usual = usualWeekdays(days, to < today ? to : today);
  const first = [...days.map((d) => d.date), settings.employedSince ?? '9999'].sort()[0];
  const minutes = new Map<LocalDate, number>();
  const ob = new Set<LocalDate>();
  const ot = new Set<LocalDate>();
  const warn = new Set<LocalDate>(issues.map((i) => i.date));
  for (const r of results) {
    if (r.shift.dates[r.shift.dates.length - 1] < from || r.shift.date > to) continue;
    for (const [date, m] of r.workedByDate) minutes.set(date, (minutes.get(date) ?? 0) + m);
    for (const [date, list] of r.byDate) {
      if (list.some((b) => b.category.startsWith('ob'))) ob.add(date);
      if (list.some((b) => b.category.startsWith('ot'))) ot.add(date);
    }
    if (r.warnings.some((w) => w !== 'holiday-worked')) warn.add(r.shift.date);
  }
  const payDay = settings.payDay ?? 25;
  const out: CalendarDay[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const day = byDate.get(date);
    const special = specialDay(date);
    const weekday = isoWeekday(date);
    const worked = minutes.get(date) ?? 0;
    let kind: DayKind;
    // Nothing logged: what the pay slip says about the day (vacation or sick pay with its dates).
    const absence = day?.absence?.type ?? (worked === 0 && !(day?.rows.length ?? 0) ? fromSlips?.get(date) : undefined);
    if (worked > 0 || (day?.rows.length ?? 0) > 0) kind = 'worked';
    else if (absence === 'sick') kind = 'sick';
    else if (absence === 'vacation') kind = 'vacation';
    else if (absence === 'komp' || absence === 'timebank') kind = 'komp';
    else if (absence) kind = 'leave';
    // Today isn't over: not missing yet.
    else if (date >= today) kind = 'future';
    else if (date >= first && usual.has(weekday) && special?.kind !== 'holiday') kind = 'missing';
    else kind = 'free';
    const sick = kind === 'sick' ? sickPeriodOn(days, date) : null;
    // Pay day: the one for the month before.
    const before = addDays(`${date.slice(0, 7)}-01`, -1).slice(0, 7);
    out.push({
      date,
      kind,
      minutes: worked,
      ob: ob.has(date),
      overtime: ot.has(date),
      warn: warn.has(date),
      holiday: special ? { name: special.name, kind: special.kind } : undefined,
      karens: !!sick && sick.start === date && !sick.relapse,
      payDay: payDateFor(before, payDay) === date,
      weekend: weekday >= 6,
    });
  }
  return out;
}

/**
 * Vacation and sick days as the pay slips' dated lines show them (vacation pay or days, sick pay,
 * karens), working days only – so the calendar has them where nothing was logged.
 */
export function slipAbsences(slips: PaySlip[]): Map<LocalDate, 'vacation' | 'sick'> {
  const out = new Map<LocalDate, 'vacation' | 'sick'>();
  for (const slip of slips)
    for (const l of slip.lines) {
      const kind = l.category === 'vacationPay' || l.category === 'vacationDays' ? 'vacation' : l.category === 'sickPay' || l.category === 'karens' ? 'sick' : null;
      if (!kind || !l.from) continue;
      const to = l.to ?? l.from;
      if (to < l.from || to > addDays(l.from, 62)) continue;
      for (let d = l.from; d <= to; d = addDays(d, 1)) if (isoWeekday(d) <= 5 && specialDay(d)?.kind !== 'holiday') out.set(d, kind);
    }
  return out;
}

/** A month's counts: days worked, sick, on vacation, on komp or other leave, weekday holidays, and days missing. */
export function monthCounts(list: CalendarDay[]) {
  const count = (k: DayKind) => list.filter((d) => d.kind === k).length;
  return {
    worked: count('worked'),
    sick: count('sick'),
    vacation: count('vacation'),
    komp: count('komp') + count('leave'),
    holidays: list.filter((d) => d.holiday?.kind === 'holiday' && !d.weekend).length,
    missing: count('missing'),
  };
}

/** The public holidays (and the eves paid as Sundays) from a day on, up to `n`. */
export function upcomingHolidays(from: LocalDate, n: number): { date: LocalDate; name: string; kind: 'holiday' | 'sunday' }[] {
  const out: { date: LocalDate; name: string; kind: 'holiday' | 'sunday' }[] = [];
  for (let d = from; out.length < n && d <= addDays(from, 400); d = addDays(d, 1)) {
    const s = specialDay(d);
    if (s) out.push({ date: d, name: s.name, kind: s.kind });
  }
  return out;
}

/** The months of a year as their first days. */
export const monthsOf = (year: number): LocalDate[] => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}-01`);

export { monthEnd };
