import { describe, expect, it } from 'vitest';
import { periodBasis, slipPaidDays } from './basis.ts';
import { DEFAULT_SETTINGS, type DayRecord } from './model.ts';
import type { PaySlip, SlipLine } from './payslip.ts';

// Made-up days and slips: September 2027 (1 September is a Wednesday).
const day = (date: string): DayRecord => ({ date, rows: [{ in: '06:00', out: '14:00' }], photoIds: [] }) as unknown as DayRecord;
const wageDay = (date: string, hours: number): SlipLine => ({
  code: '1106',
  text: 'Timlön',
  from: date,
  to: date,
  quantity: hours,
  unit: 'Timmar',
  unitPrice: 180,
  amount: hours * 180,
  category: 'wage',
});
/** An older slip: a wage line per day worked. */
const perDay = (lines: SlipLine[]): PaySlip => ({ periodStart: '2027-09-01', periodEnd: '2027-09-30', lines, balances: {} });
/** A newer slip: one summed wage line. */
const summed: PaySlip = {
  periodStart: '2027-09-01',
  periodEnd: '2027-09-30',
  lines: [{ code: '1106', text: 'Timlön', quantity: 160, unit: 'Timmar', unitPrice: 180, amount: 28800, category: 'wage' }],
  balances: {},
};
const basisOf = (slip: PaySlip, days: DayRecord[]) => periodBasis(slip, days, DEFAULT_SETTINGS, '2027-09-01', '2027-09-30', '2027-11-01');

describe('the days a slip pays', () => {
  it('are its wage lines dated one day each, hours added up per day', () => {
    const slip = perDay([wageDay('2027-09-02', 8), wageDay('2027-09-01', 8.5), wageDay('2027-09-02', 0.5)]);
    expect(slipPaidDays(slip)).toEqual([
      { date: '2027-09-01', hours: 8.5 },
      { date: '2027-09-02', hours: 8.5 },
    ]);
    expect(slipPaidDays(summed)).toEqual([]);
  });
});

describe('what a comparison rests on', () => {
  const slip = perDay([wageDay('2027-09-01', 8), wageDay('2027-09-02', 8), wageDay('2027-09-03', 8)]);

  it('is nothing when no day in the period is logged', () => {
    const b = basisOf(slip, [day('2027-08-31'), day('2027-10-01')]);
    expect(b.state).toBe('none');
    expect(b.paidDays).toHaveLength(3);
  });

  it('names the days the slip pays that are missing from the log, with their hours', () => {
    const b = basisOf(slip, [day('2027-09-01')]);
    expect(b.state).toBe('partial');
    expect(b.paidNotLogged).toEqual([
      { date: '2027-09-02', hours: 8 },
      { date: '2027-09-03', hours: 8 },
    ]);
  });

  it('is complete when every day the slip pays is logged (an absence counts)', () => {
    const sick = { ...day('2027-09-03'), rows: [], absence: { type: 'sick' } } as unknown as DayRecord;
    expect(basisOf(slip, [day('2027-09-01'), day('2027-09-02'), sick]).state).toBe('full');
  });

  it('without a line per day, names the usual working days with nothing logged', () => {
    // Weekdays logged all month except Monday the 13th.
    const days: DayRecord[] = [];
    for (let d = 1; d <= 30; d++) {
      const date = `2027-09-${String(d).padStart(2, '0')}`;
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
      if (weekday !== 0 && weekday !== 6 && date !== '2027-09-13') days.push(day(date));
    }
    const b = basisOf(summed, days);
    expect(b.state).toBe('partial');
    expect(b.unlogged).toEqual(['2027-09-13']);
    // The slip pays no more hours than were logged: the day wasn't paid, nothing is missing.
    expect(periodBasis(summed, days, DEFAULT_SETTINGS, '2027-09-01', '2027-09-30', '2027-11-01', 168).state).toBe('full');
    expect(periodBasis(summed, days, DEFAULT_SETTINGS, '2027-09-01', '2027-09-30', '2027-11-01', 152).state).toBe('partial');
  });
});
