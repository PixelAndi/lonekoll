import { describe, expect, it } from 'vitest';
import { checkRows, digitsLearned, EMPTY_MEMORY, learn, memoryReady, readTimeByGlyphs, SAMPLES_PER_DIGIT, timeGlyphs, type DigitMemory } from './glyphs.ts';
import type { GrayImage } from './image.ts';
import type { ReadRow, TimeBox } from './parse.ts';

// A 5 × 7 pixel font, drawn 4× bigger with light ink on a dark background (as the rows crops are).
const FONT: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
};
const S = 4;
const ADVANCE = 6 * S;

/** Times drawn one per line; returns the crop and each time's box with its characters. */
function draw(times: string[]): { crop: GrayImage; boxes: TimeBox[] } {
  const width = 10 + ADVANCE * 5 + 10;
  const height = times.length * 12 * S;
  const data = new Uint8Array(width * height).fill(20);
  const boxes = times.map((time, line) => {
    const top = line * 12 * S + 2 * S;
    const symbols = [...time].map((ch, i) => {
      const left = 10 + i * ADVANCE;
      FONT[ch].forEach((row, y) =>
        [...row].forEach((bit, x) => {
          if (bit !== '1') return;
          for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) data[(top + y * S + dy) * width + left + x * S + dx] = 230;
        }),
      );
      return { text: ch, bbox: { x0: left, y0: top, x1: left + 5 * S, y1: top + 7 * S } };
    });
    return { x0: 10, y0: top, x1: 10 + ADVANCE * 4 + 5 * S, y1: top + 7 * S, symbols };
  });
  return { crop: { width, height, data }, boxes };
}

/** Rows as the OCR would read them from a drawing of the times. */
function scan(pairs: [string, string][], read = pairs) {
  const { crop, boxes } = draw(pairs.flat());
  const rows: ReadRow[] = read.map(([a, b], i) => ({ in: a, out: b, inBox: boxes[i * 2], outBox: boxes[i * 2 + 1] }));
  return { crop, rows };
}

const teach = (memory: DigitMemory, pairs: [string, string][]) => {
  const s = scan(pairs);
  return learn(memory, s, pairs.map(([a, b]) => ({ in: a, out: b })));
};

describe('learning the clock’s digits', () => {
  it('cuts a time into its four digits', () => {
    const { crop, boxes } = draw(['13:50']);
    expect(timeGlyphs(crop, boxes[0])).toHaveLength(4);
    // Also by its gaps, without the OCR's character boxes.
    expect(timeGlyphs(crop, { ...boxes[0], symbols: undefined })).toHaveLength(4);
  });

  it('is not used before every digit has been seen', () => {
    const memory = teach(EMPTY_MEMORY, [['13:50', '15:31']]);
    expect(memoryReady(memory)).toBe(false);
    // 1, 3 and 5 are seen twice each in 13:50 and 15:31.
    expect(digitsLearned(memory)).toBe(3);
    const s = scan([['13:50', '15:31']]);
    expect(checkRows(s.rows, s.crop, memory)).toEqual({ verdict: 'unsure', doubts: [] });
  });

  it('reads times by itself once it has seen every digit twice, and checks the OCR with them', () => {
    let memory = EMPTY_MEMORY;
    for (let i = 0; i < 2; i++) memory = teach(memory, [['01:23', '04:56'], ['07:58', '09:59']]);
    expect(memoryReady(memory)).toBe(true);
    const right = scan([['16:05', '23:47']]);
    expect(readTimeByGlyphs(right.crop, right.rows[0].inBox!, memory)).toBe('16:05');
    expect(checkRows(right.rows, right.crop, memory)).toEqual({ verdict: 'agree', doubts: [] });
    // The OCR misread 23:47 as 23:41: the digits read it differently, so it is marked to double-check.
    const misread = scan([['16:05', '23:47']], [['16:05', '23:41']]);
    expect(checkRows(misread.rows, misread.crop, memory)).toEqual({ verdict: 'unsure', doubts: ['0:out'] });
  });

  it('learns from the values as saved, corrections included', () => {
    let memory = EMPTY_MEMORY;
    for (let i = 0; i < 2; i++) memory = teach(memory, [['01:23', '04:56'], ['07:58', '09:59']]);
    // Read as 18:41, corrected by the user to 18:47 before saving.
    const s = scan([['10:00', '18:47']], [['10:00', '18:41']]);
    const after = learn(memory, s, [{ in: '10:00', out: '18:47' }]);
    expect(after.samples.length).toBe(memory.samples.length + 8);
    expect(after.samples.filter((x) => x.label === '7').length).toBe(memory.samples.filter((x) => x.label === '7').length + 1);
    // Its own reading was checked against what was saved.
    expect(after.checked).toBe(memory.checked + 2);
    expect(after.correct).toBe(memory.correct + 2);
  });

  it('skips scans whose rows were added or removed before saving, and keeps the newest examples of each digit', () => {
    const s = scan([['10:00', '18:47']]);
    expect(learn(EMPTY_MEMORY, s, [])).toBe(EMPTY_MEMORY);
    let memory = EMPTY_MEMORY;
    for (let i = 0; i < SAMPLES_PER_DIGIT; i++) memory = teach(memory, [['11:11', '11:11']]);
    expect(memory.samples.filter((x) => x.label === '1').length).toBe(SAMPLES_PER_DIGIT);
  });
});
