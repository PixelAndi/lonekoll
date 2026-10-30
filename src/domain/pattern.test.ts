import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type DayRecord } from './model.ts';
import { suggestWorkPattern } from './pattern.ts';
import { addDays } from './time.ts';

const day = (date: string, rows: [string, string][]): DayRecord => ({ date, rows: rows.map(([i, o]) => ({ in: i, out: o })), photoIds: [], updatedAt: 0 });

/** Four weeks from Monday 2026-09-28, Monday–Friday, a steady start and an end that follows the production. */
function weeks(start = ['05:55', '06:02', '05:58', '06:04', '05:56']) {
  const ends = ['14:25', '16:45', '18:10', '15:05', '17:30', '14:50', '16:15'];
  const days: DayRecord[] = [];
  for (let w = 0; w < 4; w++) {
    for (let d = 0; d < 5; d++) {
      const date = addDays('2026-09-28', w * 7 + d);
      days.push(day(date, [[start[d], '10:00'], ['10:30', ends[(w * 5 + d) % ends.length]]]));
    }
  }
  return days;
}

describe('suggestWorkPattern', () => {
  it('finds the workdays and the start, and ends the ordinary shift by the shift length', () => {
    const p = suggestWorkPattern(weeks(), DEFAULT_SETTINGS, '2026-10-30')!;
    expect(p.days.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5]);
    expect(p.days.every((d) => d.start === '06:00' && d.breakMinutes === 30)).toBe(true);
    expect(p.steadyStart).toBe(true);
    expect(p.endsVary).toBe(true);
    expect(p.ordinaryStart).toBe('06:00');
    expect(p.week[0]).toEqual({ start: '06:00', end: '14:30', breakMinutes: 30 });
    expect(p.week[5]).toBeNull();
  });

  it('leaves out an odd extra day', () => {
    const p = suggestWorkPattern([...weeks(), day('2026-10-10', [['07:00', '12:00']])], DEFAULT_SETTINGS, '2026-10-30')!;
    expect(p.days.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5]);
  });

  it('works for a night start too', () => {
    const p = suggestWorkPattern(weeks(['00:55', '01:05', '00:58', '01:02', '01:04']), DEFAULT_SETTINGS, '2026-10-30')!;
    expect(p.days.every((d) => d.start === '01:00')).toBe(true);
    expect(p.ordinaryStart).toBe('01:00');
    expect(p.week[0]).toEqual({ start: '01:00', end: '09:30', breakMinutes: 30 });
  });

  it('says when the start moves around too much for a schedule', () => {
    const days = weeks().map((d, i) => (i % 2 ? { ...d, rows: [{ in: '09:00', out: '17:00' }] } : d));
    expect(suggestWorkPattern(days, DEFAULT_SETTINGS, '2026-10-30')?.steadyStart).toBe(false);
  });

  it('needs a couple of weeks of stamps', () => {
    expect(suggestWorkPattern(weeks().slice(0, 5), DEFAULT_SETTINGS, '2026-10-30')).toBeNull();
  });
});
