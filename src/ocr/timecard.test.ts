import { describe, expect, it } from 'vitest';
import type { OcrWord } from './parse.ts';
import { asTime, checkDay, cleanTimecard, noteInk, parseTimecard, workedHours, type TimecardDay } from './timecard.ts';

// A made-up timecard as the OCR reads it: words with their boxes, on a page
// 1500 px wide, slightly tilted (rows rise 1 px per 100 px across).
const W = 1500;
const word = (text: string, x: number, y: number): OcrWord => ({ text, confidence: 90, bbox: { x0: x, y0: y - 8 + x / 100, x1: x + text.length * 12, y1: y + 8 + x / 100 } });
const header: OcrWord[] = [
  word('Fr', 1200, 300),
  word('o', 1230, 300),
  word('m:', 1250, 300),
  word('2026-09-01', 1300, 300),
  word('T', 1210, 340),
  word('o', 1230, 340),
  word('m:', 1250, 340),
  word('2026-09-30', 1300, 340),
  word('In', 475, 380),
  word('Ut', 710, 380),
  word('Arb', 990, 380),
  word('Ord', 1110, 380),
  word('Frånvaro', 1255, 380),
];
let y = 430;
/** One day: date, weekday, schedule, and its stamp pairs (In, Avr In, Ut, Avr Ut), Arb Tid and Ord Tim. */
function row(date: string, weekday: string, pairs: [string, string][], arb?: string, notes: [string, number][] = []): OcrWord[] {
  const out = [word(date, 115, y), word(weekday, 245, y), word('08:00-08:00', 315, y)];
  pairs.forEach(([a, b], i) => {
    const ry = y + i * 25;
    out.push(word(a, 467, ry), word(a, 530, ry), word('In', 603, ry), word(b, 704, ry), word(b, 767, ry), word('Ut', 838, ry));
  });
  if (arb) out.push(word(arb, 994, y), word(`0${arb.replace(',', '.')}`, 1113, y));
  out.push(...notes.map(([text, x]) => word(text, x, y)));
  y += 25 * Math.max(1, pairs.length);
  return out;
}

const words = [
  ...header,
  ...row('2026-09-01', 'Tis', [['06:58', '11:30'], ['12:00', '15:31']], '8,05'),
  // The OCR missed the date of the 2nd but read the weekday.
  ...row('', 'Ons', [['07:02', '11:31'], ['12:01', '15:30']], '7,97'),
  ...row('2026-09-03', 'Tor', []),
  // Read as 2026-09-03 again: the weekday (Fre) puts it right.
  ...row('2026-09-03', 'Fre', [['06:59', '11:00'], ['11:30', '15:29']], '8,00'),
  ...row('2026-09-05', 'Lör', [], undefined, [['Sjuk', 1265]]),
  word('Totaler', 750, 900),
  word('Ledig', 1240, 960),
];

describe('reading a printed timecard', () => {
  const page = parseTimecard(
    words.filter((w) => w.text),
    W,
  );

  it('finds the period, every day in order, and its stamps in the In and Ut columns', () => {
    expect([page.from, page.to]).toEqual(['2026-09-01', '2026-09-30']);
    expect(page.days.map((d) => d.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05']);
    expect(page.days[0].pairs).toEqual([
      { in: '06:58', out: '11:30' },
      { in: '12:00', out: '15:31' },
    ]);
    expect(page.days[0].worked).toBe(8.05);
    expect(page.days[0].ordinary).toBe(8.05);
  });

  it('reads notes in the Frånvaro column, and stops at the totals', () => {
    expect(page.days[4].note).toBe('Sjuk');
    expect(page.days.some((d) => d.note?.includes('Ledig'))).toBe(false);
  });

  it('checks each day against Arb Tid', () => {
    expect(page.days.map((d) => checkDay(d).status)).toEqual(['ok', 'ok', 'empty', 'ok', 'empty']);
  });
});

describe('checking a day against the card’s own total', () => {
  const day = (pairs: TimecardDay['pairs'], rounded: TimecardDay['rounded'], worked?: number): TimecardDay => ({ date: '2026-09-01', pairs, rounded, worked, top: 0, bottom: 0 });

  it('takes a time from the other reading when that makes the day add up', () => {
    const c = checkDay(day([{ in: '06:10', out: '10:40' }, { in: '11:10', out: '03:25' }], [{ in: '06:10', out: '10:40' }, { in: '11:10', out: '15:25' }], 8.75));
    expect(c).toMatchObject({ status: 'fixed', corrected: ['1:out'], pairs: [{ in: '06:10', out: '10:40' }, { in: '11:10', out: '15:25' }] });
  });

  it('corrects a common digit mix-up only when exactly one fits', () => {
    // 22:35 read as 02:35 in both readings.
    const c = checkDay(day([{ in: '13:05', out: '17:40' }, { in: '18:10', out: '02:35' }], [{ in: '13:05', out: '17:40' }, { in: '18:10', out: '02:35' }], 9));
    expect(c).toMatchObject({ status: 'fixed', pairs: [{ in: '13:05', out: '17:40' }, { in: '18:10', out: '22:35' }] });
  });

  it('works out a time missing in both readings from the total', () => {
    const c = checkDay(day([{ in: null, out: '17:40' }, { in: '18:10', out: '22:05' }], [{ in: null, out: '17:40' }, { in: '18:10', out: '22:05' }], 8.5));
    expect(c).toMatchObject({ status: 'fixed', corrected: ['0:in'], pairs: [{ in: '13:05', out: '17:40' }, { in: '18:10', out: '22:05' }] });
  });

  it('asks the user when it can’t be checked', () => {
    expect(checkDay(day([{ in: '13:00', out: '16:45' }, { in: '17:15', out: '01:10' }], [{ in: null, out: null }, { in: null, out: null }])).status).toBe('check');
  });

  it('reads times however the OCR wrote them', () => {
    expect(['06:35', '06.35', '0635', '13:05.', '“06:41', '17:63', '12:5'].map(asTime)).toEqual(['06:35', '06:35', '06:35', '13:05', '06:41', null, null]);
    expect(workedHours([{ in: '22:00', out: '06:00' }])).toBe(8);
  });
});

describe('notes written by hand', () => {
  it('finds ink in a day’s Frånvaro box once the table lines are gone', () => {
    // A white page with table lines, and a scribble in one row's notes box.
    const w = 400;
    const h = 200;
    const data = new Uint8Array(w * h).fill(250);
    for (let x = 0; x < w; x++) for (const ly of [40, 80, 120]) data[ly * w + x] = 20;
    for (let yy = 0; yy < h; yy++) data[yy * w + 300] = 20;
    for (let i = 0; i < 60; i++) {
      const sx = 310 + i;
      const sy = Math.round(60 + 8 * Math.sin(i / 4));
      for (let d = 0; d < 3; d++) data[(sy + d) * w + sx] = 30;
    }
    const clean = cleanTimecard({ width: w, height: h, data });
    const ink = noteInk(clean, { notesFrom: 302, days: [
      { date: 'a', pairs: [], rounded: [], top: 42, bottom: 78 },
      { date: 'b', pairs: [], rounded: [], top: 82, bottom: 118 },
    ] });
    expect(ink.get('a')!).toBeGreaterThan(0.02);
    expect(ink.get('b')).toBe(0);
  });
});
