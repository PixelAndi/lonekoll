import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from './model.ts';
import type { PaySlip, SlipLine } from './payslip.ts';
import { vacationDaysTaken, vacationLedger } from './vacationDays.ts';

// Made-up slips: a vacation year from 1 April, a full year's employment (25 days).
const settings: Settings = { ...DEFAULT_SETTINGS, employedSince: '2025-01-01', vacationYearStartMonth: 4 };
const taken = (n: number, saved = false): SlipLine => ({ code: '1', text: saved ? 'Uttag sparade semesterdagar' : 'Uttag betalda semesterdagar', quantity: n, unit: 'Dagar', category: 'vacationDays' });
const slip = (month: string, paid: number, saved: number, lines: SlipLine[] = []): PaySlip => ({ periodStart: `${month}-01`, lines, balances: { vacationDaysPaid: paid, vacationDaysSaved: saved } });

describe('vacation days on the slips', () => {
  it('counts the days taken, paid and saved apart', () => {
    expect(vacationDaysTaken(slip('2027-05', 0, 0, [taken(3), taken(2, true)]))).toEqual({ paid: 3, saved: 2 });
  });

  it('follows each balance from the one before, and the new year from what was earned', () => {
    const ledger = vacationLedger(
      [slip('2027-02', 6, 4), slip('2027-03', 4, 4, [taken(2)]), slip('2027-04', 20, 8, [taken(5)]), slip('2027-05', 17, 8, [taken(3)])],
      settings,
      '2027-06-10',
    );
    expect(ledger.steps.map((s) => [s.expectedPaid, s.expectedSaved, s.mismatch])).toEqual([
      [undefined, undefined, false],
      [4, 4, false],
      // New year: 25 earned − 5 taken; the 4 paid days left are saved (4 + 4).
      [20, 8, false],
      [17, 8, false],
    ]);
    expect(ledger.latest).toEqual({ month: '2027-05-01', paid: 17, saved: 8 });
  });

  it('finds a balance that doesn’t follow from the days taken, and skips a gap it can’t check', () => {
    const ledger = vacationLedger([slip('2027-05', 20, 0), slip('2027-06', 18, 0, [taken(3)]), slip('2027-09', 10, 0)], settings, '2027-10-01');
    expect(ledger.steps.map((s) => s.mismatch)).toEqual([false, true, false]);
  });
});
