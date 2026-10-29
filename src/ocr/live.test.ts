import { describe, expect, it } from 'vitest';
import { agreement, hintFor, progress, searchArea, type FrameReading } from './live.ts';
import type { FoundTable } from './pipeline.ts';

const found = (f: Partial<FoundTable> = {}): FoundTable => ({
  loc: { left: 50, right: 750, barTop: 100, barBottom: 130, headerBottom: 160, angle: 0 },
  date: '2026-10-29',
  rows: [{ in: '14:30', out: '18:20' }],
  confirmed: true,
  width: 0.8,
  bothEnds: true,
  barHeight: 30,
  ...f,
});

describe('searchArea', () => {
  it('fits a generous area in portrait and landscape frames', () => {
    for (const [w, h] of [
      [1080, 1920],
      [1920, 1080],
    ]) {
      const a = searchArea(w, h);
      expect(a.left).toBeGreaterThanOrEqual(0);
      expect(a.top).toBeGreaterThanOrEqual(0);
      expect(a.left + a.width).toBeLessThanOrEqual(w);
      expect(a.top + a.height).toBeLessThanOrEqual(h);
      expect(a.width / w).toBeGreaterThan(0.5);
    }
  });
});

describe('hintFor', () => {
  it('says what to fix from where the table was found', () => {
    expect(hintFor(null)).toBe('place');
    expect(hintFor(found({ width: 0.3 }))).toBe('closer');
    // Text too small to read: the bar is low in pixels, or the date couldn't be read.
    expect(hintFor(found({ barHeight: 18 }))).toBe('closer');
    expect(hintFor(found({ date: null, rows: [] }))).toBe('closer');
    expect(hintFor(found({ width: 1.25 }))).toBe('further');
    expect(hintFor(found({ width: 1.1, bothEnds: false }))).toBe('further');
    // A little wider than the area is fine while both ends are read.
    expect(hintFor(found({ width: 1.07 }))).toBe('steady');
    expect(hintFor(found({ loc: { ...found().loc, angle: 0.2 } }))).toBe('straighten');
    expect(hintFor(found({ rows: [] }))).toBe('needRows');
    expect(hintFor(found())).toBe('steady');
    // Roughly placed is fine: a bit small, a bit tilted.
    expect(hintFor(found({ width: 0.55, loc: { ...found().loc, angle: 0.08 } }))).toBe('steady');
  });
});

describe('agreement', () => {
  const ok: FrameReading = { date: '2026-10-29', rows: [{ in: '14:30', out: '18:20' }] };
  const misread: FrameReading = { date: '2026-10-29', rows: [{ in: '04:30', out: '18:20' }] };

  it('accepts the last two frames reading exactly the same', () => {
    expect(agreement([ok])).toBeNull();
    expect(agreement([ok, ok])).toEqual({ date: '2026-10-29', rows: [{ in: '14:30', out: '18:20' }] });
  });

  it('otherwise needs a majority of three on every value', () => {
    expect(agreement([ok, misread, ok, misread])).toBeNull();
    expect(agreement([ok, misread, ok, { ...ok, date: null }, ok])).toEqual({ date: '2026-10-29', rows: [{ in: '14:30', out: '18:20' }] });
  });

  it('never accepts times that make no sense', () => {
    // 04:30–18:20 is a 14-hour row.
    expect(agreement([misread, misread])).toBeNull();
    expect(agreement([misread, misread, misread])).toBeNull();
  });

  it('shows progress for the dots', () => {
    expect(progress([])).toBe(0);
    expect(progress([ok])).toBe(2);
    expect(progress([ok, ok])).toBe(3);
    expect(progress([{ date: '2026-10-29', rows: [] }])).toBe(1);
  });
});
