import { describe, expect, it } from 'vitest';
import { calculatePeriod } from './calc.ts';
import { DEFAULT_SETTINGS, type DayRecord, type Settings } from './model.ts';
import { nightWork, workedPastMidnight } from './night.ts';
import { addDays } from './time.ts';

// Made-up shifts in 2027.
const day = (date: string, inTime: string, out: string): DayRecord => ({ date, rows: [{ in: inTime, out }], photoIds: [] }) as unknown as DayRecord;
const run = (from: string, n: number, inTime: string, out: string) => Array.from({ length: n }, (_, i) => day(addDays(from, i), inTime, out));

describe('permanent night work in the stamps', () => {
  it('is found when most shifts have three hours between 00 and 05, from the first night of the stretch', () => {
    const days = [...run('2027-03-01', 10, '06:00', '14:00'), ...run('2027-03-15', 10, '22:00', '06:00')];
    expect(nightWork(days)).toEqual({ from: '2027-03-15', shifts: 10, nights: 10 });
  });

  it('isn’t found for day work, too few nights, or a stretch of nights that has ended', () => {
    expect(nightWork(run('2027-03-01', 20, '06:00', '14:00'))).toBeNull();
    // 02:30–06:00 is only two and a half hours before 05:00.
    expect(nightWork(run('2027-03-01', 20, '02:30', '10:30'))).toBeNull();
    expect(nightWork(run('2027-03-01', 5, '22:00', '06:00'))).toBeNull();
    expect(nightWork([...run('2027-03-01', 10, '22:00', '06:00'), ...run('2027-03-15', 10, '06:00', '14:00')])).toBeNull();
  });
});

describe('skiftformstillägg from a date', () => {
  it('is calculated only for shifts from that date', () => {
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      wages: [{ from: '2027-01-01', basis: 'fixed', hourly: 200 }],
      shiftForm: 'two-shift',
      shiftFormFrom: '2027-03-15',
    };
    const days = [day('2027-03-10', '08:00', '12:00'), day('2027-03-16', '08:00', '12:00')];
    const period = calculatePeriod(days, settings, '2027-03-01', '2027-03-31');
    expect(period.totals.shiftForm?.hours).toBe(4);
  });
});

describe('shifts past midnight', () => {
  it('are found when a shift ended on the next day', () => {
    expect(workedPastMidnight(run('2027-03-01', 3, '06:00', '14:00'))).toBe(false);
    expect(workedPastMidnight([...run('2027-03-01', 3, '06:00', '14:00'), day('2027-03-05', '18:00', '00:30')])).toBe(true);
  });
});
