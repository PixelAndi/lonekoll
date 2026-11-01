import { describe, expect, it } from 'vitest';
import { calculatePeriod } from './calc.ts';
import { comparePeriod } from './compare.ts';
import { DEFAULT_SETTINGS, type DayRecord, type Settings } from './model.ts';
import type { PaySlip, SlipLine } from './payslip.ts';
import { QUOTES, reportPoints } from './reportPoints.ts';
import { cite } from './sources.ts';

// Made-up October 2026: 06:00–10:00 and 10:30–14:30 Monday to Friday, longer on some days, and a Saturday.
const HOURLY = 180;
const settings: Settings = { ...DEFAULT_SETTINGS, wages: [{ from: '2026-01-01', hourly: HOURLY }] };
const day = (date: string, rows: [string, string][], photo = false): DayRecord => ({
  date,
  rows: rows.map(([i, o]) => ({ in: i, out: o })),
  photoIds: photo ? ['p1'] : [],
  updatedAt: 0,
});
const days = [
  day('2026-10-05', [['06:00', '10:00'], ['10:30', '14:30']]),
  day('2026-10-06', [['06:00', '10:00'], ['10:30', '16:00']], true),
  day('2026-10-07', [['06:00', '10:00'], ['10:30', '17:30']]),
  day('2026-10-10', [['06:00', '12:00']]),
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
function points(lines: SlipLine[], s = settings) {
  const period = calculatePeriod(days, s, '2026-10-01', '2026-10-31');
  const slip: PaySlip = { periodStart: '2026-10-01', periodEnd: '2026-10-31', lines, gross: lines.reduce((t, l) => t + (l.amount ?? 0), 0), balances: {} };
  return { period, points: reportPoints(comparePeriod(period, slip, days, s), period, days, s) };
}

describe('the report’s points', () => {
  // Expected: 4 + 4 = 8 h on the 5th, 1.5 h overtime on the 6th, 3 h on the 7th (2 h +50 %, 1 h +100 %), Saturday 6 h OB level 3.
  const fair = [line('Timlön', 34.5, HOURLY, 'wage'), line('OB lör', 6, 155.09, 'ob3')];

  it('asks whether a local agreement explains missing overtime, with the days and the rule behind it', () => {
    const { points: p } = points([...fair, line('Övertid 50 %', 2, 90, 'ot50')]);
    expect(p).toHaveLength(1);
    const ot = p[0];
    expect(ot).toMatchObject({ n: 1, kind: 'question', reason: 'local-overtime', columns: ['ot50', 'ot100'] });
    // 1.5 h +50 % and 1 h +100 % are missing: 1.5 × 90 + 1 × 180.
    expect(ot.lines).toEqual([
      { key: 'ot50', hours: 1.5, rate: 90, amount: 135 },
      { key: 'ot100', hours: 1, rate: 180, amount: 180 },
    ]);
    expect(ot.amount).toBe(315);
    expect(ot.days.map((d) => [d.date, d.minutes, d.photo])).toEqual([
      ['2026-10-06', [90, 0], true],
      ['2026-10-07', [120, 60], false],
    ]);
    // A Wednesday: the +100 % comes from the two-hour rule, so the Sunday and holiday windows aren't quoted.
    expect(ot.quotes.map((q) => `${q.source} ${q.section}`)).toEqual(['agreement 3.3', 'bakery 4']);
  });

  it('asks for a correction when a certain row is short, with the OB rate from the table', () => {
    const { points: p } = points([line('Timlön', 34.5, HOURLY, 'wage'), line('Övertid 50 %', 3.5, 90, 'ot50'), line('Övertid 100 %', 1, 180, 'ot100')]);
    const ob = p.find((x) => x.keys.includes('ob3'))!;
    expect(ob).toMatchObject({ kind: 'claim', amount: 930.54, columns: ['ob3'], obRates: [{ level: 3, rate: 155.09 }] });
    expect(ob.lines).toEqual([{ key: 'ob3', hours: 6, rate: 155.09, amount: 930.54 }]);
    expect(ob.days.map((d) => d.date)).toEqual(['2026-10-10']);
  });

  it('asks what it is when the slip pays more', () => {
    const { points: p } = points([line('Timlön', 40, HOURLY, 'wage'), line('OB lör', 6, 155.09, 'ob3'), line('Övertid 50 %', 3.5, 90, 'ot50'), line('Övertid 100 %', 1, 180, 'ot100')]);
    expect(p.map((x) => [x.keys, x.kind, x.reason, x.amount])).toEqual([[['wage'], 'question', 'slip-more', -990]]);
  });

  it('quotes only sections the links can open', () => {
    for (const q of QUOTES) expect(cite(q.source, q.section).href).toMatch(/#page=\d+$/);
  });
});

describe('the agreement’s minimum wage', () => {
  // A made-up slip paying 170 kr/h for 100 h in September 2026, below the 176.83 kr/h minimum
  // (adults with a year's employment, from 1 April 2026).
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    birthDate: '1990-01-01',
    employedSince: '2020-01-01',
    // The settings copied the slip's wage: the agreement is a floor all the same.
    wages: [{ from: '2020-01-01', basis: 'fixed', hourly: 170 }],
  };
  const days: DayRecord[] = Array.from({ length: 10 }, (_, i) => ({
    date: `2026-09-${String(i + 1).padStart(2, '0')}`,
    rows: [{ in: '06:00', out: '16:00' }],
    photoIds: [],
    updatedAt: 0,
  })).filter((d) => ![6, 7].includes(new Date(`${d.date}T12:00:00Z`).getUTCDay() || 7));
  const hours = days.length * 10;
  const slip: PaySlip = {
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    lines: [{ code: '010', text: 'Timlön', quantity: hours, unit: 'tim', unitPrice: 170, amount: hours * 170, category: 'wage' }],
  } as PaySlip;
  const plain: Settings = { ...settings, ordinaryShiftMinutes: 600, supplements: { ...settings.supplements, ob: false, overtime: false } };
  const period = calculatePeriod(days, plain, '2026-09-01', '2026-09-30');
  const comparison = comparePeriod(period, slip, days, plain);

  it('flags a wage below the minimum, whatever the settings say', () => {
    const wage = comparison.rows.find((r) => r.key === 'wage')!;
    expect(wage.status).toBe('diff');
    expect(wage.notes.find((n) => n.code === 'wage-below-minimum')?.values).toMatchObject({ slip: 170, minimum: 176.83, hours, short: Math.round(6.83 * hours * 100) / 100 });
  });

  it('makes it a point to take up: hours × what each is short, the minimum quoted', () => {
    const point = reportPoints(comparison, period, days, plain).find((p) => p.keys.includes('wage'))!;
    expect(point.kind).toBe('claim');
    expect(point.lines[0]).toMatchObject({ hours, rate: 6.83 });
    expect(point.quotes.map((q) => q.text)).toContain('Minimilön för vuxna arbetstagare som har ett års anställning efter fyllda 18 år 176,83 kronor per timme fr.o.m. 1 april 2026');
  });

  it('asks rather than claims without the birth date (the app then assumes an adult)', () => {
    const noAge = { ...plain, birthDate: undefined };
    const p = reportPoints(comparePeriod(calculatePeriod(days, noAge, '2026-09-01', '2026-09-30'), slip, days, noAge), period, days, noAge).find((x) => x.keys.includes('wage'))!;
    expect([p.kind, p.reason]).toEqual(['question', 'minimum-age']);
  });
});

describe('the report’s points with days missing from the log', () => {
  it('asks whether missing days explain a difference instead of claiming it', () => {
    const period = calculatePeriod(days, settings, '2026-10-01', '2026-10-31');
    const lines = [line('Timlön', 40, HOURLY, 'wage')];
    const slip: PaySlip = { periodStart: '2026-10-01', periodEnd: '2026-10-31', lines, gross: lines[0].amount, balances: {} };
    const comparison = comparePeriod(period, slip, days, settings);
    const claimed = reportPoints(comparison, period, days, settings).find((p) => p.keys.includes('wage'))!;
    const asked = reportPoints(comparison, period, days, settings, true).find((p) => p.keys.includes('wage'))!;
    expect(claimed.reason).not.toBe('missing-data');
    expect(asked).toMatchObject({ kind: 'question', reason: 'missing-data', amount: claimed.amount });
  });

  it('keeps a claim where the slip pays less than the log: missing days can’t explain that', () => {
    const period = calculatePeriod(days, settings, '2026-10-01', '2026-10-31');
    const lines = [line('Timlön', 30, HOURLY, 'wage')];
    const slip: PaySlip = { periodStart: '2026-10-01', periodEnd: '2026-10-31', lines, gross: lines[0].amount, balances: {} };
    const point = reportPoints(comparePeriod(period, slip, days, settings), period, days, settings, true).find((p) => p.keys.includes('wage'))!;
    expect(point.reason).not.toBe('missing-data');
  });
});

describe('the report’s points when the wage isn’t confirmed', () => {
  it('asks which wage is the deal instead of claiming the difference', () => {
    const period = calculatePeriod(days, settings, '2026-10-01', '2026-10-31');
    // The slip pays a little less per hour than the settings, on the hours logged.
    const hours = period.totals.wage?.hours ?? 0;
    const lines = [line('Timlön', hours, HOURLY - 1, 'wage')];
    const slip: PaySlip = { periodStart: '2026-10-01', periodEnd: '2026-10-31', lines, gross: lines[0].amount, balances: {} };
    const comparison = comparePeriod(period, slip, days, settings);
    const claimed = reportPoints(comparison, period, days, settings).find((p) => p.keys.includes('wage'))!;
    const asked = reportPoints(comparison, period, days, settings, false, true).find((p) => p.keys.includes('wage'))!;
    expect(claimed.kind).toBe('claim');
    expect(asked).toMatchObject({ kind: 'question', reason: 'wage-agreement', amount: claimed.amount });
  });
});
