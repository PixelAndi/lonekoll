import { specialDay } from './holidays.ts';
import type { PaySlip } from './payslip.ts';
import { addDays, isoWeekday, type LocalDate } from './time.ts';

// A fixed pay day, as most Swedish employers have: the 25th of the month after
// the pay period, or the last banking day before it when it falls on a
// weekend, a public holiday or an eve banks are closed on (midsommarafton,
// julafton, nyårsafton).

/** A day banks pay out on: a weekday that is neither a holiday nor such an eve. */
export function isBankingDay(date: LocalDate): boolean {
  return isoWeekday(date) <= 5 && !specialDay(date);
}

/** The pay day of the month after a period ("2027-08" → 2027-09-24 for the 25th, a Saturday). */
export function payDateFor(periodMonth: string, day: number): LocalDate {
  const [y, m] = periodMonth.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  const last = new Date(Date.UTC(Number(next.slice(0, 4)), Number(next.slice(5, 7)), 0)).getUTCDate();
  let date: LocalDate = `${next}-${String(Math.min(day, last)).padStart(2, '0')}`;
  while (!isBankingDay(date)) date = addDays(date, -1);
  return date;
}

/** A slip whose pay day couldn't be read gets the one in the settings (marked, to be checked). */
export function withPayDay(slip: PaySlip, payDay: number | null): PaySlip {
  if (slip.payDate || !payDay || !slip.periodStart) return slip;
  return { ...slip, payDate: payDateFor(slip.periodStart.slice(0, 7), payDay), payDateFrom: 'setting' };
}
