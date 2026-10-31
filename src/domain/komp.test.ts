import { describe, expect, it } from 'vitest';
import { calculatePeriod, kompBalance } from './calc.ts';
import { DEFAULT_SETTINGS, type DayRecord, type Settings } from './model.ts';

// Komptid (§4.3): overtime taken as paid time off instead of money. Made-up times.
const HOURLY = 180;
const settings: Settings = { ...DEFAULT_SETTINGS, wages: [{ from: '2026-01-01', hourly: HOURLY }], supplements: { ...DEFAULT_SETTINGS.supplements, ob: false } };

// Tuesday 06:00–17:00 with a 30-minute break: 10 h 30 min worked, 2 h 30 min past 8:00
// (2 h at +50 %, 30 min at +100 %).
const tuesday = (extra: Partial<DayRecord> = {}): DayRecord => ({
  date: '2026-10-13',
  rows: [
    { in: '06:00', out: '10:00' },
    { in: '10:30', out: '17:00' },
  ],
  photoIds: [],
  updatedAt: 0,
  ...extra,
});
const period = (days: DayRecord[], s = settings) => calculatePeriod(days, s, '2026-10-01', '2026-10-31');

describe('komptid', () => {
  it('pays overtime in money by default', () => {
    const p = period([tuesday()]);
    expect(p.totals.wage?.hours).toBe(10.5);
    expect(p.totals.ot50?.amount).toBe(180);
    expect(p.totals.ot100?.amount).toBe(90);
    expect(p.kompEarnedHours).toBe(0);
  });

  it('one hour off per overtime hour, the supplement still paid in money', () => {
    const p = period([tuesday({ overtimeAs: 'komp' })]);
    // The overtime hours themselves are not paid now…
    expect(p.totals.wage?.hours).toBe(8);
    expect(p.kompEarnedHours).toBe(2.5);
    // …but the supplement is.
    expect(p.totals.ot50?.amount).toBe(180);
    expect(p.totals.ot100?.amount).toBe(90);
    expect(p.expectedGross).toBe(8 * HOURLY + 270);
  });

  it('the supplement as time too: 1.5 or 2 hours off, nothing paid now', () => {
    const p = period([tuesday({ overtimeAs: 'komp' })], { ...settings, kompMode: 'supplement' });
    expect(p.totals.wage?.hours).toBe(8);
    expect(p.totals.ot50).toBeUndefined();
    expect(p.kompEarnedHours).toBe(2 * 1.5 + 0.5 * 2);
  });

  it('follows the usual choice in the settings, and a day can differ from it', () => {
    const usual = { ...settings, overtimeAs: 'komp' as const };
    expect(period([tuesday()], usual).kompEarnedHours).toBe(2.5);
    expect(period([tuesday({ overtimeAs: 'pay' })], usual).kompEarnedHours).toBe(0);
  });

  it('pays komp time taken at the hourly wage, and keeps a balance', () => {
    const off: DayRecord = { date: '2026-10-20', rows: [], absence: { type: 'komp', hours: 2 }, photoIds: [], updatedAt: 0 };
    const days = [tuesday({ overtimeAs: 'komp' }), off];
    const p = period(days);
    expect(p.totals.kompPay).toMatchObject({ hours: 2, amount: 2 * HOURLY });
    expect(p.kompTakenHours).toBe(2);
    expect(kompBalance(days, settings, '2026-10-31')).toEqual({ earned: 2.5, taken: 2, left: 0.5 });
    expect(kompBalance(days, settings, '2026-10-15')).toEqual({ earned: 2.5, taken: 0, left: 2.5 });
  });

  it('with a monthly salary, only the supplement is paid for komp overtime', () => {
    const monthly: Settings = { ...settings, wages: [{ from: '2026-01-01', basis: 'monthly', monthly: 31200, hourly: 0 }] };
    const pay = period([tuesday()], monthly);
    const komp = period([tuesday({ overtimeAs: 'komp' })], monthly);
    const perHour = (31200 * 12) / (52 * 40);
    expect(pay.totals.ot50?.rates[0]).toBeCloseTo(perHour * 1.5, 2);
    expect(komp.totals.ot50?.rates[0]).toBeCloseTo(perHour * 0.5, 2);
    expect(komp.kompEarnedHours).toBe(2.5);
  });
});
