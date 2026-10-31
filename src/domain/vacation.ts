import { agreementFor, RULES } from './agreement.ts';
import type { Settings } from './model.ts';
import type { PaySlip } from './payslip.ts';
import { addDays, addYears, daysBetween, monthEnd, type LocalDate } from './time.ts';

// Semesterlön (Livsmedelsavtalet §5.7): 13.2 % of the pay that fell due in
// the earning year (intjänandeåret), spread over the vacation days earned in
// it, and for bakeries at least the amount per day in Bageri §5. Vacation is
// taken in the year after the earning year (semesteråret), so the pay slips
// paid out during the earning year are what it is checked against.

const PAID_DAYS_FULL_YEAR = 25;

export interface Year {
  start: LocalDate;
  end: LocalDate;
}

/** The earning year a date falls in: 1 April–31 March, or the calendar year. */
export function earningYearOf(date: LocalDate, settings: Pick<Settings, 'vacationYearStartMonth'>): Year {
  const month = String(settings.vacationYearStartMonth).padStart(2, '0');
  let start: LocalDate = `${date.slice(0, 4)}-${month}-01`;
  if (start > date) start = addYears(start, -1);
  return { start, end: addDays(addYears(start, 1), -1) };
}

/** The earning year vacation taken on a date is paid from: the one before. */
export function earningYearForVacationOn(date: LocalDate, settings: Pick<Settings, 'vacationYearStartMonth'>): Year {
  const current = earningYearOf(date, settings);
  return { start: addYears(current.start, -1), end: addDays(current.start, -1) };
}

/** The date a slip's pay fell due: its pay date, else the end of its pay period. */
export const slipDueDate = (slip: PaySlip): LocalDate | undefined => slip.payDate ?? slip.periodEnd ?? slip.periodStart;

export interface VacationBasis {
  year: Year;
  /** Each month of the earning year ("2025-04"), and whether a pay slip paid in it is imported. */
  months: { month: string; covered: boolean }[];
  covered: number;
  /** Every month has its pay slip: the vacation pay can be worked out. */
  complete: boolean;
  /** Pay that fell due in the year (gross pay less vacation pay itself), from the slips there are. */
  pay: number;
  /** Vacation days with pay earned in the year (25 for a whole year's employment). */
  paidDays: number;
  /** 13.2 % of the pay per earned day; only meaningful when `complete`. */
  perDay: number;
  /** The agreement's lowest amount per day (Bageri §5), for at least six months' employment. */
  minimum?: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** What the vacation pay for an earning year rests on, from the imported pay slips. */
export function vacationBasis(slips: PaySlip[], settings: Settings, year: Year): VacationBasis {
  const months: VacationBasis['months'] = [];
  for (let d = year.start; d <= year.end; d = addDays(monthEnd(d), 1)) months.push({ month: d.slice(0, 7), covered: false });
  let pay = 0;
  for (const slip of slips) {
    const due = slipDueDate(slip);
    if (!due || due < year.start || due > year.end) continue;
    const month = months.find((m) => m.month === due.slice(0, 7));
    if (month) month.covered = true;
    // Vacation pay is not itself pay that earns vacation pay.
    const vacationPay = slip.lines.filter((l) => l.category === 'vacationPay').reduce((s, l) => s + (l.amount ?? 0), 0);
    pay += (slip.gross ?? slip.lines.reduce((s, l) => s + (l.amount ?? 0), 0)) - vacationPay;
  }
  const covered = months.filter((m) => m.covered).length;

  // Employed for part of the year: a share of the 25 days, rounded up (Semesterlagen 7 §).
  const from = settings.employedSince && settings.employedSince > year.start ? settings.employedSince : year.start;
  const employedDays = from > year.end ? 0 : daysBetween(from, year.end) + 1;
  const yearDays = daysBetween(year.start, year.end) + 1;
  const paidDays = employedDays >= yearDays ? PAID_DAYS_FULL_YEAR : Math.ceil((PAID_DAYS_FULL_YEAR * employedDays) / yearDays);

  // The lowest amount per day for vacation taken in the following year, part time in proportion.
  const agreement = agreementFor(addYears(year.end, 1));
  const minimum = agreement && employedDays >= 182 ? round2((agreement.vacationPayPerDayMin * settings.employmentPercent) / 100) : undefined;

  return {
    year,
    months,
    covered,
    complete: covered === months.length,
    pay: round2(pay),
    paidDays,
    perDay: paidDays ? round2((pay * RULES.vacationPayPercent) / paidDays) : 0,
    minimum,
  };
}

/** The vacation pay per day the agreement gives: 13.2 % per earned day, at least the minimum. */
export const vacationPayPerDay = (basis: VacationBasis) => Math.max(basis.perDay, basis.minimum ?? 0);
