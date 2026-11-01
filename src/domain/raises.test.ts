import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from './model.ts';
import type { PaySlip, SlipLine } from './payslip.ts';
import { applyPaidSupplement, applyPaidWage, paidWages, wageChanges } from './raises.ts';

// Made-up slips: an hourly wage of 190 kr/h, raised to 196 from April 2026.
const line = (unitPrice: number, extra: Partial<SlipLine> = {}): SlipLine => ({ code: '010', text: 'Timlön', quantity: 100, unit: 'tim', unitPrice, amount: unitPrice * 100, category: 'wage', ...extra });
const slip = (month: string, lines: SlipLine[]): PaySlip => ({ periodStart: `${month}-01`, periodEnd: `${month}-28`, lines }) as PaySlip;
const slips = [slip('2026-02', [line(190)]), slip('2026-03', [line(190)]), slip('2026-04', [line(196)]), slip('2026-05', [line(196), line(6, { text: 'Retro lön' })])];
const settings: Settings = { ...DEFAULT_SETTINGS, wages: [{ from: '2026-01-01', basis: 'fixed', hourly: 190 }] };

describe('the wage as paid, from the pay slips', () => {
  it('finds when it changed, retroactive pay left out but noted', () => {
    expect(paidWages(slips).map((p) => [p.from, p.to, p.amount, p.slips.length, p.retro, p.hours])).toEqual([
      ['2026-02-01', '2026-03-28', 190, 2, false, 200],
      ['2026-04-01', '2026-05-28', 196, 2, true, 200],
    ]);
  });

  it('suggests the raise the settings don’t have, and nothing once they do', () => {
    const changes = wageChanges(paidWages(slips), settings);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: 'differs', settings: 190, paid: { from: '2026-04-01', amount: 196 } });
    const updated = applyPaidWage(settings, changes[0].paid);
    expect(updated.wages.map((w) => [w.from, w.hourly])).toEqual([
      ['2026-01-01', 190],
      ['2026-04-01', 196],
    ]);
    expect(wageChanges(paidWages(slips), updated)).toEqual([]);
  });

  it('takes a raise in the middle of a period from the wage lines’ own dates', () => {
    const mid = slip('2026-04', [line(190, { from: '2026-04-01', to: '2026-04-14' }), line(196, { from: '2026-04-15', to: '2026-04-28' })]);
    expect(paidWages([mid]).map((p) => [p.from, p.amount])).toEqual([
      ['2026-04-01', 190],
      ['2026-04-15', 196],
    ]);
  });

  it('tells a wage below the agreement’s minimum apart: something to take up, not to copy', () => {
    const low = wageChanges(paidWages([slip('2026-05', [line(120)])]), settings);
    expect(low[0].kind).toBe('belowMinimum');
  });

  it('finds a monthly salary and its raise', () => {
    const m = (month: string, amount: number) => slip(month, [{ code: '001', text: 'Månadslön', amount, category: 'monthlySalary' } as SlipLine]);
    expect(paidWages([m('2026-03', 31000), m('2026-04', 31800)]).map((p) => [p.basis, p.from, p.amount])).toEqual([
      ['monthly', '2026-03-01', 31000],
      ['monthly', '2026-04-01', 31800],
    ]);
  });

  it('takes a wage of “the minimum plus a supplement” apart: how much above the minimum the slip pays', () => {
    // A made-up deal: the minimum plus 1 740 kr a month (10 kr/h over 174 h); the slip pays the minimum + 9 kr/h.
    const deal: Settings = {
      ...DEFAULT_SETTINGS,
      employedSince: '2020-01-01',
      birthDate: '1990-01-01',
      wages: [{ from: '2020-01-01', basis: 'minimum', hourly: 0, supplement: 1740, supplementPer: 'month' }],
    };
    const changes = wageChanges(paidWages([slip('2026-09', [line(176.83 + 9)])]), deal);
    expect(changes).toHaveLength(1);
    const c = changes[0];
    if (c.kind !== 'differs') throw new Error('expected a difference');
    expect(c.breakdown).toEqual({ minimum: 176.83, paidSupplement: 9, setSupplement: 10, paidPerMonth: 1566, setPerMonth: 1740, perHour: -1, onHours: -100 });
    // Taking the slip's supplement keeps the wage tied to the minimum (a new minimum still raises it).
    const updated = applyPaidSupplement(deal, c.paid, c.breakdown!);
    expect(updated.wages.at(-1)).toMatchObject({ from: '2026-09-01', basis: 'minimum', supplement: 9, supplementPer: 'hour' });
    expect(wageChanges(paidWages([slip('2026-09', [line(176.83 + 9)])]), updated)).toEqual([]);
  });
});
