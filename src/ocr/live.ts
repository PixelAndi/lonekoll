import { checkOrder, checkPlausible, type StampRow } from './parse.ts';
import type { FoundTable } from './pipeline.ts';

// The live scanner. The user points the camera roughly at the clock's table;
// each frame's search area is read in one pass and the table is found from
// the words on its date bar (see findTableByText). Where it was found, against
// a target in the middle, says how to move the phone; within a tolerance it
// is locked on, and the data counts as grabbed when the readings of the
// latest locked frames agree.

/** The search area in frame pixels: generous, so the table only has to be roughly inside. */
export function searchArea(frameWidth: number, frameHeight: number) {
  const width = Math.min(frameWidth * 0.92, frameHeight * 0.95 * 1.6);
  const height = Math.min(frameHeight * 0.6, width * 0.62);
  return { left: (frameWidth - width) / 2, top: frameHeight * 0.45 - height / 2, width, height };
}

export type Hint =
  /** No table found: point the camera at it. */
  | 'place'
  /** The table is small: move closer. */
  | 'closer'
  /** The table is too big: move back. */
  | 'further'
  /** The table is off the target: move the phone that way. */
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  /** Tilted: turn the phone. */
  | 'straighten'
  /** Date found but no stamp rows: get the rows into view too. */
  | 'needRows'
  /** On target: hold still while it is read and confirmed. */
  | 'steady';

/** Below this bar height in pixels the text is too small to read reliably. */
const MIN_BAR_HEIGHT = 24;
/** The target: the table centred in the search area, this share of its width. */
export const TARGET_WIDTH = 0.8;
/** The table's height (bar, header and a few rows) in bar heights, and where its middle is below the bar's. */
const TABLE_HEIGHT_IN_BARS = 5.5;
const TABLE_MIDDLE_BELOW_BAR = 2.25;
/**
 * How close to the target counts as locked on: generous, since the reading
 * copes with an off-centre or tilted table; the lock is what makes it count.
 */
const LOCK = { offsetX: 0.12, offsetY: 0.16, minScale: 0.68, maxScale: 1.3, angle: 0.1 };

export interface Aim {
  hint: Hint;
  /** Within the tolerance: frames read now count. */
  locked: boolean;
  /** The table's middle relative to the target's, as shares of the search area (negative = left/up). */
  dx: number;
  dy: number;
  /** The table's width relative to the target's (1 = just right). */
  scale: number;
  angle: number;
  /** The table's outline in the search area's pixels: middle, size and tilt. */
  table: { cx: number; cy: number; width: number; height: number; angle: number };
}

/**
 * Where the found table is relative to the target in the middle of the search
 * area, and what to do about it: closer or further first, then move the
 * phone towards the table, then straighten. Within the tolerance it is
 * locked on.
 */
export function aim(found: FoundTable | null, areaWidth: number, areaHeight: number): Aim | null {
  if (!found) return null;
  const { loc } = found;
  const width = loc.right - loc.left;
  const thickness = loc.thickness ?? (loc.barBottom - loc.barTop) - Math.abs(Math.tan(loc.angle)) * width;
  const bx = (loc.left + loc.right) / 2;
  const by = (loc.barTop + loc.barBottom) / 2;
  const below = thickness * TABLE_MIDDLE_BELOW_BAR;
  const table = {
    cx: bx - Math.sin(loc.angle) * below,
    cy: by + Math.cos(loc.angle) * below,
    width,
    height: thickness * TABLE_HEIGHT_IN_BARS,
    angle: loc.angle,
  };
  const dx = (table.cx - areaWidth / 2) / areaWidth;
  const dy = (table.cy - areaHeight / 2) / areaHeight;
  const scale = width / areaWidth / TARGET_WIDTH;
  const tooSmall = scale < LOCK.minScale || found.barHeight < MIN_BAR_HEIGHT || !found.date;
  let hint: Hint;
  if (tooSmall) hint = 'closer';
  else if (scale > LOCK.maxScale || (!found.bothEnds && scale > 1.15)) hint = 'further';
  else if (Math.abs(dx) / LOCK.offsetX > Math.max(1, Math.abs(dy) / LOCK.offsetY)) hint = dx < 0 ? 'left' : 'right';
  else if (Math.abs(dy) > LOCK.offsetY) hint = dy < 0 ? 'up' : 'down';
  else if (Math.abs(loc.angle) > LOCK.angle) hint = 'straighten';
  else if (found.rows.length === 0) hint = 'needRows';
  else hint = 'steady';
  return { hint, locked: hint === 'steady', dx, dy, scale, angle: loc.angle, table };
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
