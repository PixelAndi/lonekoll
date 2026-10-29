import { describe, expect, it } from 'vitest';
import type { PeriodResult } from './calc.ts';
import { comparePeriod } from './compare.ts';
import { DEFAULT_SETTINGS, type DayRecord, type Settings } from './model.ts';
import type { PaySlip, SlipLine } from './payslip.ts';

const settings: Settings = { ...DEFAULT_SETTINGS, wages: [{ from: '2026-01-01', hourly: 180 }] };

const line = (category: SlipLine['category'], quantity: number | undefined, unit: string | undefined, unitPrice?: number, amount?: number, from?: string): SlipLine => ({
  code: '0000',
  text: category,
  category,
  quantity,
  unit,
  unitPrice,
  amount,
  from,
  to: from,
});

// A slip shaped like the September one (made-up numbers, hourly 180 kr).
const slip: PaySlip = {
  periodStart: '2026-09-01',
  periodEnd: '2026-09-30',
  gross: 31275.8,
  balances: {},
  lines: [
    line('wage', 120.5, 'Timmar', 180, 21690),
    line('vacationDays', 2, 'Dagar'),
    line('vacationPay', 2, 'Dagar', 2000, 4000),
    line('karens', 8, 'Timmar', -144, -1152),
    line('sickHours', 40, 'Timmar'),
    line('sickPay', 40, 'Timmar', 144, 5760),
    line('ob1', 20, 'Timmar', 50.89, 1017.8),
    line('timebankHours', 2, 'Timmar', undefined, undefined, '2026-09-11'),
    line('wage', -2, 'Timmar', 180, -360, '2026-09-11'),
    line('timebankPay', 2, 'Timmar', 160, 320, '2026-09-11'),
  ],
};

const period = {
  start: '2026-09-01',
  end: '2026-09-30',
  shifts: [{ obMinutes: { 1: 300, 2: 0, 3: 0, 4: 0 } }],
  issues: [],
  buckets: [],
  totals: {
    wage: { hours: 120.5, amount: 21690, rates: [180] },
    ob1: { hours: 25, amount: 1272.25, rates: [50.89] },
    sickPay: { hours: 40, amount: 6800, rates: [] },
    karens: { hours: 0, amount: -1300, rates: [] },
  },
  workedMinutes: 7230,
  sick: { days: [{ date: '2026-09-24', dayInSpell: 1, basis: 'average', lostMinutes: 480, lostPay: 1700, sickPay: 1360 }], sickPay: 6800, waitingDeduction: 1300, weeksUsed: 4, averageWeekPay: 8125 },
  vacationDays: 2,
  timebankHours: 2,
  warnings: [],
  expectedGross: 21690 + 1272.25 + 6800 - 1300,
} as unknown as PeriodResult;

const days: DayRecord[] = [
  { date: '2026-08-28', rows: [{ in: '14:00', out: '22:00' }], photoIds: [], updatedAt: 0 },
  { date: '2026-09-11', rows: [{ in: '14:00', out: '20:00' }], absence: { type: 'timebank', hours: 2 }, photoIds: [], updatedAt: 0 },
];

describe('comparePeriod', () => {
  const c = comparePeriod(period, slip, days, settings);
  const row = (key: string) => c.rows.find((r) => r.key === key)!;

  it('flags the wage deduction on the time-bank day', () => {
    expect(row('wage')).toMatchObject({ status: 'diff', diff: { hours: -2, amount: -360 } });
    expect(row('wage').notes).toEqual([{ code: 'wage-deductions', values: { hours: 2, amount: 360, date: '2026-09-11', absence: 'timebank' } }]);
  });

  it('flags OB hours that are missing', () => {
    expect(row('ob1')).toMatchObject({ status: 'diff', diff: { hours: -5, amount: -254.45 } });
  });

  it('marks sick pay based on averages as "check" and spots base-wage-only sick pay', () => {
    expect(row('sickPay').status).toBe('check');
    expect(row('sickPay').notes.map((n) => n.code)).toEqual(['sick-base-only', 'sick-estimate']);
    expect(row('karens')).toMatchObject({ status: 'check', diff: { amount: 148 } });
  });

  it('checks vacation days and the daily minimum, time-bank hours, and gross', () => {
    expect(row('vacationDays').status).toBe('ok');
    expect(row('vacationPay')).toMatchObject({ status: 'info', notes: [{ code: 'vacation-pay-unchecked', values: { minimum: 1789 } }] });
    expect(row('timebankHours').status).toBe('ok');
    expect(row('timebankPay')).toMatchObject({ status: 'info', notes: [{ code: 'timebank-rate-unknown', values: { price: 160 } }] });
    // Gross difference = sum of the row differences (wage −360, OB −254.45, sick −1040, karens +148).
    expect(c.totalDifference).toBeCloseTo(-360 - 254.45 - 1040 + 148, 2);
    expect(c.coverage).toEqual([]);
  });

  it('notes when the log starts after the period does', () => {
    const later = comparePeriod(period, slip, [days[1]], settings);
    expect(later.coverage).toEqual([{ code: 'log-starts-late', date: '2026-09-11' }]);
  });
});
