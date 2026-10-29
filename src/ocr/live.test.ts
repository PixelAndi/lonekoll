import { describe, expect, it } from 'vitest';
import { confirms, consensus, guideBox, guideLocation, hintFor, readRegion } from './live.ts';
import type { QuickReading } from './pipeline.ts';

const reading = (q: Partial<QuickReading> = {}): QuickReading => ({
  date: '2026-10-29',
  rows: [{ in: '14:30', out: '18:20' }],
  dateSize: 0.62,
  barText: { left: 0.07, right: 0.94 },
  timeSize: 0.8,
  slope: 0,
  ...q,
});

describe('hintFor', () => {
  it('asks to hold still once date and times are read', () => {
    expect(hintFor(reading())).toBe('steady');
  });

  it('says what to fix from what was read', () => {
    expect(hintFor(reading({ date: null, rows: [], timeSize: null, slope: null }))).toBe('place');
    expect(hintFor(reading({ date: null }))).toBe('needDate');
    expect(hintFor(reading({ rows: [], timeSize: null }))).toBe('needRows');
    expect(hintFor(reading({ barText: { left: 0.19, right: 0.82 } }))).toBe('closer');
    expect(hintFor(reading({ barText: { left: 0.2, right: 1 } }))).toBe('center');
    expect(hintFor(reading({ barText: { left: -0.03, right: 0.9 } }))).toBe('further');
    // One end of the bar missing: the table runs past that side.
    expect(hintFor(reading({ barText: { left: null, right: 0.75 } }))).toBe('center');
    // …but an end that simply wasn't read doesn't matter when the other is where it should be.
    expect(hintFor(reading({ barText: { left: null, right: 0.93 } }))).toBe('steady');
    // Without the bar's ends, the digit sizes decide.
    expect(hintFor(reading({ barText: { left: null, right: null }, dateSize: 0.45 }))).toBe('closer');
    expect(hintFor(reading({ barText: { left: null, right: null }, timeSize: 2 }))).toBe('further');
    expect(hintFor(reading({ date: null, slope: 0.08 }))).toBe('straighten');
    // Even a complete reading doesn't count from a table smaller than the guide.
    expect(hintFor(reading({ barText: { left: 0.15, right: 0.86 } }))).toBe('closer');
  });
});

describe('guide', () => {
  it('fits a table-shaped box in portrait and landscape frames', () => {
    for (const [w, h] of [
      [1080, 1920],
      [1920, 1080],
    ]) {
      const g = guideBox(w, h);
      expect(g.left).toBeGreaterThanOrEqual(0);
      expect(g.top).toBeGreaterThanOrEqual(0);
      expect(g.left + g.width).toBeLessThanOrEqual(w);
      expect(g.top + g.height).toBeLessThanOrEqual(h);
      expect(g.width / g.height).toBeCloseTo(4.3);
    }
  });

  it('maps the guide into the read region', () => {
    const g = guideBox(1080, 1920);
    const r = readRegion(g, 1080, 1920);
    const loc = guideLocation(g, r.left, r.top, 0.5);
    expect(loc.left).toBeCloseTo((g.left - r.left) * 0.5);
    expect(loc.barTop).toBeCloseTo((g.top - r.top) * 0.5);
    expect(loc.barBottom - loc.barTop).toBeCloseTo((g.barBottom - g.top) * 0.5);
  });
});

describe('consensus and confirmation', () => {
  const ok = reading();
  it('needs three fast readings agreeing on every value', () => {
    expect(consensus([ok, ok])).toBeNull();
    expect(consensus([ok, ok, ok])).toEqual({ date: '2026-10-29', rows: [{ in: '14:30', out: '18:20' }] });
    // A misread digit in a minority of frames is outvoted.
    const misread = reading({ rows: [{ in: '04:30', out: '18:20' }] });
    expect(consensus([ok, misread, ok, ok])).toEqual({ date: '2026-10-29', rows: [{ in: '14:30', out: '18:20' }] });
    expect(consensus([ok, misread, misread, ok])).toBeNull();
  });

  it('ignores readings without data and refuses implausible results', () => {
    const empty = reading({ date: null, rows: [] });
    expect(consensus([ok, empty, ok, empty])).toBeNull();
    const odd = reading({ rows: [{ in: '04:30', out: '18:20' }] });
    expect(consensus([odd, odd, odd])).toBeNull();
  });

  it('accepts only when the full reading says the same', () => {
    const agreed = consensus([ok, ok, ok])!;
    const full = { date: '2026-10-29', dateUncertain: false, rows: [{ in: '14:30', out: '18:20', inUncertain: true }], issues: [], confidence: 80 };
    expect(confirms(full, agreed)).toBe(true);
    expect(confirms({ ...full, rows: [{ in: '14:30', out: null }] }, agreed)).toBe(false);
    expect(confirms({ ...full, date: '2026-10-28' }, agreed)).toBe(false);
  });
});
