import { describe, expect, it } from 'vitest';
import { calculatePeriod, calculateShifts } from './calc.ts';
import { DEFAULT_SETTINGS, type DayRecord, type Settings, type StampPair } from './model.ts';
import { buildShifts } from './shifts.ts';
import { addDays, isoWeekday } from './time.ts';

const HOURLY = 180;
const settings: Settings = { ...DEFAULT_SETTINGS, wages: [{ from: '2026-01-01', hourly: HOURLY }] };

const day = (date: string, rows: [string | null, string | null][], extra: Partial<DayRecord> = {}): DayRecord => ({
  date,
  rows: rows.map(([i, o]): StampPair => ({ in: i, out: o })),
  photoIds: [],
  updatedAt: 0,
  ...extra,
});

// An evening-shift week shaped like real clock photos (made-up times). On
// Wednesday the shift runs past midnight, so the clock shows an In without
// an Ut on Wednesday and an Ut without an In on Thursday.
const octoberWeek: DayRecord[] = [
  day('2026-10-25', []),
  day('2026-10-26', [['15:00', '18:30'], ['19:00', '23:30']]),
  day('2026-10-27', [['15:15', '17:45'], ['18:15', '23:45']]),
  day('2026-10-28', [['15:00', '18:00'], ['18:30', null]]),
  day('2026-10-29', [[null, '03:10']]),
];

describe('shifts', () => {
  it('joins a shift that crosses midnight and keeps breaks inside a shift', () => {
    const { shifts, issues } = buildShifts(octoberWeek);
    expect(issues).toEqual([]);
    expect(shifts.map((s) => [s.date, s.workedMinutes])).toEqual([
      ['2026-10-26', 480],
      ['2026-10-27', 480],
      ['2026-10-28', 700],
    ]);
    expect(shifts[2].dates).toEqual(['2026-10-28', '2026-10-29']);
  });

  it('reports stamps that cannot be paired', () => {
    const { issues } = buildShifts([day('2026-10-26', [['15:00', null]]), day('2026-10-27', [['14:00', '22:00']])]);
    expect(issues).toEqual([{ date: '2026-10-26', code: 'missing-out', time: '15:00' }]);
  });

  it('reads a hand-typed night shift on one row as ending the next day', () => {
    const { shifts } = buildShifts([day('2026-10-26', [['22:00', '06:00']])]);
    expect(shifts[0].workedMinutes).toBe(480);
  });
});

describe('October week', () => {
  const { results } = calculateShifts(octoberWeek, settings);

  it('counts OB per shift', () => {
    expect(results.map((r) => r.obMinutes[1])).toEqual([300, 330, 520]);
  });

  it('puts Wednesday past 9 h 15 min into overtime: 2 h at 50 %, the rest at 100 %', () => {
    expect(results.map((r) => [r.overtime50, r.overtime100])).toEqual([
      [0, 0],
      [0, 0],
      [120, 25],
    ]);
    expect(results[2].overtimeReason).toBe('long-shift');
    expect(results[2].warnings).toContain('no-break');
  });

  it('sums the period like a pay slip', () => {
    const p = calculatePeriod(octoberWeek, settings, '2026-10-01', '2026-10-31');
    expect(p.workedMinutes).toBe(1660);
    expect(p.totals.wage).toMatchObject({ hours: 27.67, amount: 4980.6 });
    expect(p.totals.ob1).toMatchObject({ hours: 19.17, amount: 975.56, rates: [50.89] });
    expect(p.totals.ot50).toMatchObject({ hours: 2, amount: 180, rates: [90] });
    expect(p.totals.ot100).toMatchObject({ hours: 0.42, amount: 75.6 });
  });
});

