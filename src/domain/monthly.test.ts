import { describe, expect, it } from 'vitest';
import { calculatePeriod } from './calc.ts';
import { comparePeriod } from './compare.ts';
import type { PaySlip, SlipLine } from './payslip.ts';
import { DEFAULT_SETTINGS, hourlyRateOn, monthlyPayOn, type DayRecord, type Settings } from './model.ts';
import { addDays, isoWeekday } from './time.ts';

// Monthly salary under Bilaga F of Livsmedelsavtalet, with a made-up salary
// of 31 670 kr (182 kr/h × 174) for full-time work, in October 2026.

const MONTHLY = 31670;
const settings: Settings = {
  ...DEFAULT_SETTINGS,
  employedSince: '2023-03-01',
  wages: [{ from: '2026-01-01', basis: 'monthly', hourly: 0, monthly: MONTHLY }],
};

const day = (date: string, rows: [string, string][], extra: Partial<DayRecord> = {}): DayRecord => ({
  date,
  rows: rows.map(([i, o]) => ({ in: i, out: o })),
  photoIds: [],
  updatedAt: 0,
  ...extra,
});

/** Every weekday of October 05:00–13:30 with a 30-minute break, except the dates given. */
function october(except: string[] = [], longer: Record<string, string> = {}): DayRecord[] {
  const days: DayRecord[] = [];
  for (let d = '2026-10-01'; d <= '2026-10-31'; d = addDays(d, 1)) {
    if (isoWeekday(d) > 5 || except.includes(d)) continue;
    days.push(day(d, [['05:00', '09:00'], ['09:30', longer[d] ?? '13:30']]));
  }
  return days;
}

const period = (days: DayRecord[], s: Settings = settings) => calculatePeriod(days, s, '2026-10-01', '2026-10-31');

