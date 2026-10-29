import { describe, expect, it } from 'vitest';
import { checkOrder, checkPlausible, parseDate, parseRows, readTimeToken, type OcrWord, type ReadRow } from './parse.ts';

const pairs = (rows: ReadRow[]) => rows.map((r) => ({ in: r.in, out: r.out }));

const word = (text: string, x: number, y: number, confidence = 90): OcrWord => ({
  text,
  confidence,
  bbox: { x0: x - 60, y0: y - 20, x1: x + 60, y1: y + 20 },
});

// Word centres as they come out of a 1000px wide crop of the stamp rows.
const W = 1000;

describe('readTimeToken', () => {
  it('reads clock times and the missing-stamp placeholder', () => {
    expect(readTimeToken('15:05')).toEqual({ kind: 'time', value: '15:05' });
    expect(readTimeToken('1505')).toEqual({ kind: 'time', value: '15:05' });
    expect(readTimeToken('1:55')).toEqual({ kind: 'time', value: '01:55' });
    expect(readTimeToken('xx:xx')).toEqual({ kind: 'missing' });
    expect(readTimeToken('XXXX')).toEqual({ kind: 'missing' });
  });

  it('rejects things that are not times', () => {
    expect(readTimeToken('11')).toBeNull();
    expect(readTimeToken('25:10')).toBeNull();
    expect(readTimeToken('12:61')).toBeNull();
  });
});

describe('parseDate', () => {
  it('finds the ISO date in the bar text', () => {
    expect(parseDate([word('2026-10-29', 500, 40)]).value).toBe('2026-10-29');
    expect(parseDate([word('7', 300, 40), word('2026-10-2', 480, 40), word('9', 600, 40)]).value).toBe('2026-10-29');
  });

  it('gives up on nonsense', () => {
    expect(parseDate([word('2026-13-45', 500, 40)]).value).toBeNull();
    expect(parseDate([]).value).toBeNull();
  });
});

describe('parseRows', () => {
  it('reads two pairs and ignores the schedule columns', () => {
    const words = [
      word('00:00', 0.18 * W, 70),
      word('00:00', 0.335 * W, 68),
      word('15:05', 0.475 * W, 66),
      word('17:20', 0.69 * W, 64),
      word('17:50', 0.475 * W, 150),
      word('23:10', 0.69 * W, 148),
    ];
    expect(pairs(parseRows(words, W).value)).toEqual([
      { in: '15:05', out: '17:20' },
      { in: '17:50', out: '23:10' },
    ]);
  });

  it('keeps a missing stamp as null (shift crossing midnight)', () => {
    const wed = [word('15:10', 0.48 * W, 60), word('18:00', 0.69 * W, 60), word('18:30', 0.48 * W, 140), word('xx:xx', 0.7 * W, 140)];
    expect(pairs(parseRows(wed, W).value)).toEqual([
      { in: '15:10', out: '18:00' },
      { in: '18:30', out: null },
    ]);
    const thu = [word('00:00', 0.18 * W, 60), word('xx:xx', 0.46 * W, 60), word('01:55', 0.685 * W, 60)];
    expect(pairs(parseRows(thu, W).value)).toEqual([{ in: null, out: '01:55' }]);
  });

  it('returns no rows for an empty day and reports the lowest confidence', () => {
    expect(parseRows([word('xx:xx', 0.47 * W, 60), word('xx:xx', 0.69 * W, 60)], W).value).toEqual([]);
    const read = parseRows([word('15:20', 0.47 * W, 60, 88), word('18:40', 0.69 * W, 60, 65)], W);
    expect(read.confidence).toBe(65);
    expect(read.value[0]).toMatchObject({ inConfidence: 88, outConfidence: 65 });
  });
});

describe('checkOrder / checkPlausible', () => {
  it('accepts increasing times and flags misreads', () => {
    expect(checkOrder([{ in: '15:05', out: '17:20' }, { in: '17:50', out: '23:10' }])).toBe(true);
    expect(checkOrder([{ in: '15:05', out: '07:20' }])).toBe(false);
  });

  it('flags a single row longer than the clock ever shows', () => {
    // "15:20" misread as "05:20": in order, but a 13 h 20 min row.
    expect(checkPlausible([{ in: '05:20', out: '18:40' }])).toBe(false);
    expect(checkPlausible([{ in: '15:20', out: '18:40' }, { in: '19:10', out: null }])).toBe(true);
  });
});

describe('vote', () => {
  it('outvotes a misread digit and flags the time for checking', async () => {
    const { vote } = await import('./pipeline.ts');
    const row = (i: string) => ({ date: '2026-10-26', rows: [{ in: i, out: '18:40' }, { in: '19:10', out: '23:25' }] });
    const result = vote([row('05:20'), row('15:20'), row('15:20')]);
    expect(result.rows[0]).toMatchObject({ in: '15:20', out: '18:40' });
    expect(result.rows[1].inUncertain).toBeUndefined();
    // Even outnumbered, an implausible 14-hour row loses to a sensible reading.
    const lone = vote([row('05:20'), row('05:20'), row('15:20')]);
    expect(lone.rows[0].in).toBe('15:20');
    expect(lone.date).toBe('2026-10-26');
  });

  it('flags disagreement', async () => {
    const { vote } = await import('./pipeline.ts');
    const r = (i: string) => ({ date: '2026-10-26', rows: [{ in: '19:10', out: i }] });
    const result = vote([r('23:25'), r('23:25'), r('23:26')]);
    expect(result.rows[0]).toMatchObject({ out: '23:25', outUncertain: true });
    expect(result.rows[0].inUncertain).toBeUndefined();
  });
});
