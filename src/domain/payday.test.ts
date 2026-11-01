import { describe, expect, it } from 'vitest';
import { isBankingDay, payDateFor, withPayDay } from './payday.ts';
import type { PaySlip } from './payslip.ts';

describe('the pay day', () => {
  it('is the 25th of the month after the period on a weekday', () => {
    expect(payDateFor('2027-09', 25)).toBe('2027-10-25');
    expect(payDateFor('2027-12', 25)).toBe('2028-01-25');
  });

  it('moves back to the banking day before a weekend', () => {
    expect(payDateFor('2027-08', 25)).toBe('2027-09-24');
  });

  it('moves back past holidays and the eves banks are closed on', () => {
    // 25 December 2027 is a Saturday and the 24th julafton.
    expect(payDateFor('2027-11', 25)).toBe('2027-12-23');
    // 25 June 2027 is midsommarafton.
    expect(payDateFor('2027-05', 25)).toBe('2027-06-24');
    expect(isBankingDay('2027-06-25')).toBe(false);
    expect(isBankingDay('2027-12-31')).toBe(false);
  });

  it('stays in the month when it has fewer days', () => {
    expect(payDateFor('2028-01', 31)).toBe('2028-02-29');
  });

  it('is given to a slip whose pay day couldn’t be read, and marked', () => {
    const slip: PaySlip = { periodStart: '2027-09-01', periodEnd: '2027-09-30', lines: [], balances: {} };
    expect(withPayDay(slip, 25)).toMatchObject({ payDate: '2027-10-25', payDateFrom: 'setting' });
    expect(withPayDay({ ...slip, payDate: '2027-10-28' }, 25).payDate).toBe('2027-10-28');
    expect(withPayDay(slip, null)).toBe(slip);
  });
});
