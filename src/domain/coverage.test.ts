import { describe, expect, it } from 'vitest';
import { monthCoverage } from './coverage.ts';
import type { DayRecord } from './model.ts';

const day = (date: string): DayRecord => ({ date, rows: [{ in: '07:00', out: '15:00' }], photoIds: [] }) as unknown as DayRecord;

describe('which months have days', () => {
  it('lists every month from the first to now, with the gaps between', () => {
    const c = monthCoverage([day('2021-11-02'), day('2021-11-03'), day('2022-02-01')], ['2021-12'], '2022-04-10');
    expect(c.map((m) => [m.month, m.days, m.status, m.slip])).toEqual([
      ['2021-11', 2, 'ok', false],
      ['2021-12', 0, 'gap', true],
      ['2022-01', 0, 'gap', false],
      ['2022-02', 1, 'ok', false],
      ['2022-03', 0, 'after', false],
      ['2022-04', 0, 'after', false],
    ]);
  });
  it('is empty with nothing logged', () => {
    expect(monthCoverage([], [], '2022-04-10')).toEqual([]);
  });
  it('goes over the turn of the year', () => {
    expect(monthCoverage([day('2021-12-30'), day('2022-01-02')], [], '2022-01-05').map((m) => m.month)).toEqual(['2021-12', '2022-01']);
  });
});
