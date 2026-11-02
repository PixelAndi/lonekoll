import type { Settings } from './model.ts';
import type { PaySlip } from './payslip.ts';
import { earningYearForVacationOn, earningYearOf, vacationBasis } from './vacation.ts';
import { addDays, monthEnd, type LocalDate } from './time.ts';

// Vacation days, counted twice to catch mistakes: the balances the pay slips
// print ("Betalda", "Sparade") against what the slips themselves say was
// taken ("Uttag betalda/sparade semesterdagar") – each slip's balance should
// be the one before less the days taken, and at the start of a vacation
// year the paid days start again from what was earned. A slip that doesn't
// follow is something to check.

export interface VacationStep {
  /** The slip's period start and pay day. */
  month: LocalDate;
  payDate?: LocalDate;
  paidTaken: number;
  savedTaken: number;
  printedPaid?: number;
  printedSaved?: number;
  /** What the balances should be from the slip before (undefined: nothing to check against). */
  expectedPaid?: number;
  expectedSaved?: number;
  /** A new vacation year begins with this slip. */
  newYear: boolean;
  /** The printed balance doesn't follow from the one before. */
  mismatch: boolean;
}

export interface VacationLedger {
  steps: VacationStep[];
  /** The latest printed balances. */
  latest?: { month: LocalDate; paid: number; saved: number };
  /** Paid days earned for the vacation year now (25 a full year). */
  earnedNow?: number;
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

/** Days taken on a slip, paid and saved apart (a "days" line, else the vacation pay counted in days). */
export function vacationDaysTaken(slip: PaySlip): { paid: number; saved: number } {
  const daysLines = slip.lines.filter((l) => l.category === 'vacationDays' && (l.quantity ?? 0) > 0);
  const lines = daysLines.length ? daysLines : slip.lines.filter((l) => l.category === 'vacationPay' && /dag/i.test(l.unit ?? '') && (l.quantity ?? 0) > 0);
  let paid = 0;
  let saved = 0;
  for (const l of lines) {
    if (/sparad/i.test(l.text)) saved += l.quantity!;
    else paid += l.quantity!;
  }
  return { paid, saved };
}

/** The month after a month's first day. */
const nextMonth = (m: LocalDate) => addDays(monthEnd(m), 1);

export function vacationLedger(slips: PaySlip[], settings: Settings, today: LocalDate): VacationLedger {
  const dated = slips
    .filter((s) => s.periodStart)
    .sort((a, b) => a.periodStart!.localeCompare(b.periodStart!) || (a.payDate ?? '').localeCompare(b.payDate ?? ''));
  const steps: VacationStep[] = [];
  let prev: { month: LocalDate; paid?: number; saved?: number } | null = null;
  for (const slip of dated) {
    const month = slip.periodStart!.slice(0, 8) + '01';
    const taken = vacationDaysTaken(slip);
    const printedPaid = slip.balances.vacationDaysPaid;
    const printedSaved = slip.balances.vacationDaysSaved;
    // Only a slip right after the one before (the next month, or another payout the same month) can be checked against it.
    const follows = !!prev && (prev.month === month || nextMonth(prev.month) === month);
    const newYear = !!prev && earningYearOf(prev.month, settings).start !== earningYearOf(month, settings).start;
    let expectedPaid: number | undefined;
    let expectedSaved: number | undefined;
    if (follows && prev!.paid !== undefined) {
      if (newYear) {
        const earned = vacationBasis(slips, settings, earningYearForVacationOn(month, settings)).paidDays;
        expectedPaid = earned - taken.paid;
        // Paid days left over are usually saved; days lost or paid out instead show as a difference to ask about.
        if (prev!.saved !== undefined) expectedSaved = prev!.saved + prev!.paid - taken.saved;
      } else {
        expectedPaid = prev!.paid - taken.paid;
        if (prev!.saved !== undefined) expectedSaved = prev!.saved - taken.saved;
      }
    }
    const mismatch =
      (expectedPaid !== undefined && printedPaid !== undefined && !near(expectedPaid, printedPaid)) ||
      (expectedSaved !== undefined && printedSaved !== undefined && !near(expectedSaved, printedSaved));
    steps.push({ month, payDate: slip.payDate, paidTaken: taken.paid, savedTaken: taken.saved, printedPaid, printedSaved, expectedPaid, expectedSaved, newYear, mismatch });
    if (printedPaid !== undefined || printedSaved !== undefined) prev = { month, paid: printedPaid, saved: printedSaved };
    else prev = null;
  }
  const withBalances = [...steps].reverse().find((s) => s.printedPaid !== undefined);
  return {
    steps,
    latest: withBalances ? { month: withBalances.month, paid: withBalances.printedPaid!, saved: withBalances.printedSaved ?? 0 } : undefined,
    earnedNow: vacationBasis(slips, settings, earningYearForVacationOn(today, settings)).paidDays,
  };
}
