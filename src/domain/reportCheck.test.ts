import { describe, expect, it } from 'vitest';
import { calculatePeriod } from './calc.ts';
import { comparePeriod } from './compare.ts';
import { DEFAULT_SETTINGS, type DayRecord, type Settings, type StampPair } from './model.ts';
import type { PaySlip, SlipLine } from './payslip.ts';
import { checkReport, rowCertainty, type CheckItem } from './reportCheck.ts';
import { addDays, isoWeekday } from './time.ts';

// December 2026, made up: Monday–Friday 06:00–14:30 with a 30-minute break (8 h).
const HOURLY = 180;
const settings: Settings = { ...DEFAULT_SETTINGS, wages: [{ from: '2026-01-01', hourly: HOURLY }], supplements: { ...DEFAULT_SETTINGS.supplements, ob: false } };
const START = '2026-12-01';
const END = '2026-12-31';
const TODAY = '2027-01-10';

const shift = (date: string, out = '14:30', extra: Partial<StampPair> = {}): DayRecord => ({
  date,
  rows: [{ in: '06:00', out: '10:00' }, { in: '10:30', out, ...extra }],
  photoIds: [],
  updatedAt: 0,
});
const workdays = (skip: string[] = []) => {
  const out: DayRecord[] = [];
  for (let d = START; d <= END; d = addDays(d, 1)) if (isoWeekday(d) <= 5 && !skip.includes(d)) out.push(shift(d));
  return out;
};
const line = (text: string, quantity: number, unitPrice: number, category: SlipLine['category']): SlipLine => ({
  code: '1',
  text,
  quantity,
  unit: 'tim',
  unitPrice,
  amount: Math.round(quantity * unitPrice * 100) / 100,
  category,
});
const slipOf = (lines: SlipLine[]): PaySlip => ({ periodStart: START, periodEnd: END, lines, gross: lines.reduce((s, l) => s + (l.amount ?? 0), 0), balances: {} });

function check(days: DayRecord[], slip: PaySlip, s = settings, others: { start: string; matched: boolean }[] = []) {
  const period = calculatePeriod(days, s, START, END);
  const comparison = comparePeriod(period, slip, days, s);
  return { period, comparison, result: checkReport({ slip, comparison, period, days, settings: s, start: START, end: END, today: TODAY, others }) };
}
const find = <C extends CheckItem['code']>(items: CheckItem[], code: C) => items.find((i) => i.code === code) as Extract<CheckItem, { code: C }> | undefined;

describe('checks before a report is saved', () => {
  // 23 weekdays, of which 24 and 25 December are holidays: 21 shifts of 8 h (168 h).
  const holidays = ['2026-12-24', '2026-12-25'];

  it('finds nothing to warn about when the data is complete and matches', () => {
    const days = workdays(holidays).concat(holidays.map((date) => ({ date, rows: [], absence: { type: 'holiday' as const, bookedStart: '06:00', bookedEnd: '14:30' }, photoIds: [], updatedAt: 0 })));
    const { period } = check(days, slipOf([]));
    const slip = slipOf([line('Timlön', 168, HOURLY, 'wage'), line('Helglön', period.totals.holidayPay!.hours, HOURLY, 'holidayPay')]);
    const { result } = check(days, slip, settings, [{ start: '2026-11-01', matched: true }]);
    expect(result.items).toEqual([{ code: 'settings-matched', months: ['2026-11-01'] }]);
    expect(result.warnings).toBe(false);
  });

  it('asks about working days with nothing logged, and holidays with no shift marked', () => {
    const days = workdays(['2026-12-07', ...holidays]);
    const { result } = check(days, slipOf([line('Timlön', 160, HOURLY, 'wage')]));
    expect(find(result.items, 'missing-days')?.dates).toEqual(['2026-12-07']);
    expect(find(result.items, 'holidays')?.dates).toEqual(holidays);
    expect(find(result.items, 'settings-never-matched')).toBeDefined();
    expect(result.warnings).toBe(true);
  });

  it('counts sick days as working days, so a missing weekday is still noticed', () => {
    // Wednesdays: 2 and 23 worked, 9 missing, 16 sick, 30 worked.
    const days = workdays(['2026-12-09', ...holidays]).map((d) =>
      d.date === '2026-12-16' ? { date: d.date, rows: [], absence: { type: 'sick' as const }, photoIds: [], updatedAt: 0 } : d,
    );
    const { result } = check(days, slipOf([line('Timlön', 152, HOURLY, 'wage')]));
    expect(find(result.items, 'missing-days')?.dates).toEqual(['2026-12-09']);
  });

  it('points out a wage that differs from the slip, and calls it a probable setting when most rows differ', () => {
    const days = workdays(holidays);
    const { result } = check(days, slipOf([line('Timlön', 168, 182, 'wage')]));
    expect(find(result.items, 'wage-rate')).toEqual({ code: 'wage-rate', slip: 182, settings: HOURLY });
    // One row, 1 % off: not a sign of a wrong setting.
    expect(result.suspect).toBe(false);
    const { result: big } = check(days, slipOf([line('Timlön', 168, 210, 'wage')]));
    expect(big.suspect).toBe(true);
    expect(find(big.items, 'settings-suspect')?.amount).toBe(168 * 30);
  });

  it('finds the overtime limit the slip fits', () => {
    // 10 h shifts (06:00–16:30): 2 h overtime a day after 8:00, 0.75 h after 9:15.
    const days = workdays(holidays).map((d) => shift(d.date, '16:30'));
    const slip = slipOf([line('Timlön', 210, HOURLY, 'wage'), line('Övertid 50 %', 21 * 0.75, 90, 'ot50')]);
    expect(find(check(days, slip).result.items, 'overtime-limit')).toEqual({ code: 'overtime-limit', limit: 480, match: 555 });
  });

  it('lists times the scanner was unsure of, times changed after scanning, and lines it can’t check', () => {
    const days = workdays(holidays);
    days[0] = shift(days[0].date, '14:30', { outDoubt: true });
    days[1] = shift(days[1].date, '14:30', { outRead: '14:50', outManual: true });
    const slip = slipOf([line('Timlön', 168, HOURLY, 'wage'), { code: '9', text: 'Retroaktiv lön', amount: 312, category: 'other' }]);
    const { result } = check(days, slip);
    expect(find(result.items, 'doubts')?.times).toEqual([{ date: '2026-12-01', field: 'out', time: '14:30' }]);
    expect(find(result.items, 'edited')?.times).toEqual([{ date: '2026-12-02', field: 'out', time: '14:30', read: '14:50' }]);
    expect(find(result.items, 'unread-lines')?.lines).toEqual([{ text: 'Retroaktiv lön', amount: 312 }]);
  });
});

describe('how sure each row is', () => {
  it('marks overtime without a schedule as depending on the local agreement', () => {
    const days = workdays().map((d) => shift(d.date, '16:30'));
    const { period, comparison } = check(days, slipOf([line('Timlön', 210, HOURLY, 'wage'), line('Övertid 50 %', 20, 90, 'ot50')]));
    const sure = (key: string) => rowCertainty(comparison.rows.find((r) => r.key === key)!, period, settings);
    expect(sure('wage')).toBe('sure');
    expect(sure('ot50')).toBe('local');
    expect(sure('gross')).toBeNull();
  });
});