describe('monthly salary (Bilaga F)', () => {
  it('works out pay per hour and per day from the monthly salary (§1)', () => {
    const pay = monthlyPayOn(settings, '2026-10-15')!;
    // 31 670 × 12 / (52 × 40) and 31 670 × 12 / 365.
    expect(pay.perHour).toBe(182.71);
    expect(pay.perDay).toBe(1041.21);
    expect(hourlyRateOn(settings, '2026-10-15')).toBe(182.71);
    // Part time: 75 % of 40 hours a week, pay per hour on those hours.
    const partTime = { ...settings, employmentPercent: 75, wages: [{ ...settings.wages[0], monthly: 23752.5 }] };
    expect(monthlyPayOn(partTime, '2026-10-15')).toMatchObject({ weeklyHours: 30, perHour: 182.71 });
  });

  it('pays the salary for the month, not the hours, and OB on top', () => {
    const p = period(october());
    expect(p.totals.monthlySalary?.amount).toBe(MONTHLY);
    expect(p.totals.wage).toBeUndefined();
    expect(p.totals.ob1).toMatchObject({ hours: 22, amount: 1119.58 });
    expect(p.workedMinutes).toBe(22 * 8 * 60);
    expect(p.expectedGross).toBe(MONTHLY + 1119.58);
  });

  it('pays overtime hours in full: pay per hour plus the supplement (§3)', () => {
    // Two hours past 8 h on a Tuesday: +50 %.
    const p = period(october([], { '2026-10-06': '15:30' }));
    expect(p.totals.ot50).toMatchObject({ hours: 2, amount: 548.14, rates: [274.07] });
    // An extra Saturday, the sixth shift of the week: from 11:00 it is +100 %.
    const saturday = period([...october(), day('2026-10-24', [['06:00', '12:00']])]);
    expect(saturday.totals.ot50).toMatchObject({ hours: 2, rates: [274.07] });
    expect(saturday.totals.ot100).toMatchObject({ hours: 4, amount: 1461.68, rates: [365.42] });
  });

  it('pays no shift-form supplement (§4)', () => {
    expect(period(october(), { ...settings, shiftForm: 'two-shift' }).totals.shiftForm).toBeUndefined();
  });

  it('deducts sick hours and pays 80 % only past the first 20 % of a week (§5.1)', () => {
    const sick = day('2026-10-14', [], { absence: { type: 'sick', bookedStart: '05:00', bookedEnd: '13:30' } });
    const p = period([...october(['2026-10-14']), sick]);
    // 8.5 hours deducted at pay per hour; 8 of them (20 % of 40) unpaid, 0.5 at 80 %.
    expect(p.totals.sickDeduction).toMatchObject({ hours: 8.5, amount: -1553.04 });
    expect(p.totals.sickPay).toMatchObject({ hours: 0.5, amount: 73.08 });
    expect(p.totals.karens).toBeUndefined();
  });

  it('deducts every calendar day from day 15 at pay per day (§5.2)', () => {
    // Sick Thursday 1 October to Tuesday 20 October; the shifts that were booked are entered.
    const sickDays = [];
    for (let d = '2026-10-01'; d <= '2026-10-20'; d = addDays(d, 1)) {
      if (isoWeekday(d) <= 5) sickDays.push(day(d, [], { absence: { type: 'sick', bookedStart: '05:00', bookedEnd: '13:00' } }));
    }
    const p = period([...october(sickDays.map((d) => d.date)), ...sickDays]);
    // Days 1–14 (1–14 October): ten 8-hour weekdays per hour; day 15 on (15–20 October): six calendar days per day.
    expect(p.totals.sickDeduction?.hours).toBe(80);
    expect(p.totals.sickDeduction?.amount).toBe(-(80 * 182.71 + 6 * 1041.21));
    expect(p.totals.sickPay).toMatchObject({ hours: 72, amount: 10524.1 });
    expect(p.warnings.some((w) => w.code === 'sick-beyond-14')).toBe(true);
  });

  it('deducts vacation at 1/21.75 of the salary a day (§8)', () => {
    const vacation = ['2026-10-19', '2026-10-20'].map((d) => day(d, [], { absence: { type: 'vacation' } }));
    const p = period([...october(['2026-10-19', '2026-10-20']), ...vacation]);
    expect(p.totals.vacationDeduction?.amount).toBe(-2912.18);
    expect(p.vacationDays).toBe(2);
  });

  it('deducts unpaid absence per hour up to five working days, then per calendar day (§11)', () => {
    const one = period([...october(['2026-10-07']), day('2026-10-07', [], { absence: { type: 'unpaid' } })]);
    // A normal day: a fifth of 40 hours.
    expect(one.totals.absenceDeduction).toMatchObject({ hours: 8, amount: -1461.68 });

    const long = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13'];
    const p = period([...october(long), ...long.map((d) => day(d, [], { absence: { type: 'unpaid' } }))]);
    // Seven working days: every calendar day 5–13 October, the weekend included.
    expect(p.totals.absenceDeduction?.amount).toBe(-round(9 * 1041.21));
  });

  it('pays for holidays and permission without deduction or extra pay (§6, §7)', () => {
    const permission = day('2026-10-08', [], { absence: { type: 'permission', hours: 8 } });
    const p = period([...october(['2026-10-08']), permission]);
    expect(p.totals.permission).toBeUndefined();
    expect(p.totals.holidayPay).toBeUndefined();
    expect(p.totals.monthlySalary?.amount).toBe(MONTHLY);
  });

  it('pays part of the month by day or by hour when the employment starts during it (§2)', () => {
    const late = { ...settings, employedSince: '2026-10-20' };
    // 20–31 October: 12 calendar days at pay per day.
    expect(period(october(), late).totals.monthlySalary?.amount).toBe(round(12 * 1041.21));
    // 28–31 October: four days, paid per hour worked (three 8-hour days).
    const veryLate = { ...settings, employedSince: '2026-10-28' };
    expect(period(october(), veryLate).totals.monthlySalary?.amount).toBe(round(24 * 182.71));
  });

  it('never deducts more than the salary (§11.3)', () => {
    const away: DayRecord[] = [];
    for (let d = '2026-09-28'; d <= '2026-11-06'; d = addDays(d, 1)) if (isoWeekday(d) <= 5) away.push(day(d, [], { absence: { type: 'unpaid' } }));
    const p = period(away);
    expect(p.totals.monthlySalary?.amount).toBe(MONTHLY);
    expect(p.totals.absenceDeduction?.amount).toBe(-MONTHLY);
    expect(p.expectedGross).toBe(0);
  });

  it('checks the salary against the minimum wage × 174 (§12)', () => {
    const low = { ...settings, wages: [{ ...settings.wages[0], monthly: 25000 }] };
    expect(period(october(), low).warnings.find((w) => w.code === 'below-minimum-wage-monthly')?.values).toEqual({
      monthly: 25000,
      minimum: round(176.83 * 174),
    });
    expect(period(october()).warnings.some((w) => w.code === 'below-minimum-wage-monthly')).toBe(false);
  });
});

