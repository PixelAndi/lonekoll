import { describe, expect, it } from 'vitest';
import type { RGBAImage } from './image.ts';
import { checkFrame, isSteady, readingComplete } from './live.ts';

type Color = [number, number, number];
const BLUE: Color = [10, 40, 90];
const CYAN: Color = [140, 245, 250];
const LAVENDER: Color = [165, 155, 255];
const YELLOW: Color = [215, 245, 150];
const PINK: Color = [205, 150, 195];

/** A 640×480 dark-blue "screen" with a date bar and header row at the given place. */
function frame(bar: { left: number; right: number; top: number }, colors: [Color, Color] = [CYAN, LAVENDER]): RGBAImage {
  const width = 640;
  const height = 480;
  const data = new Uint8ClampedArray(width * height * 4);
  const paint = (x0: number, x1: number, y0: number, y1: number, c: Color) => {
    for (let y = Math.max(0, y0); y < Math.min(height, y1); y++)
      for (let x = Math.max(0, x0); x < Math.min(width, x1); x++) data.set([...c, 255], (y * width + x) * 4);
  };
  paint(0, width, 0, height, BLUE);
  paint(bar.left, bar.right, bar.top, bar.top + 20, colors[0]);
  paint(bar.left, bar.right, bar.top + 21, bar.top + 38, colors[1]);
  // Dark "text" in the bar.
  for (let x = bar.left + 40; x < bar.right - 40; x += 24) paint(x, x + 10, bar.top + 5, bar.top + 15, [30, 30, 30]);
  return { width, height, data };
}

describe('checkFrame', () => {
  it('accepts a table in the guide, in either colour scheme', () => {
    expect(checkFrame(frame({ left: 40, right: 600, top: 148 })).status).toBe('ok');
    expect(checkFrame(frame({ left: 40, right: 600, top: 148 }, [YELLOW, PINK])).status).toBe('ok');
  });

  it('says what to fix', () => {
    expect(checkFrame(frame({ left: 150, right: 490, top: 140 })).status).toBe('closer');
    expect(checkFrame(frame({ left: 0, right: 640, top: 140 })).status).toBe('further');
    expect(checkFrame(frame({ left: 40, right: 600, top: 260 })).status).toBe('center');
    const empty = frame({ left: 0, right: 0, top: 0 });
    expect(checkFrame(empty).status).toBe('searching');
  });
});

describe('isSteady', () => {
  const bar = { left: 60, right: 580, top: 140, bottom: 160, angle: 0 };
  it('allows a few pixels of movement, not more', () => {
    expect(isSteady(bar, { ...bar, left: 63, top: 142 })).toBe(true);
    expect(isSteady(bar, { ...bar, left: 80 })).toBe(false);
    expect(isSteady(undefined, bar)).toBe(false);
  });
});

describe('readingComplete', () => {
  const reading = { date: '2026-10-29', dateUncertain: false, rows: [{ in: '14:30', out: '18:20' }], issues: [], confidence: 90 };
  it('needs a date, times, no issues and no doubtful times', () => {
    expect(readingComplete(reading)).toBe(true);
    expect(readingComplete({ ...reading, date: null })).toBe(false);
    expect(readingComplete({ ...reading, rows: [{ in: '14:30', out: '18:20', outUncertain: true }] })).toBe(false);
    expect(readingComplete({ ...reading, issues: ['out-of-order'] })).toBe(false);
  });
});

describe('a tilted table', () => {
  it('asks to hold the phone straight', () => {
    // The bar from frame() turned by about 8°.
    const flat = frame({ left: 60, right: 580, top: 200 });
    const { width, height } = flat;
    const data = new Uint8ClampedArray(flat.data.length);
    const a = 0.14;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const sx = Math.round(width / 2 + (x - width / 2) * Math.cos(a) + (y - height / 2) * Math.sin(a));
        const sy = Math.round(height / 2 - (x - width / 2) * Math.sin(a) + (y - height / 2) * Math.cos(a));
        const o = (y * width + x) * 4;
        const i = (Math.min(height - 1, Math.max(0, sy)) * width + Math.min(width - 1, Math.max(0, sx))) * 4;
        data.set(flat.data.subarray(i, i + 4), o);
      }
    expect(checkFrame({ width, height, data }).status).toBe('straighten');
  });
});

describe('a table far away', () => {
  it('asks to come closer when only a little of the bar colour shows', () => {
    // A bar too thin to find as a table, but its colour is there.
    const img = frame({ left: 280, right: 360, top: 200 });
    expect(checkFrame(img).status).toBe('closer');
  });
});
