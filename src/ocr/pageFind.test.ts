import { describe, expect, it } from 'vitest';
import { aimAt, aimAtPart, findPage } from './pageFind.ts';

/** A grey background with a white sheet (printed lines on it) at the given place, 160 × 284 px. */
function frame(x: number, y: number, w: number, h: number, background = 150, step = 8) {
  const W = 160;
  const H = 284;
  const data = new Uint8Array(W * H).fill(background);
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue;
      // Table lines every 8 px (or as given).
      data[yy * W + xx] = (yy - y) % step === 0 ? 60 : 235;
    }
  }
  return { width: W, height: H, data };
}
// The paper frame on screen: 90 % of the width, A4 upright, centred.
const FRAME = { x: 0.05, y: 0.18, w: 0.9, h: 0.64 };

describe('finding the timecard in the camera', () => {
  it('finds the sheet and says it is in place', () => {
    const page = findPage(frame(10, 55, 140, 180))!;
    expect(page.x).toBeCloseTo(10 / 160, 1);
    expect(page.w).toBeCloseTo(140 / 160, 1);
    expect(aimAt(page, FRAME)).toBe('ready');
  });

  it('asks to come closer when the sheet is small', () => {
    expect(aimAt(findPage(frame(50, 100, 60, 80)), FRAME)).toBe('closer');
  });

  it('says which way to move when the sheet is off to a side', () => {
    expect(aimAt(findPage(frame(-40, 55, 140, 180)), FRAME)).toBe('left');
    expect(aimAt(findPage(frame(60, 55, 140, 180)), FRAME)).toBe('right');
    expect(aimAt(findPage(frame(10, 0, 140, 150)), FRAME)).toBe('up');
  });

  it('asks to move back when the sheet runs off the picture, and says when there is none', () => {
    // The sheet fills the picture: its print runs off all round.
    expect(aimAt(findPage(frame(-10, -10, 180, 304, 150, 3)), FRAME)).toBe('further');
    expect(aimAt(findPage({ width: 160, height: 284, data: new Uint8Array(160 * 284).fill(90) }), FRAME)).toBe('find');
  });

  it('finds the print when the background is as light as the paper (a white sheet)', () => {
    // Paper 235 on a background of 228, with a soft fold across it.
    const img = frame(30, 70, 100, 140, 228);
    for (let x = 0; x < 160; x++) for (let y = 240; y < 250; y++) img.data[y * 160 + x] = 228 - Math.round(15 * Math.sin(((y - 240) / 10) * Math.PI));
    const page = findPage(img)!;
    expect(page.x).toBeGreaterThan(0.1);
    expect(page.x + page.w).toBeLessThan(0.9);
    expect(page.y).toBeGreaterThan(0.18);
    expect(page.y + page.h).toBeLessThan(0.8);
    expect(aimAt(page, FRAME)).toBe('ready');
  });

  it('says to find the card when pointed at a blank background with a lit band', () => {
    const img = frame(0, 0, 0, 0, 200);
    for (let y = 0; y < 40; y++) for (let x = 0; x < 160; x++) img.data[y * 160 + x] = 240;
    expect(aimAt(findPage(img), FRAME)).toBe('find');
  });

  it('guides a close-up by the sides only: the rows run on above and below', () => {
    const band = { x: 0.05, y: 0.3, w: 0.9, h: 0.4 };
    // Rows from top to bottom of the picture, the dates' edge in view: ready.
    expect(aimAtPart(findPage(frame(8, -10, 170, 304, 150, 3)), band)).toBe('ready');
    // The left edge (the dates) cut off.
    expect(aimAtPart(findPage(frame(-20, -10, 200, 304, 150, 3)), band)).toBe('left');
    // Too far away: the print is narrow.
    expect(aimAtPart(findPage(frame(50, 60, 60, 160, 150, 3)), band)).toBe('closer');
  });
});
