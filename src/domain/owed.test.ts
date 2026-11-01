import { describe, expect, it } from 'vitest';
import type { AgreementFinding } from './agreementCheck.ts';
import { findingKey, owedEstimate } from './owed.ts';
import type { PaySlip } from './payslip.ts';

// Made-up findings, slips and differences.
const finding = (byMonth: Record<string, number>): AgreementFinding => {
  const months = Object.keys(byMonth).sort();
  return {
    rule: 'minimum',
    cause: 'oneYear',
    months,
    byMonth,
    from: months[0],
    paid: 150,
    due: 156,
    hours: 100,
    amount: Object.values(byMonth).reduce((a, b) => a + b, 0),
    estimate: false,
  };
};
const slip = (month: string, gross: number, tax: number, payDate?: string): PaySlip => ({
  periodStart: `${month}-01`,
  gross,
  tax,
  payDate,
  lines: [],
  balances: {},
});
const today = '2030-06-15';

describe('the owed estimate', () => {
  const slips = [slip('2028-01', 20000, 5000, '2028-02-25'), slip('2029-03', 20000, 6000), slip('2029-04', 20000, 6000), slip('2030-01', 20000, 6000)];
  const f = finding({ '2028-01-01': 400, '2029-03-01': 600 });

  it('keeps the agreement’s findings and the comparison’s differences apart, a month counted once', () => {
    const owed = owedEstimate(
      [f],
      [
        { month: '2029-03-01', difference: -900 }, // the finding's month: already counted
        { month: '2029-04-01', difference: -500 },
        { month: '2030-01-01', difference: -40 }, // rounding
        { month: '2028-01-01', difference: 300 }, // the slip pays more
      ],
      slips,
      [],
      today,
    );
    expect(owed.likelyTotal).toBe(1000);
    expect(owed.investigate.map((i) => i.months)).toEqual([['2029-04-01']]);
    expect(owed.investigateTotal).toBe(500);
  });

  it('gives a rough net from each slip’s own tax share, and the part older than two years', () => {
    const owed = owedEstimate([f], [], slips, [], today);
    expect(owed.likelyNet).toBe(400 * 0.75 + 600 * 0.7);
    expect(owed.old).toBe(400);
  });

  it('sets aside what is marked as settled', () => {
    const owed = owedEstimate([f], [{ month: '2029-04-01', difference: -500 }], slips, [findingKey(f)], today);
    expect(owed.likely).toEqual([]);
    expect(owed.settled.map((i) => i.key)).toEqual([findingKey(f)]);
    expect(owed.investigateTotal).toBe(500);
  });
});