describe('comparing a monthly pay slip', () => {
  const line = (code: string, text: string, amount: number, category: SlipLine['category'], quantity?: number, unitPrice?: number): SlipLine => ({
    code,
    text,
    amount,
    category,
    quantity,
    unit: quantity !== undefined ? 'tim' : undefined,
    unitPrice,
  });
  const sick = day('2026-10-14', [], { absence: { type: 'sick', bookedStart: '05:00', bookedEnd: '13:30' } });
  const days = [...october(['2026-10-14']), sick, day('2026-10-24', [['06:00', '12:00']])];
  const p = period(days);
  const slip = (lines: SlipLine[]): PaySlip => ({ lines, balances: {}, gross: round(lines.reduce((sum, l) => sum + (l.amount ?? 0), 0)) });
  const common = [
    line('1000', 'Månadslön', MONTHLY, 'monthlySalary'),
    line('1310', 'OB-tillägg vardag', 1068.69, 'ob1', 21, 50.89),
    line('1330', 'OB-tillägg lör/sön', 930.54, 'ob3', 6, 155.09),
  ];

  it('matches a correct slip, also when sick leave is shown as sick pay less a karensavdrag', () => {
    const correct = slip([
      ...common,
      line('1510', 'Övertid 50 %', 548.14, 'ot50', 2, 274.07),
      line('1520', 'Övertid 100 %', 1461.68, 'ot100', 4, 365.42),
      line('1700', 'Sjukavdrag', -1553.04, 'sickDeduction', 8.5, 182.71),
      line('1710', 'Sjuklön', 73.08, 'sickPay', 0.5, 146.17),
    ]);
    const c = comparePeriod(p, correct, days, settings);
    expect(c.rows.filter((r) => r.status !== 'ok').map((r) => r.key)).toEqual([]);
    expect(c.totalDifference).toBe(0);

    // The same sick leave the other way round: 80 % for all 8.5 hours, less a karensavdrag for 8 of them.
    const karensStyle = slip([
      ...correct.lines.filter((l) => l.category !== 'sickPay'),
      line('1710', 'Sjuklön', 1242.42, 'sickPay', 8.5, 146.17),
      line('1720', 'Karensavdrag', -1169.34, 'karens'),
    ]);
    const k = comparePeriod(p, karensStyle, days, settings);
    const sickRow = k.rows.find((r) => r.key === 'sickPay')!;
    expect(sickRow.status).toBe('ok');
    expect(sickRow.notes.map((n) => n.code)).toContain('sick-includes-karens');
    expect(k.rows.some((r) => r.key === 'karens')).toBe(false);
  });

  it('finds the extra Saturday paid with OB only', () => {
    const missing = slip([
      ...common,
      line('1700', 'Sjukavdrag', -1553.04, 'sickDeduction', 8.5, 182.71),
      line('1710', 'Sjuklön', 73.08, 'sickPay', 0.5, 146.17),
    ]);
    const c = comparePeriod(p, missing, days, settings);
    expect(c.rows.find((r) => r.key === 'ot50')?.status).toBe('missing');
    expect(c.rows.find((r) => r.key === 'ot100')?.status).toBe('missing');
    expect(c.totalDifference).toBe(-round(548.14 + 1461.68));
  });
});

function round(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
