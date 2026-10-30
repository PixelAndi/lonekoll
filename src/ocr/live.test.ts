import { describe, expect, it } from 'vitest';
import { agreement, aim, progress, searchArea, type FrameReading } from './live.ts';
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

describe('aim', () => {
  // A 1000 × 600 search area; the target is a table 800 wide in the middle.
  const W = 1000;
  const H = 600;
  const t = 800 / 23.5;
  /** A table of the given width (share of the target), its middle at (x, y), tilted by `angle`. */
  const at = (x: number, y: number, scale = 1, angle = 0, f: Partial<FoundTable> = {}) => {
    const w = 800 * scale;
    const th = t * scale;
    const by = y - 2.25 * th;
    return found({ loc: { left: x - w / 2, right: x + w / 2, barTop: by - th / 2, barBottom: by + th / 2, headerBottom: by + th, angle, thickness: th }, barHeight: th, ...f });
  };

  it('locks on when the table is roughly on the target', () => {
    expect(aim(at(500, 300), W, H)).toMatchObject({ hint: 'steady', locked: true });
    expect(aim(at(560, 340, 0.85, 0.06), W, H)).toMatchObject({ hint: 'steady', locked: true });
    expect(aim(null, W, H)).toBeNull();
  });

  it('says which way to move the phone: towards where the table is', () => {
    expect(aim(at(300, 300), W, H)?.hint).toBe('left');
    expect(aim(at(700, 300), W, H)?.hint).toBe('right');
    expect(aim(at(500, 150), W, H)?.hint).toBe('up');
    expect(aim(at(500, 450), W, H)?.hint).toBe('down');
    expect(aim(at(500, 300, 0.5), W, H)?.hint).toBe('closer');
    expect(aim(at(500, 300, 1.4), W, H)?.hint).toBe('further');
    expect(aim(at(500, 300, 1, 0.15), W, H)?.hint).toBe('straighten');
  });

  it('asks to come closer when the text is too small or unread, and for the rows when they are missing', () => {
    expect(aim(at(500, 300, 1, 0, { barHeight: 18 }), W, H)?.hint).toBe('closer');
    expect(aim(at(500, 300, 1, 0, { date: null, rows: [] }), W, H)?.hint).toBe('closer');
    expect(aim(at(500, 300, 1, 0, { rows: [] }), W, H)).toMatchObject({ hint: 'needRows', locked: false });
  });

  it('reports the offsets for the guide', () => {
    const a = aim(at(600, 240, 0.9), W, H)!;
    expect(a.dx).toBeCloseTo(0.1);
    expect(a.dy).toBeCloseTo(-0.1);
    expect(a.scale).toBeCloseTo(0.9);
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

  it('counts a followed frame as one reading, a searched one as two', () => {
    const followed = { ...ok, weight: 1 };
    expect(agreement([followed, followed])).toBeNull();
    expect(agreement([ok, followed])).toEqual({ date: '2026-10-29', rows: [{ in: '14:30', out: '18:20' }] });
    expect(agreement([followed, { ...misread, weight: 1 }, followed, followed])).toEqual({ date: '2026-10-29', rows: [{ in: '14:30', out: '18:20' }] });
    expect(agreement([ok, { ...misread, weight: 1 }])).toBeNull();
    expect(progress([followed])).toBe(1);
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
