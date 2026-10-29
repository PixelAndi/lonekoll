import type { TableLocation } from './image.ts';
import { checkOrder, checkPlausible, type StampRow } from './parse.ts';
import type { ClockReading, QuickReading } from './pipeline.ts';

// The live scanner: the user lines the clock's table up with a guide drawn
// on the camera view, the area inside the guide is read over and over with a
// fast single pass, and hints are worked out from what was read. The data
// counts as grabbed when two independent checks agree on every value: the
// fast readings of the last few frames (by majority), and the full reading
// (three passes) of the current frame.

/**
 * The guide, shaped like the clock's table: the date bar along the top
 * (BAR_SHARE of the height), the column header and up to four stamp rows below.
 */
const ASPECT = 4.3;
const BAR_SHARE = 0.18;

export interface Guide {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Bottom of the date bar strip. */
  barBottom: number;
}

/** The guide in frame pixels: as wide as fits, a little above the middle. */
export function guideBox(frameWidth: number, frameHeight: number): Guide {
  const width = Math.min(frameWidth * 0.92, frameHeight * 0.7 * ASPECT);
  const height = width / ASPECT;
  const left = (frameWidth - width) / 2;
  const top = frameHeight * 0.45 - height / 2;
  return { left, top, width, height, barBottom: top + height * BAR_SHARE };
}

/** Where the table is when it fills the guide, in the coordinates of a crop that starts at (originX, originY) and is scaled by `scale`. */
export function guideLocation(guide: Guide, originX = 0, originY = 0, scale = 1): TableLocation {
  const x = (v: number) => (v - originX) * scale;
  const y = (v: number) => (v - originY) * scale;
  const barHeight = guide.barBottom - guide.top;
  return {
    left: x(guide.left),
    right: x(guide.left + guide.width),
    barTop: y(guide.top),
    barBottom: y(guide.barBottom),
    headerBottom: y(guide.barBottom + barHeight * 0.9),
    angle: 0,
  };
}

/** The part of the frame to read: the guide with a margin, clamped to the frame. */
export function readRegion(guide: Guide, frameWidth: number, frameHeight: number) {
  const marginX = guide.width * 0.04;
  const marginY = guide.height * 0.12;
  const left = Math.max(0, guide.left - marginX);
  const top = Math.max(0, guide.top - marginY);
  return {
    left,
    top,
    width: Math.min(frameWidth, guide.left + guide.width + marginX) - left,
    height: Math.min(frameHeight, guide.top + guide.height + marginY * 2) - top,
  };
}

export type Hint =
  /** Nothing readable yet: line the table up with the guide. */
  | 'place'
  /** Times read but no date: the date bar should be in the top strip. */
  | 'needDate'
  /** Date read but no times: the rows should be inside the guide. */
  | 'needRows'
  /** The times are small: the table is smaller than the guide. */
  | 'closer'
  /** The times are large or the bar runs past the guide: the table is bigger than the guide. */
  | 'further'
  /** The table is off to one side of the guide. */
  | 'center'
  /** The rows slope: hold the phone level with the screen. */
  | 'straighten'
  /** Date and times read: hold still while they are confirmed. */
  | 'steady';

/**
 * When the table fills the guide, the text on the date bar ("‹‹ Föreg Dag" to
 * "Nästa Dag ››") spans about 0.81–0.90 of the guide's width, centred; at 87 %
 * of the guide's size it spans about 0.71. The digit sizes are a rougher
 * fallback for when the bar's ends weren't read: the date's digits measure
 * about 0.6 of the date strip's height and the stamp times 0.5–1.1.
 */
const MIN_BAR_SPAN = 0.76;
const MAX_BAR_OFFSET = 0.08;
const MIN_DATE_SIZE = 0.55;
const MIN_TIME_SIZE = 0.45;
const MAX_TIME_SIZE = 1.6;
const MAX_SLOPE = 0.06;

export function hintFor(q: QuickReading): Hint {
  // A table that doesn't fill the guide is read at the wrong places: rows get missed.
  const { left, right } = q.barText;
  if (left !== null && right !== null) {
    if (left < -0.02 || right > 1.02) return 'further';
    if (right - left < MIN_BAR_SPAN) return 'closer';
    if (Math.abs((left + right) / 2 - 0.51) > MAX_BAR_OFFSET) return 'center';
  } else if ((left !== null && left > 0.15) || (right !== null && right < 0.85)) {
    // One end read and away from its edge, the other not read: the table is shifted and runs past the other side.
    return 'center';
  } else if ((q.dateSize !== null && q.dateSize < MIN_DATE_SIZE) || (q.timeSize !== null && q.timeSize < MIN_TIME_SIZE)) {
    return 'closer';
  }
  if (q.timeSize !== null && q.timeSize > MAX_TIME_SIZE) return 'further';
  if (q.slope !== null && Math.abs(q.slope) > MAX_SLOPE) return 'straighten';
  if (q.date !== null && q.rows.length > 0) return 'steady';
  if (q.date === null && q.rows.length === 0) return 'place';
  if (q.date === null) return 'needDate';
  if (q.rows.length === 0) return 'needRows';
  return 'steady';
}

/** Fast readings that must agree before the full reading is asked. */
export const CONSENSUS_FRAMES = 3;
/** Fast readings kept for the majority. */
export const HISTORY = 5;

export interface Stamps {
  date: string;
  rows: StampRow[];
}

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
 * What the recent fast readings agree on: the date, the number of rows and
 * every time each read the same by at least CONSENSUS_FRAMES of them, and
 * the result in order and plausible. Null while they don't agree yet.
 */
export function consensus(history: QuickReading[]): Stamps | null {
  const read = history.filter((q) => q.date !== null && q.rows.length > 0);
  if (read.length < CONSENSUS_FRAMES) return null;
  const date = majority(read.map((q) => q.date!));
  const count = majority(read.map((q) => q.rows.length));
  if (date.votes < CONSENSUS_FRAMES || count.votes < CONSENSUS_FRAMES) return null;
  const same = read.filter((q) => q.rows.length === count.value);
  const rows: StampRow[] = [];
  for (let i = 0; i < count.value; i++) {
    const row: StampRow = { in: null, out: null };
    for (const field of ['in', 'out'] as const) {
      const m = majority(same.map((q) => q.rows[i][field]));
      if (m.votes < CONSENSUS_FRAMES) return null;
      row[field] = m.value;
    }
    rows.push(row);
  }
  return checkOrder(rows) && checkPlausible(rows) ? { date: date.value, rows } : null;
}

/** The full reading of a frame says the same as the fast readings agreed on. */
export function confirms(full: ClockReading, agreed: Stamps): boolean {
  return (
    full.date === agreed.date &&
    full.rows.length === agreed.rows.length &&
    full.rows.every((r, i) => r.in === agreed.rows[i].in && r.out === agreed.rows[i].out)
  );
}