describe('OB levels', () => {
  const ob = (date: string, from: string, to: string) => {
    const { results } = calculateShifts([day(date, [[from, to]])], settings);
    return results[0].obMinutes;
  };

  it('pays Friday evening at level 2 and Saturday daytime at level 3', () => {
    expect(ob('2026-10-30', '16:00', '23:00')).toEqual({ 1: 0, 2: 300, 3: 0, 4: 0 });
    expect(ob('2026-10-24', '05:00', '09:00')).toEqual({ 1: 0, 2: 60, 3: 180, 4: 0 });
  });

  it('pays All Saints (Saturday 31 October 2026) at the holiday rate', () => {
    expect(ob('2026-10-31', '08:00', '16:00')).toEqual({ 1: 0, 2: 0, 3: 0, 4: 480 });
  });

  it('pays New Year’s Eve like a Sunday', () => {
    expect(ob('2026-12-31', '10:00', '14:00')).toEqual({ 1: 0, 2: 0, 3: 240, 4: 0 });
  });

  it('uses the 2025 rates before 1 April 2026', () => {
    const s: Settings = { ...settings, wages: [{ from: '2025-01-01', hourly: 180 }] };
    const p = calculatePeriod([day('2026-03-30', [['18:00', '22:00']])], s, '2026-03-01', '2026-03-31');
    expect(p.totals.ob1?.rates).toEqual([49.46]);
  });
});

describe('overtime', () => {
  it('pays holiday overtime at 100 % with Sunday OB instead of holiday OB', () => {
    const { results } = calculateShifts([day('2026-10-31', [['08:00', '19:00']])], settings);
    const r = results[0];
    expect([r.overtime50, r.overtime100]).toEqual([0, 105]);
    expect(r.obMinutes).toEqual({ 1: 0, 2: 0, 3: 105, 4: 555 });
  });

  it('treats a sixth shift in a week as overtime', () => {
    const week = [0, 1, 2, 3, 4, 5].map((i) => day(addDays('2026-10-05', i), [['06:00', '10:00']]));
    const { results } = calculateShifts(week, settings);
    expect(results[5].overtimeReason).toBe('extra-shift');
    expect(results[5].overtime50 + results[5].overtime100).toBe(240);
    expect(results[4].overtimeReason).toBeNull();
  });
});

describe('sick pay', () => {
  // Four weeks of Mon–Thu evening shifts (8 h, 5 h OB each), then five sick days.
  const history: DayRecord[] = [];
  for (let d = '2026-08-31'; d <= '2026-09-23'; d = addDays(d, 1)) {
    if (isoWeekday(d) <= 4) history.push(day(d, [['15:00', '19:00'], ['19:30', '23:30']]));
  }
  const sickDays = ['2026-09-24', '2026-09-25', '2026-09-28', '2026-09-29', '2026-09-30'].map((d) =>
    day(d, [], { absence: { type: 'sick' } }),
  );

  it('pays 80 % of the average shift including OB, minus a waiting-day deduction', () => {
    const p = calculatePeriod([...history, ...sickDays], settings, '2026-09-01', '2026-09-30');
    const perShift = 8 * HOURLY + 5 * 50.89;
    expect(p.sick?.days).toHaveLength(5);
    expect(p.sick?.weeksUsed).toBe(4);
    expect(p.sick?.sickPay).toBeCloseTo(5 * 0.8 * perShift, 1);
    // 15 shifts over 4 weeks → average week; deduction is 20 % of a week's sick pay.
    expect(p.sick?.waitingDeduction).toBeCloseTo(0.2 * 0.8 * ((15 * perShift) / 4), 1);
    expect(p.totals.karens?.amount).toBeLessThan(0);
  });

  it('uses the booked shift when there is one', () => {
    const booked = day('2026-09-24', [], { absence: { type: 'sick', bookedStart: '14:00', bookedEnd: '22:00' } });
    const p = calculatePeriod([...history, booked], settings, '2026-09-01', '2026-09-30');
    expect(p.sick?.days[0]).toMatchObject({ basis: 'booked', lostMinutes: 480 });
    expect(p.sick?.days[0].lostPay).toBeCloseTo(8 * HOURLY + 4 * 50.89, 1);
  });
});

describe('minimum wage', () => {
  it('warns when the hourly wage is below the agreement minimum', () => {
    const s: Settings = { ...settings, wages: [{ from: '2025-01-01', hourly: 175 }], employedSince: '2024-01-01', birthDate: '1995-05-05' };
    const p = calculatePeriod([], s, '2026-09-01', '2026-09-30');
    expect(p.warnings).toContainEqual({ code: 'below-minimum-wage', date: '2026-09-01', values: { rate: 175, minimum: 176.83 } });
    const ok = calculatePeriod([], { ...s, wages: [{ from: '2025-01-01', hourly: HOURLY }] }, '2026-09-01', '2026-09-30');
    expect(ok.warnings).toEqual([]);
  });
});
