import { describe, expect, it } from 'vitest';
import { ctcDecode, restorePhrases, restoreSwedish, textBoxes, wordsOfLine } from './paddle.ts';

describe('the text lines in a detection map', () => {
  // A made-up map 200 × 60: two lines of "text" (high probability), one a little sloped, and a speck.
  const width = 200;
  const height = 60;
  const map = () => {
    const prob = new Float32Array(width * height);
    for (let x = 20; x < 180; x++) for (let y = 10; y < 16; y++) prob[y * width + x] = 0.9;
    for (let x = 20; x < 120; x++) {
      const y0 = 38 + Math.round((x - 20) * 0.02);
      for (let y = y0; y < y0 + 6; y++) prob[y * width + x] = 0.8;
    }
    prob[55 * width + 190] = 0.9;
    return prob;
  };

  it('finds each line, widened as DB does, and leaves out specks', () => {
    const boxes = textBoxes(map(), width, height);
    expect(boxes).toHaveLength(2);
    const [first, second] = [...boxes].sort((a, b) => a.cy - b.cy);
    expect(first.cx).toBeCloseTo(99.5, 0);
    expect(first.cy).toBeCloseTo(12.5, 0);
    // 160 × 6 grown by 160 · 6 · 1.5 / (2 · 166) ≈ 4.3 on every side.
    expect(first.length).toBeGreaterThan(166);
    expect(first.height).toBeGreaterThan(14);
    expect(second.length).toBeGreaterThan(100);
  });

  it('takes the page’s slope from its long lines', () => {
    const boxes = textBoxes(map(), width, height);
    expect(Math.abs(boxes[0].angle)).toBeLessThan(0.03);
  });
});

describe('decoding what the recognition model read', () => {
  const dict = ['a', 'b', 'c', ' '];
  /** One time step per entry: the class that is likeliest. */
  const steps = (classes: number[]) => {
    const data = new Float32Array(classes.length * 5);
    classes.forEach((c, t) => {
      for (let k = 0; k < 5; k++) data[t * 5 + k] = k === c ? 0.9 : 0.025;
    });
    return data;
  };

  it('merges repeats and drops blanks, keeping where each character was read', () => {
    const read = ctcDecode(steps([1, 1, 0, 2, 0, 4, 3, 3]), 8, 5, dict);
    expect(read.text).toBe('ab c');
    expect(read.at).toEqual([0, 3, 5, 6]);
    expect(read.confidence).toBeCloseTo(0.9);
  });

  it('keeps a letter read twice with a blank between', () => {
    expect(ctcDecode(steps([1, 0, 1]), 3, 5, dict).text).toBe('aa');
  });

  it('places each word along its line', () => {
    const read = ctcDecode(steps([1, 0, 2, 0, 4, 0, 3, 0, 1, 0]), 10, 5, dict);
    const words = wordsOfLine(read, { cx: 100, cy: 50, length: 100, height: 20, angle: 0, score: 1 });
    expect(words.map((w) => w.text)).toEqual(['ab', 'ca']);
    expect(words[0].bbox.x0).toBeLessThan(words[1].bbox.x0);
    expect(words[0].bbox.x1).toBeLessThan(words[1].bbox.x0 + 10);
    expect(words[0].bbox.y0).toBeCloseTo(40);
    expect(words[1].bbox.x1).toBeLessThanOrEqual(150 + 10);
  });
});

describe('å, ä and ö put back', () => {
  it('in the words a slip prints, as read without them or with a digit for a letter', () => {
    expect(restoreSwedish('Bruttolon')).toBe('Bruttolön');
    expect(restoreSwedish('Loneperiod:')).toBe('Löneperiod:');
    expect(restoreSwedish('Tim18n')).toBe('Timlön');
    expect(restoreSwedish('Timl8n')).toBe('Timlön');
    expect(restoreSwedish('OVRIGA')).toBe('Övriga');
    expect(restoreSwedish('overtid,')).toBe('övertid,');
  });

  it('leaves other words and figures alone', () => {
    expect(restoreSwedish('Timmar')).toBe('Timmar');
    expect(restoreSwedish('2 345,67')).toBe('2 345,67');
    expect(restoreSwedish('2026-09-01')).toBe('2026-09-01');
  });

  it('in phrases whose short words can’t be told alone', () => {
    const w = (text: string) => ({ text, confidence: 90, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } });
    expect(restorePhrases([w('Skatt'), w('beräknad'), w('pa')]).map((x) => x.text)).toEqual(['Skatt', 'beräknad', 'på']);
    expect(restorePhrases([w('Totalt'), w('iar')]).map((x) => x.text)).toEqual(['Totalt', 'i år']);
    expect(restorePhrases([w('pa')]).map((x) => x.text)).toEqual(['pa']);
  });
});
