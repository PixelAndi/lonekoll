import { describe, expect, it } from 'vitest';
import { checkMonths } from './missing.ts';
import { DEFAULT_SETTINGS, type DayRecord, type Settings } from './model.ts';

const day = (date: string, absence = false): DayRecord =>
  ({ date, rows: absence ? [] : [{ in: '07:00', out: '15:00' }], absence: absence ? { type: 'sick' } : undefined, photoIds: [] }) as unknown as DayRecord;
const settings: Settings = { ...DEFAULT_SETTINGS, wages: [{ from: '2026-01-01', hourly: 180 } as Settings['wages'][number]] };

describe('what is missing since the start of the employment', () => {
  it('flags a month with no days, and a pay slip once it is surely out', () => {
    const c = checkMonths('2026-01-15', '2026-04-20', [day('2026-01-20'), day('2026-03-02')], [{ from: '2026-01-01', to: '2026-01-31' }], settings);
    expect(c.map((m) => [m.month, m.days, m.missing])).toEqual([
      ['2026-01', 1, []],
      ['2026-02', 0, ['noDays', 'noSlip']],
      // March's slip isn't surely out yet (paid in April).
      ['2026-03', 1, []],
      // The current month: nothing flagged for it yet.
      ['2026-04', 0, []],
    ]);
    expect(c[3].current).toBe(true);
  });

  it('lists planned days without stamps or an absence, from the start date to yesterday, holidays left out', () => {
    // A schedule of Monday–Friday 07–15; started Wednesday 31 Dec 2025, today Monday 5 Jan 2026.
    const shift = { start: '07:00', end: '15:00', breakMinutes: 30 };
    const scheduled: Settings = {
      ...settings,
      wages: [{ from: '2025-12-01', hourly: 180 } as Settings['wages'][number]],
      scheduleMode: 'fixed',
      schedule: { startMonday: '2025-12-29', weeks: [[shift, shift, shift, shift, shift, null, null]] },
    };
    const c = checkMonths('2025-12-31', '2026-01-05', [day('2026-01-02', true)], [], scheduled);
    // 31 Dec planned and empty; 1 Jan a holiday; 2 Jan sick (an absence counts); 5 Jan is today.
    expect(c.map((m) => [m.month, m.planned])).toEqual([
      ['2025-12', ['2025-12-31']],
      ['2026-01', []],
    ]);
  });

  it('flags dates before the first wage', () => {
    const c = checkMonths('2025-11-01', '2026-02-10', [day('2025-11-03'), day('2025-12-03'), day('2026-01-05')], [], settings);
    expect(c.filter((m) => m.missing.includes('noWage')).map((m) => m.month)).toEqual(['2025-11', '2025-12']);
  });
});
