import { describe, expect, it } from 'vitest';
import type { AgreementFinding } from './agreementCheck.ts';
import { findingKey, owedEstimate, rejectionKey, type OwedAnswers } from './owed.ts';
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
const none: OwedAnswers = { resolutions: {}, rejected: [] };

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
      none,
      today,
    );
    expect(owed.likelyTotal).toBe(1000);
    expect(owed.investigate.map((i) => i.months)).toEqual([['2029-04-01']]);
    expect(owed.investigateTotal).toBe(500);
  });

  it('gives a rough net from each slip’s own tax share, and the part older than two years', () => {
    const owed = owedEstimate([f], [], slips, none, today);
    expect(owed.likelyNet).toBe(400 * 0.75 + 600 * 0.7);
    expect(owed.old).toBe(400);
  });

  it('sets aside what is marked as settled', () => {
    const owed = owedEstimate([f], [{ month: '2029-04-01', difference: -500 }], slips, { ...none, settled: [findingKey(f)] }, today);
    expect(owed.likely).toEqual([]);
    expect(owed.settled.map((i) => i.key)).toEqual([findingKey(f)]);
    expect(owed.investigateTotal).toBe(500);
  });
});

describe('a later line that may have put it right', () => {
  const slips = [slip('2029-03', 20000, 6000), slip('2029-04', 20000, 6000), slip('2029-06', 20000, 6000)];
  const line = { month: '2029-06-01', text: 'Övrig ersättning', amount: 1500 };
  const a = { ...finding({ '2029-03-01': 1000 }), corrections: [line] };
  const b = { ...finding({ '2029-04-01': 800 }), cause: 'revision' as const, corrections: [line] };

  it('is suggested, not subtracted', () => {
    const owed = owedEstimate([a], [], slips, none, today);
    expect(owed.likelyTotal).toBe(1000);
    expect(owed.likely[0].suggestions).toEqual([line]);
  });

  it('linked, covers the item as far as its amount goes – one line for two items, oldest first', () => {
    const answers: OwedAnswers = {
      resolutions: {
        [findingKey(a)]: { kind: 'linked', date: today, line },
        [findingKey(b)]: { kind: 'linked', date: today, line },
      },
      rejected: [],
    };
    const owed = owedEstimate([a, b], [], slips, answers, today);
    // a is covered in full (1000 of 1500); b gets the 500 left and stays open with 300.
    expect(owed.settled.map((i) => [i.key, i.covered])).toEqual([[findingKey(a), 1000]]);
    expect(owed.likely.map((i) => [i.key, i.covered, i.amount])).toEqual([[findingKey(b), 500, 300]]);
    expect(owed.likelyTotal).toBe(300);
    // The line is used up: suggested nowhere else.
    expect(owed.likely[0].suggestions).toEqual([]);
  });

  it('said not to be it, is suggested no more; an item said to be no error is set aside', () => {
    const owed = owedEstimate([a, b], [], slips, { resolutions: { [findingKey(b)]: { kind: 'notError', date: today } }, rejected: [rejectionKey(findingKey(a), line)] }, today);
    expect(owed.likely.map((i) => [i.key, i.suggestions.length])).toEqual([[findingKey(a), 0]]);
    expect(owed.settled[0].resolution?.kind).toBe('notError');
  });
});

describe('an archived item', () => {
  it('is out of the totals and the lists, kept apart', () => {
    const slips = [slip('2028-01', 20000, 5000, '2028-02-25')];
    const f = finding({ '2028-01-01': 400 });
    const owed = owedEstimate([f], [], slips, { resolutions: { [findingKey(f)]: { kind: 'archived', date: today } }, rejected: [] }, today);
    expect([owed.likely, owed.settled, owed.likelyTotal, owed.old]).toEqual([[], [], 0, 0]);
    expect(owed.archived.map((i) => i.key)).toEqual([findingKey(f)]);
  });
});
