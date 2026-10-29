import { describe, expect, it } from 'vitest';
import { calculatePeriod, calculateShifts } from './calc.ts';
import { DEFAULT_SETTINGS, type DayRecord, type ScheduledShift, type Settings, type StampPair } from './model.ts';
import { rotationWeek, scheduledShift } from './schedule.ts';

const HOURLY = 180;
const DAY: ScheduledShift = { start: '06:00', end: '14:30', breakMinutes: 30 };
const scheduled: Settings = {
  ...DEFAULT_SETTINGS,
  wages: [{ from: '2026-01-01', hourly: HOURLY }],
  scheduleMode: 'fixed',
  schedule: { startMonday: '2026-10-05', weeks: [[DAY, DAY, DAY, DAY, DAY, null, null]] },
};

const day = (date: string, rows: [string | null, string | null][], extra: Partial<DayRecord> = {}): DayRecord => ({
  date,
  rows: rows.map(([i, o]): StampPair => ({ in: i, out: o })),
  photoIds: [],
  updatedAt: 0,
  ...extra,
});

describe('schedule lookup', () => {
  it('follows a rotation and per-day changes', () => {
    const rotating: Settings = { ...scheduled, schedule: { startMonday: '2026-10-05', weeks: [[DAY, null, null, null, null, null, null], [null, DAY, null, null, null, null, null]] } };
    expect(rotationWeek(rotating.schedule, '2026-10-12')).toBe(1);
    expect(rotationWeek(rotating.schedule, '2026-09-28')).toBe(1);
    expect(scheduledShift(rotating, '2026-10-19')).toEqual(DAY); // week 1 again, Monday
    expect(scheduledShift(rotating, '2026-10-13')).toEqual(DAY); // week 2, Tuesday
    expect(scheduledShift(scheduled, '2026-10-26', day('2026-10-26', [], { scheduleOverride: 'off' }))).toBeNull();
    expect(scheduledShift({ ...scheduled, scheduleMode: 'none' }, '2026-10-26')).toBeNull();
  });
});

describe('with a schedule', () => {
  it('counts overtime past the scheduled length, from a minimum if set', () => {
    const worked = [day('2026-10-26', [['05:50', '10:00'], ['10:30', '14:40']])]; // 8 h 20 min
    expect(calculateShifts(worked, scheduled).results[0]).toMatchObject({ overtime50: 20, overtimeReason: 'long-shift' });
    expect(calculateShifts(worked, { ...scheduled, minOvertimeMinutes: 30 }).results[0]).toMatchObject({ overtime50: 0, overtimeReason: null });
  });

  it('makes a shift on a day off overtime from the first minute', () => {
    const r = calculateShifts([day('2026-10-24', [['08:00', '12:00']])], scheduled).results[0];
    // Saturday: 2 h at 50 %, then 100 % (and from 11:00 the Sunday window).
    expect(r).toMatchObject({ overtime50: 120, overtime100: 120, overtimeReason: 'unscheduled' });
    expect(r.warnings).toContain('unscheduled-shift');
    expect(r.obMinutes[3]).toBe(240);
  });

  it('pays förskjuten tid for a moved shift, and hints when it might be one', () => {
    const moved = day('2026-10-27', [['04:00', '08:00'], ['08:30', '12:30']], { shiftMoved: true });
    const p = calculatePeriod([moved], scheduled, '2026-10-01', '2026-10-31');
    expect(p.totals.shiftedTime).toMatchObject({ hours: 2, rates: [37.07] });
    expect(p.totals.ot50).toBeUndefined();
    const unmarked = calculateShifts([{ ...moved, shiftMoved: false }], scheduled).results[0];
    expect(unmarked.warnings).toContain('possible-moved-shift');
    const off = calculatePeriod([moved], { ...scheduled, supplements: { ...scheduled.supplements, shiftedTime: false } }, '2026-10-01', '2026-10-31');
    expect(off.totals.shiftedTime).toBeUndefined();
  });

  it('pays holiday pay for scheduled holidays, and overtime if worked anyway', () => {
    const december = calculatePeriod([], scheduled, '2026-12-01', '2026-12-31');
    // Christmas Eve (Thu) and Christmas Day (Fri) are scheduled days: 8 h each.
    expect(december.holidays.map((h) => h.date)).toEqual(['2026-12-24', '2026-12-25']);
    expect(december.totals.holidayPay).toMatchObject({ hours: 16, amount: 16 * HOURLY });
    const worked = calculateShifts([day('2026-12-24', [['06:00', '10:00'], ['10:30', '14:30']])], scheduled).results[0];
    expect(worked).toMatchObject({ overtime100: 480, overtimeReason: 'holiday' });
    expect(worked.obMinutes).toEqual({ 1: 0, 2: 0, 3: 480, 4: 0 });
  });

  it('takes sick pay from the schedule and the waiting-day deduction from an average scheduled week', () => {
    const p = calculatePeriod([day('2026-10-28', [], { absence: { type: 'sick' } }), day('2026-10-31', [], { absence: { type: 'sick' } })], scheduled, '2026-10-01', '2026-10-31');
    expect(p.sick?.days.map((d) => [d.date, d.basis, d.lostMinutes])).toEqual([
      ['2026-10-28', 'schedule', 480],
      ['2026-10-31', 'not-scheduled', 0],
    ]);
    expect(p.sick?.sickPay).toBeCloseTo(0.8 * 8 * HOURLY, 2);
    // 20 % of an average week's sick pay (5 × 8 h) is more than one day's sick pay, so it takes all of it.
    expect(p.sick?.waitingDeduction).toBeCloseTo(0.8 * 8 * HOURLY, 2);
  });

  it('notes scheduled days without stamps', () => {
    const p = calculatePeriod([day('2026-10-26', [['06:00', '14:30']])], scheduled, '2026-10-26', '2026-10-30', { today: '2026-10-29' });
    expect(p.warnings.filter((w) => w.code === 'scheduled-no-stamps').map((w) => w.date)).toEqual(['2026-10-27', '2026-10-28']);
  });
});

describe('optional supplements', () => {
  const plain: Settings = { ...DEFAULT_SETTINGS, wages: [{ from: '2026-01-01', hourly: HOURLY }] };
  const evening = [day('2026-10-26', [['14:00', '18:00'], ['18:30', '00:30']])]; // 10 h, OB from 18:00

  it('pays the shift-form supplement on ordinary hours only', () => {
    const p = calculatePeriod(evening, { ...plain, shiftForm: 'two-shift' }, '2026-10-01', '2026-10-31');
    expect(p.totals.shiftForm).toMatchObject({ hours: 9.25, rates: [9.54] });
  });

  it('leaves out OB and overtime when they do not apply', () => {
    const p = calculatePeriod(evening, { ...plain, supplements: { ob: false, overtime: false, shiftedTime: true, holidayPay: true } }, '2026-10-01', '2026-10-31');
    expect(Object.keys(p.totals)).toEqual(['wage']);
  });

  it('checks the minimum wage against the base wage without a personal supplement', () => {
    const s: Settings = { ...plain, wages: [{ from: '2025-01-01', hourly: 185, supplement: 10 }], employedSince: '2024-01-01' };
    const p = calculatePeriod([], s, '2026-09-01', '2026-09-30');
    expect(p.warnings).toEqual([{ code: 'below-minimum-wage-base', date: '2026-09-01', values: { rate: 185, base: 175, supplement: 10, minimum: 176.83 } }]);
  });
});
