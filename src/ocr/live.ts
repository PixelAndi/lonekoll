import { checkOrder, checkPlausible, type StampRow } from './parse.ts';
import type { FoundTable } from './pipeline.ts';

// The live scanner. The user points the camera roughly at the clock's table;
// each frame's search area is read in one pass, the table is found from the
// words on its date bar (see findTableByText), and hints come from where it
// was found. The data counts as grabbed when the readings of the latest
// frames agree.

/** The search area in frame pixels: generous, so the table only has to be roughly inside. */
export function searchArea(frameWidth: number, frameHeight: number) {
  const width = Math.min(frameWidth * 0.92, frameHeight * 0.95 * 1.6);
  const height = Math.min(frameHeight * 0.6, width * 0.62);
  return { left: (frameWidth - width) / 2, top: frameHeight * 0.45 - height / 2, width, height };
}

export type Hint =
  /** No table found: point the camera at it. */
  | 'place'
  /** The table is small in the search area: move closer. */
  | 'closer'
  /** The table is wider than the search area: move back. */
  | 'further'
  /** Tilted a lot. */
  | 'straighten'
  /** Date found but no stamp rows: get the rows into view too. */
  | 'needRows'
  /** Read; hold still while it is confirmed. */
  | 'steady';

/** Below this share of the search area's width, or this bar height in pixels, the text is too small to read reliably. */
const MIN_WIDTH = 0.45;
const MIN_BAR_HEIGHT = 24;
/** Wider than the search area is fine while both ends of the bar can still be read. */
const MAX_WIDTH = 1.04;
const MAX_WIDTH_BOTH_ENDS = 1.2;
const MAX_ANGLE = 0.14;

export function hintFor(found: FoundTable | null): Hint {
  if (!found) return 'place';
  if (found.width < MIN_WIDTH || found.barHeight < MIN_BAR_HEIGHT || !found.date) return 'closer';
  if (found.width > (found.bothEnds ? MAX_WIDTH_BOTH_ENDS : MAX_WIDTH)) return 'further';
  if (Math.abs(found.loc.angle) > MAX_ANGLE) return 'straighten';
  if (found.rows.length === 0) return 'needRows';
  return 'steady';
}

export interface Stamps {
  date: string;
  rows: StampRow[];
}

/** One frame's reading, kept for the agreement check. */
export interface FrameReading {
  date: string | null;
  rows: StampRow[];
}

/** Readings kept for the majority. */
export const HISTORY = 5;
/** Readings that must agree on every value when they aren't simply the last two. */
export const MAJORITY = 3;

const usable = (r: FrameReading) => r.date !== null && r.rows.length > 0 && checkOrder(r.rows) && checkPlausible(r.rows);
const key = (r: FrameReading) => JSON.stringify([r.date, r.rows.map((x) => [x.in, x.out])]);

/** Most common value and how many had it. */
function majority<T>(values: T[]): { value: T; votes: number } {
  const tally = new Map<string, { value: T; votes: number }>();
  for (const v of values) {
    const k = JSON.stringify(v);
    const t = tally.get(k) ?? { value: v, votes: 0 };
    t.votes++;
    tally.set(k, t);
  }
  return [...tally.values()].sort((a, b) => b.votes - a.votes)[0];
}

/**
 * What the latest frames agree on: the last two read exactly the same, or
 * every value (date, number of rows, each time) read the same by at least
 * MAJORITY of the recent readings. The result must be in order and
 * plausible. Null while they don't agree yet.
 */
export function agreement(history: FrameReading[]): Stamps | null {
  const [a, b] = history.slice(-2);
  if (a && b && usable(b) && key(a) === key(b)) return { date: b.date!, rows: b.rows.map((r) => ({ in: r.in, out: r.out })) };
  const read = history.filter((r) => r.date !== null && r.rows.length > 0);
  if (read.length < MAJORITY) return null;
  const date = majority(read.map((r) => r.date!));
  const count = majority(read.map((r) => r.rows.length));
  if (date.votes < MAJORITY || count.votes < MAJORITY) return null;
  const same = read.filter((r) => r.rows.length === count.value);
  const rows: StampRow[] = [];
  for (let i = 0; i < count.value; i++) {
    const row: StampRow = { in: null, out: null };
    for (const field of ['in', 'out'] as const) {
      const m = majority(same.map((r) => r.rows[i][field]));
      if (m.votes < MAJORITY) return null;
      row[field] = m.value;
    }
    rows.push(row);
  }
  return checkOrder(rows) && checkPlausible(rows) ? { date: date.value, rows } : null;
}

/** How far the agreement has come, 0–3, for the progress dots. */
export function progress(history: FrameReading[]): number {
  const last = history[history.length - 1];
  if (!last || !usable(last)) return history.length && history[history.length - 1].date ? 1 : 0;
  const same = history.filter((r) => key(r) === key(last)).length;
  return Math.min(3, 1 + same);
}
