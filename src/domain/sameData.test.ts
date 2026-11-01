import { describe, expect, it } from 'vitest';
import type { StampPair } from './model.ts';
import type { PaySlip, SlipLine } from './payslip.ts';
import { lineKey, mergeSlip, mergeStamps, sameSlipData, sameStamps, slipDiff, stampDiff } from './sameData.ts';

// Made-up stamps and slips.
const row = (a: string | null, b: string | null): StampPair => ({ in: a, out: b });

describe('a day scanned again', () => {
  it('the same stamps: nothing to do', () => {
    expect(sameStamps(stampDiff([row('06:00', '14:00')], [row('06:00', '14:00')]))).toBe(true);
  });

  it('names what the new reading adds and what it lacks', () => {
    const d = stampDiff([row('06:00', null), row('18:00', '19:00')], [row('06:00', '14:00')]);
    expect(d.added.map((s) => s.key)).toEqual(['out@14:00']);
    expect(d.missing.map((s) => s.key)).toEqual(['in@18:00', 'out@19:00']);
  });

  it('adds a new stamp beside its partner, removes only what is chosen', () => {
    const saved = [row('06:00', null), row('18:00', '19:00')];
    const d = stampDiff(saved, [row('06:00', '14:00')]);
    expect(mergeStamps(saved, d, new Set(['out@14:00']), new Set())).toEqual([row('06:00', '14:00'), row('18:00', '19:00')]);
    expect(mergeStamps(saved, d, new Set(['out@14:00']), new Set(['in@18:00', 'out@19:00']))).toEqual([row('06:00', '14:00')]);
    expect(mergeStamps(saved, d, new Set(), new Set())).toEqual(saved);
  });

  it('a new pair of its own is added as a row', () => {
    const saved = [row('06:00', '10:00')];
    const d = stampDiff(saved, [row('06:00', '10:00'), row('10:30', '14:00')]);
    expect(mergeStamps(saved, d, new Set(['in@10:30', 'out@14:00']), new Set())).toEqual([row('06:00', '10:00'), row('10:30', '14:00')]);
  });
});

const line = (text: string, amount: number): SlipLine => ({ code: '1', text, quantity: 1, unit: 'st', unitPrice: amount, amount, category: 'other' });
const slip = (lines: SlipLine[], extra: Partial<PaySlip> = {}): PaySlip => ({ periodStart: '2027-03-01', payDate: '2027-04-23', lines, balances: {}, ...extra });

describe('a pay slip read again', () => {
  const a = line('Timlön', 1000);
  const b = line('OB 1', 200);
  const c = line('Sjuklön', 300);

  it('the same lines and figures: a copy', () => {
    expect(sameSlipData(slipDiff(slip([a, b], { gross: 1200 }), slip([b, a], { gross: 1200 })))).toBe(true);
  });

  it('names new lines, missing lines and figures read otherwise; merges only what is chosen', () => {
    const saved = slip([a, b], { gross: 1200 });
    const read = slip([a, c], { gross: 1300, tax: 300 });
    const d = slipDiff(saved, read);
    expect(d.added).toEqual([c]);
    expect(d.missing).toEqual([b]);
    expect(d.fields.map((f) => [f.key, f.saved, f.read])).toEqual([
      ['gross', 1200, 1300],
      ['tax', undefined, 300],
    ]);
    const merged = mergeSlip(saved, d, new Set([lineKey(c)]), new Set(), new Set(['tax']), read);
    expect(merged.lines).toEqual([a, b, c]);
    expect([merged.gross, merged.tax]).toEqual([1200, 300]);
    expect(mergeSlip(saved, d, new Set(), new Set([lineKey(b)]), new Set(), read).lines).toEqual([a]);
  });
});
