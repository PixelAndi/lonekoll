import { describe, expect, it } from 'vitest';
import { calculatePeriod } from './calc.ts';
import { comparePeriod } from './compare.ts';
import { classifyLine } from './payslip.ts';
import { DEFAULT_SETTINGS, type Settings } from './model.ts';
import type { PaySlip } from './payslip.ts';
import { earningYearForVacationOn, earningYearOf, vacationBasis, vacationPayPerDay } from './vacation.ts';

// Made-up pay slips, paid on the 25th each month.
const slip = (payDate: string, gross: number, vacationPay = 0): PaySlip => ({
  payDate,
  gross,
  lines: vacationPay ? [{ code: '300', text: 'Semesterlön', amount: vacationPay, category: 'vacationPay' }] : [],
  balances: {},
});
const settings: Settings = { ...DEFAULT_SETTINGS, employedSince: '2020-01-01' };
const months = ['2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03'];

describe('vacation pay', () => {
  it('knows the earning year, and which one vacation taken on a date is paid from', () => {
    expect(earningYearOf('2026-10-31', settings)).toEqual({ start: '2026-04-01', end: '2027-03-31' });
    expect(earningYearForVacationOn('2026-10-31', settings)).toEqual({ start: '2025-04-01', end: '2026-03-31' });
    expect(earningYearForVacationOn('2026-02-10', settings)).toEqual({ start: '2024-04-01', end: '2025-03-31' });
    const calendar = { ...settings, vacationYearStartMonth: 1 as const };
    expect(earningYearForVacationOn('2026-10-31', calendar)).toEqual({ start: '2025-01-01', end: '2025-12-31' });
  });

  it('counts the months that have their pay slip', () => {
    const year = earningYearForVacationOn('2026-10-31', settings);
    const some = vacationBasis([slip('2025-04-25', 30000), slip('2025-06-25', 30000), slip('2026-04-25', 30000)], settings, year);
    expect(some.months).toHaveLength(12);
    expect(some.covered).toBe(2);
    expect(some.complete).toBe(false);
    expect(some.months.filter((m) => !m.covered).map((m) => m.month)).toEqual(months.filter((m) => m !== '2025-04' && m !== '2025-06'));
  });

  it('works out 13.2 % of the year’s pay per earned day once the year is complete', () => {
    const year = earningYearForVacationOn('2026-10-31', settings);
    // 12 × 30 000 kr, of which one month includes 5 000 kr vacation pay that doesn't count.
    const slips = months.map((m) => slip(`${m}-25`, 30000));
    slips[3] = slip('2025-07-25', 35000, 5000);
    const basis = vacationBasis(slips, settings, year);
    expect(basis.complete).toBe(true);
    expect(basis.pay).toBe(360000);
    expect(basis.paidDays).toBe(25);
    expect(basis.perDay).toBe(1900.8);
    // Above the bakery minimum (1 789 kr from 1 April 2026).
    expect(basis.minimum).toBe(1789);
    expect(vacationPayPerDay(basis)).toBe(1900.8);
    // Low pay: the minimum applies instead.
    expect(vacationPayPerDay(vacationBasis(months.map((m) => slip(`${m}-25`, 20000)), settings, year))).toBe(1789);
  });

  it('gives fewer paid days for part of a year, rounded up', () => {
    const year = earningYearForVacationOn('2026-10-31', settings);
    const basis = vacationBasis([], { ...settings, employedSince: '2025-10-01' }, year);
    // 182 of 365 days: 25 × 182 / 365 = 12.47 → 13 days.
    expect(basis.paidDays).toBe(13);
  });
});

describe('vacation pay on a pay slip', () => {
  const year = earningYearForVacationOn('2026-10-31', settings);
  const october: PaySlip = {
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    payDate: '2026-11-25',
    gross: 9504,
    lines: [{ code: '300', text: 'Semesterlön', quantity: 5, unit: 'dagar', unitPrice: 1900.8, amount: 9504, category: 'vacationPay' }],
    balances: {},
  };
  const period = calculatePeriod([], settings, '2026-10-01', '2026-10-31');

  it('is checked once the earning year is complete', () => {
    const basis = vacationBasis(months.map((m) => slip(`${m}-25`, 30000)), settings, year);
    const c = comparePeriod(period, october, [], settings, undefined, basis);
    const row = c.rows.find((r) => r.key === 'vacationPay')!;
    expect(row).toMatchObject({ status: 'ok', expected: { amount: 9504, count: 5 } });
    expect(c.rows.find((r) => r.key === 'gross')?.status).toBe('ok');
    // 50 kr short a day is a difference.
    const short = { ...october, gross: 9254, lines: [{ ...october.lines[0], unitPrice: 1850.8, amount: 9254 }] };
    expect(comparePeriod(period, short, [], settings, undefined, basis).rows.find((r) => r.key === 'vacationPay')?.status).toBe('diff');
  });

  it('is only checked against the minimum until then', () => {
    const basis = vacationBasis([slip('2025-04-25', 30000)], settings, year);
    const row = comparePeriod(period, october, [], settings, undefined, basis).rows.find((r) => r.key === 'vacationPay')!;
    expect(row.status).toBe('info');
    expect(row.notes[0].code).toBe('vacation-pay-unchecked');
  });
});

describe('komp lines on a pay slip', () => {
  it('reads komp taken as komp pay, and komp overtime as overtime', () => {
    expect(classifyLine('Kompledighet uttag', 1440, 180)).toBe('kompPay');
    expect(classifyLine('Komptid saldo', undefined, undefined)).toBe('kompHours');
    expect(classifyLine('Övertid komp 50%', 90, 90)).toBe('ot50');
  });
});
