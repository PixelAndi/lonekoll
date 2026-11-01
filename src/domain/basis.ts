import { isHoliday } from './holidays.ts';
import type { DayRecord, Settings } from './model.ts';
import type { PaySlip } from './payslip.ts';
import { usualWeekdays } from './reportCheck.ts';
import { scheduledShift } from './schedule.ts';
import { addDays, isoWeekday, type LocalDate } from './time.ts';

// What the comparison of a pay slip rests on: the days logged in its period
// (stamps, or an absence), against the days the slip pays. A difference in
// hours means something different when days are missing from the log than
// when the log is complete – for the employee and for the employer reading
// the report – so the report says which days the basis has and lacks.

export interface Basis {
  /** none: nothing logged in the period · partial: days missing · full: nothing missing. */
  state: 'none' | 'partial' | 'full';
  /** Days in the period with stamps or an absence. */
  logged: LocalDate[];
  /** The days the slip pays, with their hours (slips with a wage line per day; empty otherwise). */
  paidDays: { date: LocalDate; hours: number }[];
  /** Days the slip pays with nothing logged. */
  paidNotLogged: { date: LocalDate; hours: number }[];
  /** Usual working days with nothing logged (slips without a line per day). */
  unlogged: LocalDate[];
}

/** The days a slip pays, from its wage lines dated one day each (the older layout). */
export function slipPaidDays(slip: PaySlip): { date: LocalDate; hours: number }[] {
  const hours = new Map<LocalDate, number>();
  for (const l of slip.lines) {
    if (l.category !== 'wage' || !l.from || (l.to && l.to !== l.from) || !l.quantity || l.quantity <= 0) continue;
    if (!/^(tim|timmar|h)$/i.test(l.unit ?? '')) continue;
    hours.set(l.from, (hours.get(l.from) ?? 0) + l.quantity);
  }
  return [...hours].map(([date, h]) => ({ date, hours: Math.round(h * 100) / 100 })).sort((a, b) => a.date.localeCompare(b.date));
}

/** The hours of work a slip pays (its wage lines in hours, deductions included). */
export function slipWageHours(slip: PaySlip): number {
  return slip.lines.filter((l) => l.category === 'wage' && /^(tim|timmar|h)$/i.test(l.unit ?? '')).reduce((s, l) => s + (l.quantity ?? 0), 0);
}

/**
 * What a slip's comparison rests on. `workedHours` (the hours the log gives for the period) tells
 * whether weekdays with nothing logged matter: a slip paying no more hours than were logged paid
 * none of them (days off, or a vacation not logged), so they don't make the basis incomplete.
 */
export function periodBasis(slip: PaySlip, days: DayRecord[], settings: Settings, start: LocalDate, end: LocalDate, today: LocalDate, workedHours?: number): Basis {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const isLogged = (date: LocalDate) => {
    const d = byDate.get(date);
    return !!d && (d.rows.length > 0 || !!d.absence);
  };
  const logged: LocalDate[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) if (isLogged(date)) logged.push(date);
  const paidDays = slipPaidDays(slip).filter((p) => p.date >= start && p.date <= end);
  const paidNotLogged = paidDays.filter((p) => !isLogged(p.date));

  // Without a line per day: the usual working days (or scheduled ones) with nothing logged, up to yesterday.
  const unlogged: LocalDate[] = [];
  if (!paidDays.length && logged.length) {
    const usual = usualWeekdays(days, end);
    const workday = (date: LocalDate) =>
      settings.scheduleMode === 'fixed' ? scheduledShift(settings, date, byDate.get(date)) !== null : usual.has(isoWeekday(date));
    const last = end < today ? end : addDays(today, -1);
    const from = settings.employedSince && settings.employedSince > start ? settings.employedSince : start;
    for (let date = from; date <= last; date = addDays(date, 1)) if (!isLogged(date) && workday(date) && !isHoliday(date)) unlogged.push(date);
    if (workedHours !== undefined && slipWageHours(slip) <= workedHours + 0.5) unlogged.length = 0;
  }

  const state = !logged.length ? 'none' : paidNotLogged.length || unlogged.length ? 'partial' : 'full';
  return { state, logged, paidDays, paidNotLogged, unlogged };
}
