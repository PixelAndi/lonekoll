import { describe, expect, it } from 'vitest';
import { easterSunday, specialDay } from './holidays.ts';
import { addDays, isoWeekday, localToUtc, monthEnd, stockholmOffset, utcToLocal, weekStart } from './time.ts';

describe('Swedish time', () => {
  it('switches to standard time at 01:00 UTC on the last Sunday of October', () => {
    expect(stockholmOffset(Date.UTC(2026, 9, 25, 0, 59))).toBe(120);
    expect(stockholmOffset(Date.UTC(2026, 9, 25, 1, 0))).toBe(60);
    expect(stockholmOffset(Date.UTC(2026, 2, 29, 1, 0))).toBe(120);
  });

  it('converts wall time both ways', () => {
    const t = localToUtc('2026-10-28', '18:30');
    expect(new Date(t).toISOString()).toBe('2026-10-28T17:30:00.000Z');
    expect(utcToLocal(t)).toEqual({ date: '2026-10-28', minute: 18 * 60 + 30 });
  });

  it('gives a night shift over the October change its real length', () => {
    const start = localToUtc('2026-10-24', '22:00');
    const end = localToUtc('2026-10-25', '06:00');
    expect((end - start) / 3_600_000).toBe(9);
  });

  it('handles calendar helpers', () => {
    expect(isoWeekday('2026-10-29')).toBe(4);
    expect(weekStart('2026-10-29')).toBe('2026-10-26');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(monthEnd('2026-02-10')).toBe('2026-02-28');
  });
});

describe('special days', () => {
  it('computes Easter', () => {
    expect(easterSunday(2025)).toBe('2025-04-20');
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
  });

  it('knows the bakery holiday list and the Sunday-like eves', () => {
    expect(specialDay('2026-10-31')?.name).toBe('holiday.allSaints');
    expect(specialDay('2026-06-20')?.name).toBe('holiday.midsummerDay');
    expect(specialDay('2026-06-19')).toMatchObject({ kind: 'sunday', name: 'holiday.midsummerEve' });
    expect(specialDay('2026-05-14')?.name).toBe('holiday.ascension');
    expect(specialDay('2026-12-24')?.kind).toBe('holiday');
    expect(specialDay('2026-12-31')?.kind).toBe('sunday');
    expect(specialDay('2026-10-30')).toBeUndefined();
  });
});
