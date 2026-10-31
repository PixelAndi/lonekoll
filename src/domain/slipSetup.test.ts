import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type DayRecord, type Settings } from './model.ts';
import type { PaySlip, SlipLine } from './payslip.ts';
import { apply, suggestFromSlip } from './slipSetup.ts';

// Made-up September 2026: two long shifts and one ordinary one.
const days: DayRecord[] = [
  { date: '2026-09-07', rows: [{ in: '06:00', out: '10:00' }, { in: '10:30', out: '14:30' }], photoIds: [], updatedAt: 0 },
  { date: '2026-09-08', rows: [{ in: '06:00', out: '10:00' }, { in: '10:30', out: '16:00' }], photoIds: [], updatedAt: 0 },
  { date: '2026-09-09', rows: [{ in: '06:00', out: '10:00' }, { in: '10:30', out: '16:00' }], photoIds: [], updatedAt: 0 },
];
const line = (text: string, quantity: number, unitPrice: number, category: SlipLine['category']): SlipLine => ({
  code: '1',
  text,
  quantity,
  unit: 'tim',
  unitPrice,
  amount: Math.round(quantity * unitPrice * 100) / 100,
  category,
});
// 27 h worked; with overtime after 9:15 that is 0.25 h a long day.
const slip: PaySlip = {
  employer: 'Exempelbageriet AB',
  periodStart: '2026-09-01',
  periodEnd: '2026-09-30',
  lines: [line('Timlön', 27, 182, 'wage'), line('Övertid 50 %', 0.5, 91, 'ot50')],
  gross: 27 * 182 + 45.5,
  taxTable: 33,
  balances: {},
};
const fresh: Settings = { ...DEFAULT_SETTINGS, supplements: { ...DEFAULT_SETTINGS.supplements, ob: false } };

describe('settings from a pay slip', () => {
  it('suggests the wage, the overtime limit the slip fits, the tax table and the employer – and then the slip matches', () => {
    const setup = suggestFromSlip(slip, days, fresh, '2026-09-01', '2026-09-30');
    expect(setup.suggestions).toEqual([
      { code: 'hourly', hourly: 182, line: 'Timlön' },
      { code: 'overtime-limit', minutes: 555, hours: 0.5 },
      { code: 'tax-table', table: 33 },
      { code: 'employer', employer: 'Exempelbageriet AB' },
    ]);
    expect(Math.abs(setup.remaining ?? 99)).toBeLessThanOrEqual(1);
  });

  it('suggests nothing the settings already have', () => {
    const set = apply(fresh, suggestFromSlip(slip, days, fresh, '2026-09-01', '2026-09-30').suggestions, '2026-09-01');
    expect(suggestFromSlip(slip, days, set, '2026-09-01', '2026-09-30').suggestions).toEqual([]);
  });

  it('adds a new wage from the slip’s period and keeps the earlier one', () => {
    const before: Settings = { ...fresh, wages: [{ from: '2025-04-01', hourly: 175 }] };
    const after = apply(before, [{ code: 'hourly', hourly: 182, line: '' }], '2026-09-01');
    expect(after.wages).toEqual([
      { from: '2025-04-01', hourly: 175 },
      { from: '2026-09-01', basis: 'fixed', hourly: 182 },
    ]);
  });
});
