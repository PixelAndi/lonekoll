import { describe, expect, it } from 'vitest';
import { aimAt, findPage } from './pageFind.ts';

/** A grey background with a white sheet (printed lines on it) at the given place, 160 × 284 px. */
function frame(x: number, y: number, w: number, h: number) {
  const W = 160;
  const H = 284;
  const data = new Uint8Array(W * H).fill(150);
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue;
      // Table lines every 8 px.
      data[yy * W + xx] = (yy - y) % 8 === 0 ? 60 : 235;
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
    expect(aimAt(findPage(frame(-10, -10, 180, 304)), FRAME)).toBe('further');
    expect(aimAt(findPage({ width: 160, height: 284, data: new Uint8Array(160 * 284).fill(90) }), FRAME)).toBe('find');
  });
});
