import { binarize, type GrayImage } from './image.ts';
import type { OcrWord } from './parse.ts';

// Reading a printed timecard (tidkort) from the time clock's system: one page
// per month with a row per day – Datum, Dag, Schema, In, Avr In, In Typ, Ut,
// Avr Ut, Ut Typ, … Arb Tid, Ord Tim, OB1, Frånvaro, Avvikelse – and a second
// row for a second stamp pair. The table's lines are removed before the text
// is read; each day is then checked against the card's own Arb Tid.

type Box = OcrWord['bbox'];

/** Black text on white, with the table's lines removed (they confuse the OCR and look like notes). */
export const cleanTimecard = (gray: GrayImage): GrayImage => prepareTimecard(gray).clean;

/** A printed horizontal rule of the table, y = a + b·x, reaching from x0 to x1. */
export interface Rule {
  a: number;
  b: number;
  x0: number;
  x1: number;
}
const ruleY = (r: Rule, x: number) => r.a + r.b * x;

/**
 * The page cleaned for reading (as cleanTimecard), and the table's horizontal
 * rules: they say for certain where each printed row is, which the height of
 * the words in a slightly blurred or tilted photo does not.
 */
export function prepareTimecard(gray: GrayImage): { clean: GrayImage; rules: Rule[] } {
  const bin = binarize(gray, false, 31, 12);
  const { width: w, height: h } = bin;
  const line = new Uint8Array(w * h);
  // Where the horizontal lines are (every third column of them, which is plenty).
  const px: number[] = [];
  const py: number[] = [];
  // A run of ink longer than a couple of characters is a line, not text.
  const maxRunX = Math.round(w * 0.02);
  const maxRunY = Math.round(h * 0.016);
  for (let y = 0; y < h; y++) {
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const ink = x < w && bin.data[y * w + x] === 0;
      if (ink && start < 0) start = x;
      if (!ink && start >= 0) {
        if (x - start > maxRunX) {
          for (let i = start; i < x; i++) {
            line[y * w + i] = 1;
            if (i % 3 === 0) {
              px.push(i);
              py.push(y);
            }
          }
        }
        start = -1;
      }
    }
  }
  for (let x = 0; x < w; x++) {
    let start = -1;
    for (let y = 0; y <= h; y++) {
      const ink = y < h && bin.data[y * w + x] === 0;
      if (ink && start < 0) start = y;
      if (!ink && start >= 0) {
        if (y - start > maxRunY) for (let i = start; i < y; i++) line[i * w + x] = 1;
        start = -1;
      }
    }
  }
  // The lines and their fringes (a pixel either side), so no ragged edge is left behind.
  const out = new Uint8Array(bin.data);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!line[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy >= 0 && yy < h && xx >= 0 && xx < w) out[yy * w + xx] = 255;
        }
      }
    }
  }
  return { clean: { width: w, height: h, data: out }, rules: findRules(px, py, w, h) };
}

/** The height of a printed row (the usual gap between rules), or null without the rules. */
export function rowHeight(rules: Rule[], width: number): number | null {
  const ys = rules.map((r) => ruleY(r, width / 2)).sort((a, b) => a - b);
  const gaps = ys.slice(1).map((y, i) => y - ys[i]).filter((g) => g > width * 0.006 && g < width * 0.045).sort((a, b) => a - b);
  return gaps.length >= 5 ? gaps[Math.floor(gaps.length / 2)] : null;
}

/**
 * The horizontal rules among the line pixels: the slope at which they line up
 * best, the rows where many of them meet at that slope, and each rule fitted
 * on its own (a photo taken at a slight angle doesn't have them quite parallel).
 */
function findRules(px: number[], py: number[], w: number, h: number): Rule[] {
  const n = px.length;
  if (n < w / 3) return [];
  const cx = w / 2;
  const pad = Math.ceil(w * 0.06);
  let best = { score: -1, slope: 0, hist: new Float64Array(0) };
  for (let k = -100; k <= 100; k++) {
    const slope = k * 0.0005;
    const hist = new Float64Array(h + 2 * pad);
    for (let i = 0; i < n; i++) {
      const y = Math.round(py[i] - slope * (px[i] - cx)) + pad;
      if (y >= 0 && y < hist.length) hist[y]++;
    }
    let score = 0;
    for (let y = 0; y < hist.length; y++) score += hist[y] * hist[y];
    if (score > best.score) best = { score, slope, hist };
  }
  const { slope, hist } = best;
  const near = (y: number) => (hist[y - 1] ?? 0) + hist[y] + (hist[y + 1] ?? 0);
  // A rule reaches across at least a quarter of the page.
  const minimum = (w * 0.25) / 3;
  const peaks: number[] = [];
  for (let y = 1; y < hist.length - 1; y++) {
    const v = near(y);
    if (v < minimum) continue;
    let top = true;
    for (let d = -4; d <= 4 && top; d++) if (d && near(y + d) > v) top = false;
    if (top && (!peaks.length || y - peaks[peaks.length - 1] > 4)) peaks.push(y);
  }
  return peaks.map((peak) => {
    // Least squares over the rule's own pixels; then again without those far off it (a binder
    // hole's shadow, a letter touching the line), which would tilt the rule at its ends.
    const fit = (near: (i: number) => boolean) => {
      let sx = 0, sy = 0, sxx = 0, sxy = 0, count = 0, x0 = w, x1 = 0;
      for (let i = 0; i < n; i++) {
        if (!near(i)) continue;
        sx += px[i];
        sy += py[i];
        sxx += px[i] * px[i];
        sxy += px[i] * py[i];
        count++;
        x0 = Math.min(x0, px[i]);
        x1 = Math.max(x1, px[i]);
      }
      const div = count * sxx - sx * sx;
      const b = div > 0 ? (count * sxy - sx * sy) / div : slope;
      return { a: (sy - b * sx) / Math.max(1, count), b, x0, x1, count };
    };
    const rough = fit((i) => Math.abs(py[i] - slope * (px[i] - cx) + pad - peak) <= 3);
    const fine = fit((i) => Math.abs(py[i] - slope * (px[i] - cx) + pad - peak) <= 3 && Math.abs(py[i] - (rough.a + rough.b * px[i])) <= 1.5);
    const { a, b, x0, x1 } = fine.count >= rough.count * 0.5 ? fine : rough;
    return { a, b, x0, x1 };
  });
}

export interface TimecardDay {
  date: string;
  /** Stamps as clocked (In / Ut). */
  pairs: { in: string | null; out: string | null }[];
  /** The rounded stamps (Avr In / Avr Ut), a second reading of the same times. */
  rounded: { in: string | null; out: string | null }[];
  /** Arb Tid: hours worked as printed, in decimal hours (8,25). */
  worked?: number;
  /** Ord Tim, ordinary hours: the same as Arb Tid on a day without overtime. */
  ordinary?: number;
  /** Words in the Frånvaro and Avvikelse columns (printed or handwritten). */
  note?: string;
  /** Where the day's rows are on the page (for a crop of handwritten notes). */
  top: number;
  bottom: number;
}

export interface TimecardPage {
  from?: string;
  to?: string;
  days: TimecardDay[];
  /** Where the Frånvaro column starts (x): notes, also handwritten, are looked for right of it. */
  notesFrom: number;
  /** When the card was printed ("2026-04-02 09:15", top right): with the period, which card this is. */
  printed?: string;
  /** The month's Arb Tid in the totals box: the days' Arb Tid add up to it when every day was read. */
  totalWorked?: number;
}

/**
 * What is known of the card before a close-up of part of it is read: its
 * period, and the part aimed at (with a few days either side). A close-up
 * has no header: the period isn't on it, and it ends at Arb Tid. Its rows
 * are matched to the whole period, by the dates and weekdays read on them –
 * the part aimed at is only taken for granted when too few could be read
 * (the user may have aimed elsewhere, and is then told so).
 */
export interface TimecardHint {
  from: string;
  to: string;
  near?: { from: string; to: string };
}

const WEEKDAYS: [RegExp, number][] = [
  [/^m[åaä]n/i, 1],
  [/^tis/i, 2],
  [/^ons/i, 3],
  [/^tor/i, 4],
  [/^fre/i, 5],
  [/^l[öoé]r/i, 6],
  [/^s[öot]n/i, 7],
];
const SCHEDULE = /\d{1,2}[:.]\d{2}-\d{1,2}[:.]\d{2}|^\d{2}[:.]\d{2}-|-\d{2}[:.]\d{2}$/;
const FULL_DATE = /(20\d{2})-(\d{2})-(\d{2})$/;

/** A word without the stray marks OCR adds around it ("13:05.", "“Ons", "[ut"). */
const clean = (text: string) => text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

/** "06:35", "06.35" or "0635" → "06:35"; anything else → null. */
export function asTime(text: string): string | null {
  const m = /^(\d{1,2})[:.;,]?(\d{2})$/.exec(clean(text));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? `${String(h).padStart(2, '0')}:${m[2]}` : null;
}

/** "8,25", "08.25", "825" or "825|" → 8.25 hours. */
function asHours(text: string): number | null {
  const t = clean(text);
  const m = /^(\d{1,2})[,.:](\d{2})$/.exec(t) ?? /^(\d{1,2})(\d{2})$/.exec(t);
  return m ? Number(`${m[1]}.${m[2]}`) : null;
}

const centerX = (b: Box) => (b.x0 + b.x1) / 2;
const centerY = (b: Box) => (b.y0 + b.y1) / 2;

/**
 * How much the rows slope (a photo is rarely quite straight): from pairs of
 * times on the same row far apart, the median rise per pixel across.
 */
function tilt(words: OcrWord[], width: number): number {
  const times = words.filter((w) => asTime(w.text));
  const slopes: number[] = [];
  for (const a of times) {
    for (const b of times) {
      const dx = centerX(b.bbox) - centerX(a.bbox);
      const dy = centerY(b.bbox) - centerY(a.bbox);
      if (dx > width * 0.1 && Math.abs(dy) < width * 0.008) slopes.push(dy / dx);
    }
  }
  slopes.sort((a, b) => a - b);
  return slopes.length ? slopes[Math.floor(slopes.length / 2)] : 0;
}

/**
 * A row's words with times and hours put back together where the OCR split
 * them at the colon or point ("12" "58" → "12:58", "07" "45" → "07:45").
 */
function joinSplit(row: OcrWord[], width: number): OcrWord[] {
  const out: OcrWord[] = [];
  for (const w of row) {
    const prev = out[out.length - 1];
    const a = prev && clean(prev.text);
    const b = clean(w.text);
    if (prev && /^\d{1,2}$/.test(a) && /^\d{2}$/.test(b) && w.bbox.x0 - prev.bbox.x1 < width * 0.012 && w.bbox.x0 > prev.bbox.x0) {
      out[out.length - 1] = {
        text: `${a}:${b}`,
        confidence: Math.min(prev.confidence, w.confidence),
        bbox: { x0: prev.bbox.x0, y0: Math.min(prev.bbox.y0, w.bbox.y0), x1: w.bbox.x1, y1: Math.max(prev.bbox.y1, w.bbox.y1) },
      };
    } else out.push(w);
  }
  return out;
}

/** Words grouped into printed rows, by their height on the page with the tilt taken out. */
function lines(words: OcrWord[], width: number): OcrWord[][] {
  const slope = tilt(words, width);
  const level = (w: OcrWord) => centerY(w.bbox) - slope * centerX(w.bbox);
  const tolerance = width * 0.0075;
  const sorted = [...words].sort((a, b) => level(a) - level(b));
  const out: { y: number; words: OcrWord[] }[] = [];
  for (const w of sorted) {
    const line = out[out.length - 1];
    if (line && level(w) - line.y < tolerance) {
      line.words.push(w);
      // The row's height as the mean of its words, so one stray word doesn't drag it.
      line.y = line.words.reduce((s, x) => s + level(x), 0) / line.words.length;
    } else out.push({ y: level(w), words: [w] });
  }
  return out.map((l) => joinSplit(l.words.sort((a, b) => a.bbox.x0 - b.bbox.x0), width));
}

/**
 * The x-centres of the time columns (In, Avr In, Ut, Avr Ut): on rows with
 * four times or more, the first four are those (Arb Tid and Ord Tim, which
 * look like times too, come after them). By clustering where times were found
 * when few rows were read whole.
 */
function timeColumns(rows: OcrWord[][], width: number): number[] {
  const full = rows
    .map((r) => r.filter((w) => asTime(w.text) && !SCHEDULE.test(clean(w.text)) && centerX(w.bbox) > width * 0.15).sort((a, b) => a.bbox.x0 - b.bbox.x0))
    .filter((times) => times.length >= 4);
  if (full.length >= 3) {
    const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const cols = [0, 1, 2, 3].map((k) => median(full.map((times) => centerX(times[k].bbox))));
    if (cols.every((x, k) => !k || x - cols[k - 1] > width * 0.02)) return cols;
  }
  return clusterColumns(rows.flat().filter((w) => asTime(w.text) && !SCHEDULE.test(w.text)).map((w) => centerX(w.bbox)), width);
}

function clusterColumns(xs: number[], width: number): number[] {
  const sorted = [...xs].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const x of sorted) {
    const g = groups[groups.length - 1];
    if (g && x - g[g.length - 1] < width * 0.025) g.push(x);
    else groups.push([x]);
  }
  // The four biggest groups, left to right.
  return groups
    .filter((g) => g.length >= 2)
    .sort((a, b) => b.length - a.length)
    .slice(0, 4)
    .map((g) => g.reduce((s, x) => s + x, 0) / g.length)
    .sort((a, b) => a - b);
}

/** A real calendar date ("2021-18-05" or "2021-02-30" read wrong is not). */
export function isRealDate(date: string | undefined): date is string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

function addDay(date: string, n = 1): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const weekdayOf = (date: string) => ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

/** The rows as printed, from the table's rules (see prepareTimecard): what lies between each rule and the next. */
export interface TimecardLayout {
  clean: GrayImage;
  rules: Rule[];
}

export function parseTimecard(words: OcrWord[], width: number, layout?: TimecardLayout, hint?: TimecardHint): TimecardPage {
  const all = lines(words, width);

  // The period: "Fr o m: 2023-08-01" and "T o m: 2023-08-31".
  let from: string | undefined;
  let to: string | undefined;
  for (const line of all) {
    const text = line.map((w) => w.text).join(' ');
    const f = /fr\s*o\s*m:?\s*(20\d{2}-\d{2}-\d{2})/i.exec(text)?.[1];
    const t = /t\s*o\s*m:?\s*(20\d{2}-\d{2}-\d{2})/i.exec(text)?.[1];
    if (isRealDate(f)) from ??= f;
    if (isRealDate(t)) to ??= t;
  }
  // The totals box: "Arb Tid 172.35" (more than a day can have).
  let totalWorked: number | undefined;
  for (const line of all) {
    const texts = line.map((w) => clean(w.text));
    const at = texts.findIndex((t, i) => /^arb$/i.test(t) && /^tid$/i.test(texts[i + 1] ?? ''));
    if (at < 0) continue;
    const n = texts.slice(at + 2, at + 5).map((t) => /^(\d{2,3})[.,](\d{2})$/.exec(t)).find((m) => m);
    if (n && Number(n[1]) >= 24) totalWorked ??= Number(`${n[1]}.${n[2]}`);
  }
  // When it was printed: the date and time beside "Sida".
  let printed: string | undefined;
  for (const line of all) {
    const m = /(20\d{2}-\d{2}-\d{2})\s+(\d{1,2})[:.](\d{2})\s+sida/i.exec(line.map((w) => w.text).join(' '));
    if (m && isRealDate(m[1])) printed ??= `${m[1]} ${m[2].padStart(2, '0')}:${m[3]}`;
  }

  // Columns: the times from where they were found; Arb Tid, Ord Tim and Frånvaro from the header when it was read.
  const columns = timeColumns(all, width);
  const afterTimes = (columns[3] ?? width * 0.55) + width * 0.03;
  // The column headers right of the times (the totals box below has an "Arb Tid" too, far left).
  const rightHeader = (re: RegExp) =>
    words.filter((w) => re.test(clean(w.text)) && centerX(w.bbox) > afterTimes - width * 0.02).sort((a, b) => a.bbox.y0 - b.bbox.y0)[0];
  const arb = rightHeader(/^arb$/i);
  const ord = rightHeader(/^ord$/i);
  // A close-up ends at Arb Tid: no Frånvaro column unless its header was read.
  const notesFrom = rightHeader(/^fr[åa]nvaro/i)?.bbox.x0 ?? (hint ? width : width * 0.82);
  const column = (w: OcrWord) => {
    if (columns.length !== 4) return -1;
    let best = 0;
    for (let i = 1; i < 4; i++) if (Math.abs(centerX(w.bbox) - columns[i]) < Math.abs(centerX(w.bbox) - columns[best])) best = i;
    return Math.abs(centerX(w.bbox) - columns[best]) < width * 0.03 ? best : -1;
  };
  const near = (w: OcrWord, h: OcrWord | undefined) => !!h && Math.abs(w.bbox.x0 - h.bbox.x0) < width * 0.04;
  /** Where the date, weekday and schedule are: left of the In column. */
  const dateEnd = columns.length === 4 ? columns[0] - width * 0.035 : width * 0.27;

  /** A printed row's words into the day: its times in their columns (In, Avr In, Ut, Avr Ut), Arb Tid, Ord Tim and notes. */
  const addRow = (day: TimecardDay, line: OcrWord[]) => {
    const cells: (string | null)[] = [null, null, null, null];
    for (const w of line) {
      const time = !SCHEDULE.test(clean(w.text)) ? asTime(w.text) : null;
      const c = time ? column(w) : -1;
      if (time && c >= 0) cells[c] = time;
      if (centerX(w.bbox) > afterTimes && centerX(w.bbox) < notesFrom) {
        const hours = asHours(w.text);
        if (hours !== null) {
          // Arb Tid comes before Ord Tim; by the header when it was read.
          const isArb = arb ? near(w, arb) : day.worked === undefined;
          const isOrd = ord ? near(w, ord) : !isArb && day.ordinary === undefined;
          if (isArb && day.worked === undefined) day.worked = hours;
          else if (isOrd && day.ordinary === undefined) day.ordinary = hours;
        }
      }
      if (w.bbox.x0 >= notesFrom - width * 0.01 && /\p{L}{3,}/u.test(clean(w.text))) {
        day.note = `${day.note ? `${day.note} ` : ''}${clean(w.text)}`;
      }
    }
    if (cells.some((c) => c)) {
      day.pairs.push({ in: cells[0], out: cells[2] });
      day.rounded.push({ in: cells[1], out: cells[3] });
    }
  };

  const page: TimecardPage = { from, to, days: [], notesFrom, printed, totalWorked };
  const isHours = (w: OcrWord) => centerX(w.bbox) > afterTimes && centerX(w.bbox) < notesFrom && asHours(w.text) !== null;
  const ruled = layout && byRules(words, width, layout, { from, to, dateEnd, hint, column: columns.length === 4 ? column : undefined, isHours });
  if (ruled) {
    for (const { date, rows, top, bottom } of ruled) {
      const day: TimecardDay = { date, pairs: [], rounded: [], top, bottom };
      for (const row of rows) addRow(day, row);
      page.days.push(day);
    }
    return page;
  }
  // A close-up starts anywhere in the month: counting on from the first date needs the rules.
  if (hint) return page;

  // Without the rules: rows by the height of their words.
  let current: TimecardDay | null = null;
  for (const line of all) {
    const texts = line.map((w) => clean(w.text));
    // The totals below the table end it.
    if (texts.some((t) => /^totaler$/i.test(t))) break;
    if (from && line.every((w) => w.bbox.y1 < (words.find((x) => x.text.includes(from!))?.bbox.y1 ?? 0) + 5)) continue;

    const left = line.filter((w) => w.bbox.x0 < width * 0.3);
    const { fullDate, weekday } = dayWords(left);
    const dateLike = left.some((w) => /\d{2}-\d{2}$|^20\d{2}/.test(clean(w.text)));
    const startsDay = !!fullDate || dateLike || !!weekday || line.some((w) => SCHEDULE.test(clean(w.text)) && w.bbox.x0 < width * 0.3);
    const top = Math.min(...line.map((w) => w.bbox.y0));
    const bottom = Math.max(...line.map((w) => w.bbox.y1));

    if (startsDay) {
      // Every date of the period has a row, in order: count on from the last one, and let a
      // date that was read whole (within the period, after the last) or the weekday correct it.
      const expected: string | undefined = current ? addDay(current.date) : from;
      let date: string | undefined = expected;
      if (fullDate && (!current || fullDate > current.date) && (!from || fullDate >= from) && (!to || fullDate <= to)) date = fullDate;
      else if (weekday && expected && weekdayOf(expected) !== weekday) {
        for (let k = 1; k <= 3; k++) {
          if (weekdayOf(addDay(expected, k)) === weekday) {
            date = addDay(expected, k);
            break;
          }
        }
      }
      if (!date || (to && date > to)) continue;
      current = { date, pairs: [], rounded: [], top, bottom };
      page.days.push(current);
    } else if (!current) {
      continue;
    }
    current.bottom = Math.max(current.bottom, bottom);
    addRow(current, line);
  }
  return page;
}

/** A full date ("2026-03-01", read whole and real) and a weekday ("Ons" → 3) among a row's words. */
function dayWords(words: OcrWord[]): { fullDate?: string; weekday?: number } {
  const m = words.map((w) => FULL_DATE.exec(clean(w.text))).find((x) => x);
  const read = m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
  return {
    fullDate: isRealDate(read) ? read : undefined,
    weekday: words.map((w) => WEEKDAYS.find(([re]) => re.test(clean(w.text)))?.[1]).find((d) => d),
  };
}

/** The share of dark pixels in a box of the cleaned page. */
function inkIn(img: GrayImage, x0: number, y0: number, x1: number, y1: number): number {
  let ink = 0;
  let all = 0;
  for (let y = Math.max(0, Math.round(y0)); y < Math.min(img.height, Math.round(y1)); y++) {
    for (let x = Math.max(0, Math.round(x0)); x < Math.min(img.width, Math.round(x1)); x++) {
      all++;
      if (img.data[y * img.width + x] === 0) ink++;
    }
  }
  return all ? ink / all : 0;
}

/**
 * The days by the table's printed rows: the rows between the header and the
 * totals; a row with something in its date part (date, weekday, schedule –
 * every date of the period has one) starts a day, the rows after it without
 * are its further stamp pairs. The day-rows are then matched to the period's
 * dates in order, the dates and weekdays that were read deciding where the
 * count of rows doesn't come out even. Null when the rules weren't found.
 */
function byRules(
  words: OcrWord[],
  width: number,
  { clean: img, rules }: TimecardLayout,
  {
    from,
    to,
    dateEnd,
    hint,
    column,
    isHours,
  }: { from?: string; to?: string; dateEnd: number; hint?: TimecardHint; column?: (w: OcrWord) => number; isHours?: (w: OcrWord) => boolean },
): { date: string; rows: OcrWord[][]; top: number; bottom: number }[] | null {
  if (rules.length < 4) return null;
  const mid = width / 2;
  // One rule found twice (in pieces, on a photo taken at a slight angle): the longer piece.
  const sorted: Rule[] = [];
  for (const r of [...rules].sort((a, b) => ruleY(a, mid) - ruleY(b, mid))) {
    const prev = sorted[sorted.length - 1];
    if (prev && ruleY(r, mid) - ruleY(prev, mid) < width * 0.006) {
      if (r.x1 - r.x0 > prev.x1 - prev.x0) sorted[sorted.length - 1] = r;
    } else sorted.push(r);
  }
  // The table's body: the longest run of rules a row's height apart.
  const fits = (gap: number) => gap > width * 0.006 && gap < width * 0.045;
  let run: Rule[] = [];
  for (let i = 0, start = 0; i < sorted.length; i++) {
    const next = sorted[i + 1];
    if (!next || !fits(ruleY(next, mid) - ruleY(sorted[i], mid))) {
      if (i + 1 - start > run.length) run = sorted.slice(start, i + 1);
      start = i + 1;
    }
  }
  if (run.length < 4) return null;

  // The words in each row (by their middle, between the row's rules where the word is).
  const rows: OcrWord[][] = run.slice(0, -1).map(() => []);
  for (const w of words) {
    const x = centerX(w.bbox);
    const y = centerY(w.bbox);
    for (let i = 0; i < rows.length; i++) {
      if (y >= ruleY(run[i], x) && y < ruleY(run[i + 1], x)) {
        rows[i].push(w);
        break;
      }
    }
  }
  for (let i = 0; i < rows.length; i++) rows[i] = joinSplit(rows[i].sort((a, b) => a.bbox.x0 - b.bbox.x0), width);

  // The usual height of a row.
  const gaps = run
    .slice(1)
    .map((r, k) => ruleY(r, mid) - ruleY(run[k], mid))
    .sort((a, b) => a - b);
  const rowH = gaps[Math.floor(gaps.length / 2)];

  // A time read into the row above or below its own, beside a binder hole: the same time is in its
  // pair's column there (Ut and Avr Ut are the same), and its own column there is empty.
  if (column) {
    const timeAt = (r: OcrWord[], c: number) => r.find((w) => !SCHEDULE.test(clean(w.text)) && asTime(w.text) && column(w) === c);
    for (let k = 0; k < rows.length; k++) {
      for (const w of [...rows[k]]) {
        const c = asTime(w.text) && !SCHEDULE.test(clean(w.text)) ? column(w) : -1;
        if (c < 0 || timeAt(rows[k], c ^ 1)) continue;
        for (const n of [k + 1, k - 1]) {
          const pair = rows[n] && timeAt(rows[n], c ^ 1);
          if (pair && asTime(pair.text) === asTime(w.text) && !timeAt(rows[n], c)) {
            rows[k] = rows[k].filter((x) => x !== w);
            rows[n] = [...rows[n], w].sort((a, b) => a.bbox.x0 - b.bbox.x0);
            break;
          }
        }
      }
    }
  }

  // Below the header ("Datum Dag Schema …", two lines high: "Avr / In") and above the totals.
  let first = 0;
  let last = rows.length;
  rows.forEach((r, k) => {
    if (r.some((w) => /^(datum|schema)$/i.test(clean(w.text)))) first = k + 1;
  });
  if (!first) {
    for (let k = 0; k < Math.min(3, rows.length); k++) {
      if (ruleY(run[k + 1], mid) - ruleY(run[k], mid) > rowH * 1.6) {
        first = k + 1;
        break;
      }
    }
  }
  const totals = rows.findIndex((r) => r.some((w) => /^totaler$/i.test(clean(w.text))));
  if (totals >= first) last = totals;

  // The table's left edge (the rules between a day's own rows don't reach across the date part).
  const left = run.map((r) => r.x0).sort((a, b) => a - b)[Math.floor(run.length * 0.2)];
  const dayRows: { index: number; fullDate?: string; weekday?: number }[] = [];
  // The date part's middle: where its rows are measured (a tilted page's rows aren't level).
  const dateMid = (left + dateEnd) / 2;
  const dagFrom = left + (dateEnd - left) * 0.4;
  const center = (k: number) => (ruleY(run[k], dateMid) + ruleY(run[k + 1], dateMid)) / 2;

  // Each day has one line of text in the weekday and schedule columns ("Tor 12:00-12:00"), on its first
  // row. The date columns are ruled apart from the times, a little lower, and on a photo taken at a
  // slight angle the two drift apart – so the days are found by those lines of ink, not by the rules:
  // each starts the row it is level with (or just below), and the rows after it until the next are its.
  const slopes = run.map((r) => r.b).sort((a, b) => a - b);
  const slope = slopes[Math.floor(slopes.length / 2)];
  const yTop = Math.floor(ruleY(run[first], dateMid));
  const yBottom = Math.ceil(ruleY(run[last], dateMid));
  const profile: number[] = [];
  for (let y = yTop; y < yBottom; y++) {
    let ink = 0;
    for (let x = Math.round(dagFrom); x < dateEnd; x += 2) {
      const yy = Math.round(y + slope * (x - dateMid));
      if (yy >= 0 && yy < img.height && img.data[yy * img.width + x] === 0) ink++;
    }
    profile.push(ink);
  }
  const busy = ((dateEnd - dagFrom) / 2) * 0.04;
  const anchors: number[] = [];
  for (let y = 0, start = -1, quiet = 0; y <= profile.length; y++) {
    if (y < profile.length && profile[y] > busy) {
      if (start < 0) start = y;
      quiet = 0;
    } else if (start >= 0 && (++quiet > 2 || y === profile.length)) {
      const end = y - quiet;
      if (end - start >= rowH * 0.15) {
        const at = yTop + (start + end) / 2;
        if (!anchors.length || at - anchors[anchors.length - 1] > rowH * 0.5) anchors.push(at);
      }
      start = -1;
    }
  }
  const starts: number[] = [];
  if (anchors.length >= 2) {
    // How far each line of text sits from its day's first row: a worked day has its Arb Tid on that
    // row. The offset varies over the photo (the two rulings drift apart), so each line goes by the
    // offsets of the lines nearest it; then it starts the row nearest to where it says.
    const hoursRows = rows.map((r, k) => (k >= first && k < last && r.some((w) => isHours?.(w)) ? center(k) : null));
    const offsets = anchors.map((a) => {
      let best: number | null = null;
      for (const c of hoursRows) if (c !== null && Math.abs(a - c) < rowH * 1.2 && (best === null || Math.abs(a - c) < Math.abs(a - best))) best = c;
      return best === null ? null : a - best;
    });
    anchors.forEach((a, n) => {
      const near = offsets
        .map((o, m) => ({ o, d: Math.abs(m - n) }))
        .filter((x): x is { o: number; d: number } => x.o !== null)
        .sort((p, q) => p.d - q.d)
        .slice(0, 5)
        .map((x) => x.o)
        .sort((p, q) => p - q);
      const offset = near.length ? near[Math.floor(near.length / 2)] : 0;
      let row = -1;
      for (let k = first; k < last; k++) if (row < 0 || Math.abs(center(k) - (a - offset)) < Math.abs(center(row) - (a - offset))) row = k;
      if (row >= first && !starts.includes(row)) starts.push(row);
    });
  } else {
    // Without those lines: a row with ink there starts a day.
    for (let k = first; k < last; k++) {
      const top = ruleY(run[k], dateMid);
      const bottom = ruleY(run[k + 1], dateMid);
      const pad = (bottom - top) * 0.2;
      const dag = rows[k].filter((w) => centerX(w.bbox) > dagFrom && centerX(w.bbox) < dateEnd);
      if (dag.some((w) => clean(w.text).length >= 3) || inkIn(img, dagFrom, top + pad, dateEnd, bottom - pad) > 0.03) starts.push(k);
    }
  }
  starts.sort((a, b) => a - b);
  // The words in the date part go with the day whose first row they are nearest (level, or just below).
  // (By the lines of text when they were found: each word to the nearest.)
  const dateWords: OcrWord[][] = starts.map(() => []);
  const lineOf = anchors.length >= 2 && anchors.length === starts.length ? anchors : starts.map(center);
  for (const w of words) {
    if (centerX(w.bbox) >= dateEnd) continue;
    const y = centerY(w.bbox) - slope * (centerX(w.bbox) - dateMid);
    if (y < yTop || y > yBottom) continue;
    let best = -1;
    lineOf.forEach((a, n) => {
      if (best < 0 || Math.abs(a - y) < Math.abs(lineOf[best] - y)) best = n;
    });
    if (best >= 0) dateWords[best].push(w);
  }
  starts.forEach((k, n) => dayRows.push({ index: k, ...dayWords(dateWords[n].sort((a, b) => a.bbox.x0 - b.bbox.x0)) }));
  if (!dayRows.length) return null;

  // The period's dates: from Fr o m to T o m; without them, the calendar month most dates read are in
  // (a card is a month; counting back from a date read is thrown off by a row taken for a day).
  // A close-up: the dates it can show.
  let start = hint?.from ?? from;
  let end = hint?.to ?? to;
  if (!start || !end) {
    const months = new Map<string, number>();
    for (const r of dayRows) if (r.fullDate) months.set(r.fullDate.slice(0, 7), (months.get(r.fullDate.slice(0, 7)) ?? 0) + 1);
    const month = (start ?? end)?.slice(0, 7) ?? [...months].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!month) return null;
    start ??= `${month}-01`;
    // The month's last day: day 0 of the next month.
    end ??= new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  }
  if (end < start) return null;
  const dates: string[] = [];
  for (let d: string = start; d <= end && dates.length < 62; d = addDay(d)) dates.push(d);

  let matched = alignDays(dayRows, dates);
  // A close-up where hardly a date was read: the part aimed at.
  const confirmed = matched.filter((d, k) => d && dayRows[k].fullDate === d).length;
  if (hint?.near && confirmed < 2) {
    const near = dates.filter((d) => d >= hint.near!.from && d <= hint.near!.to);
    if (near.length) matched = alignDays(dayRows, near);
  }
  const out: { date: string; rows: OcrWord[][]; top: number; bottom: number }[] = [];
  dayRows.forEach((r, k) => {
    const date = matched[k];
    if (!date) return;
    // Up to the next row matched to a date: a row matched to none is more of this day's.
    let next = k + 1;
    while (next < dayRows.length && !matched[next]) next++;
    const until = dayRows[next]?.index ?? last;
    out.push({
      date,
      rows: rows.slice(r.index, until),
      top: ruleY(run[r.index], mid),
      bottom: ruleY(run[until], mid),
    });
  });
  return out;
}

/**
 * Day-rows matched to dates, in order (as in aligning two sequences): each
 * row to the next date, unless the dates and weekdays read say a row is
 * extra or a date's row was missed. Undefined for a row that matches no date.
 */
export function alignDays(rows: { fullDate?: string; weekday?: number }[], dates: string[]): (string | undefined)[] {
  const m = rows.length;
  const n = dates.length;
  const SKIP_ROW = -3;
  const SKIP_DATE = -2;
  const pair = (r: { fullDate?: string; weekday?: number }, d: string) =>
    1 + (r.fullDate ? (r.fullDate === d ? 6 : -2) : 0) + (r.weekday ? (r.weekday === weekdayOf(d) ? 2 : -2) : 0);
  const score: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) score[i][0] = i * SKIP_ROW;
  for (let j = 1; j <= n; j++) score[0][j] = j * SKIP_DATE;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      score[i][j] = Math.max(score[i - 1][j - 1] + pair(rows[i - 1], dates[j - 1]), score[i - 1][j] + SKIP_ROW, score[i][j - 1] + SKIP_DATE);
    }
  }
  const out: (string | undefined)[] = new Array(m).fill(undefined);
  // Back from the end; where two matchings score the same (no dates read, weekdays a week apart), the earlier dates.
  for (let i = m, j = n; i > 0 && j >= 0; ) {
    if (j > 0 && score[i][j] === score[i][j - 1] + SKIP_DATE) j--;
    else if (j > 0 && score[i][j] === score[i - 1][j - 1] + pair(rows[i - 1], dates[j - 1])) {
      out[i - 1] = dates[j - 1];
      i--;
      j--;
    } else if (score[i][j] === score[i - 1][j] + SKIP_ROW) i--;
    else j--;
  }
  return out;
}

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Hours worked by a set of stamp pairs (over midnight when out is before in). */
export function workedHours(pairs: { in: string | null; out: string | null }[]): number | null {
  let total = 0;
  for (const p of pairs) {
    if (!p.in || !p.out) return null;
    total += (minutes(p.out) - minutes(p.in) + 1440) % 1440;
  }
  return total / 60;
}

export interface CheckedDay {
  date: string;
  pairs: { in: string | null; out: string | null }[];
  /** ok: matches Arb Tid · fixed: matched after correcting a time · check: doesn't add up or can't be checked · empty: no stamps. */
  status: 'ok' | 'fixed' | 'check' | 'empty';
  /** The times that were corrected ("0:out"). */
  corrected: string[];
  worked?: number;
  note?: string;
  /** Read this many times (the same card scanned again, or in close-ups), this many of them alike. */
  reads?: number;
  agree?: number;
}

/** Digits OCR mixes up on this kind of print. */
const CONFUSED: Record<string, string[]> = { '0': ['2', '8', '1'], '2': ['0', '7'], '1': ['7', '4'], '7': ['1', '2'], '5': ['6', '3'], '6': ['5', '8'], '3': ['8', '5'], '8': ['3', '6', '0'], '4': ['1'] };

function variants(time: string): string[] {
  const out: string[] = [];
  // A narrow "1" the OCR dropped: "11:47" read as "147", which is 01:47.
  if (time[0] === '0') {
    const digits = time[1] + time.slice(3);
    for (let i = 0; i <= 3; i++) {
      const v = asTime(`${digits.slice(0, i)}1${digits.slice(i)}`);
      if (v) out.push(v);
    }
  }
  for (const i of [0, 1, 3, 4]) {
    for (const d of CONFUSED[time[i]] ?? []) {
      const v = `${time.slice(0, i)}${d}${time.slice(i + 1)}`;
      if (asTime(v)) out.push(v);
    }
  }
  return out;
}

/**
 * The day's stamps, checked against the card's Arb Tid (or Ord Tim when that
 * is all that was read). A time read wrong is corrected from the other reading
 * (In / Avr In are usually the same) or a common digit mix-up – but only when
 * exactly that one change makes the day add up.
 */
export function checkDay(day: TimecardDay): CheckedDay {
  const base = { date: day.date, worked: day.worked, note: day.note };
  if (!day.pairs.length) return { ...base, pairs: [], status: 'empty', corrected: [] };
  const target = day.worked ?? day.ordinary;
  const fits = (pairs: CheckedDay['pairs']) => {
    const h = workedHours(pairs);
    return h !== null && target !== undefined && Math.abs(h - target) <= 0.011;
  };
  const filled = day.pairs.map((p, i) => ({ in: p.in ?? day.rounded[i]?.in ?? null, out: p.out ?? day.rounded[i]?.out ?? null }));
  const filledFields = day.pairs.flatMap((p, i) => [!p.in && filled[i].in ? `${i}:in` : '', !p.out && filled[i].out ? `${i}:out` : '']).filter(Boolean);
  if (fits(day.pairs)) return { ...base, pairs: day.pairs, status: 'ok', corrected: [] };
  if (fits(filled)) return { ...base, pairs: filled, status: filledFields.length ? 'fixed' : 'ok', corrected: filledFields };

  // One time replaced, by the other reading or a digit mix-up: keep it only if just one change fits.
  const fixes: { pairs: CheckedDay['pairs']; field: string }[] = [];
  filled.forEach((p, i) => {
    for (const side of ['in', 'out'] as const) {
      const options = [day.rounded[i]?.[side], day.pairs[i]?.[side], ...(p[side] ? variants(p[side]!) : [])].filter((v): v is string => !!v && v !== p[side]);
      for (const v of new Set(options)) {
        const pairs = filled.map((q, j) => (j === i ? { ...q, [side]: v } : q));
        if (fits(pairs)) fixes.push({ pairs, field: `${i}:${side}` });
      }
    }
  });
  if (fixes.length === 1) return { ...base, pairs: fixes[0].pairs, status: 'fixed', corrected: [...new Set([...filledFields, fixes[0].field])] };

  // One time missing in both readings: worked out from the card's total, if just one minute fits.
  const missing = filled.flatMap((p, i) => (['in', 'out'] as const).filter((side) => !p[side]).map((side) => ({ i, side })));
  if (missing.length === 1 && target !== undefined) {
    const { i, side } = missing[0];
    const solutions: CheckedDay['pairs'][] = [];
    for (let m = 0; m < 1440; m++) {
      const v = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const pairs = filled.map((q, j) => (j === i ? { ...q, [side]: v } : q));
      // Within the day: no pair longer than 14 hours.
      if (fits(pairs) && pairs.every((p) => ((minutes(p.out!) - minutes(p.in!) + 1440) % 1440) <= 14 * 60)) solutions.push(pairs);
    }
    if (solutions.length === 1) return { ...base, pairs: solutions[0], status: 'fixed', corrected: [...new Set([...filledFields, `${i}:${side}`])] };
  }
  return { ...base, pairs: filled, status: 'check', corrected: [] };
}

/**
 * A day read several times (the card scanned again): the readings are put
 * to the vote. Tried on real scans of a card (14 pictures, every day checked
 * against the card): a reading that adds up to Arb Tid as read was never
 * wrong (181 of 181), one that adds up only after correcting a digit was
 * wrong 5 times in 48, and one that doesn't add up was mostly wrong. So:
 * - readings that add up as read decide; if they disagree, the user does;
 * - otherwise readings that add up after a correction, and readings with
 *   no stamps, are counted: two alike and more than any other confirm;
 * - readings that don't add up are no votes, only shown when nothing else is.
 */
export function combineReadings<T extends CheckedDay>(readings: T[]): T {
  const last = readings[readings.length - 1];
  const counts = (agree: number) => ({ reads: readings.filter((r) => r.status !== 'empty').length, agree });
  const groups = (rs: T[]) => {
    const by = new Map<string, T[]>();
    for (const r of rs) by.set(JSON.stringify(r.pairs), [...(by.get(JSON.stringify(r.pairs)) ?? []), r]);
    return [...by.values()].sort((a, b) => b.length - a.length);
  };
  const sure = groups(readings.filter((r) => r.status === 'ok'));
  if (sure.length === 1) return { ...sure[0][sure[0].length - 1], ...counts(sure[0].length), status: 'ok', corrected: [] };
  if (sure.length > 1) return { ...sure[0][sure[0].length - 1], ...counts(sure[0].length), status: 'check', corrected: [] };
  const votes = groups(readings.filter((r) => r.status === 'fixed' || r.status === 'empty'));
  const [top, rival] = votes;
  if (top) {
    const pick = top[top.length - 1];
    if (top.length >= 2 && (!rival || top.length > rival.length)) return { ...pick, ...counts(top.length), status: pick.status === 'empty' ? 'empty' : 'ok', corrected: [] };
    // One reading (or a tie): as it is when nothing contradicts it, else to the user.
    if (!rival && !readings.some((r) => r.status === 'check')) return { ...pick, ...counts(1) };
    if (!rival && pick.status === 'fixed') return { ...pick, ...counts(1) };
    return { ...pick, ...counts(1), status: 'check', corrected: [] };
  }
  const unsure = groups(readings.filter((r) => r.status === 'check'))[0];
  return unsure ? { ...unsure[unsure.length - 1], ...counts(unsure.length), status: 'check' } : { ...last, ...counts(0) };
}

/**
 * Whether the days read add up to the card's own total Arb Tid (no day
 * missed or read twice, no time read wrong). The card totals the exact
 * minutes, not each day's rounded hours, so the stamps are summed.
 */
export function addsUpToTotal(days: CheckedDay[], total: number | undefined): boolean {
  if (total === undefined) return false;
  let hours = 0;
  for (const d of days) {
    if (d.status === 'empty' || !d.pairs.length) continue;
    const h = workedHours(d.pairs);
    if (h === null) return false;
    hours += h;
  }
  return Math.abs(hours - total) < 0.006;
}

/**
 * How much ink there is in each day's Frånvaro and Avvikelse boxes (share of
 * dark pixels), on the cleaned page: handwriting the OCR can't read still
 * shows up here, so the user can be asked what it says.
 */
export function noteInk(clean: GrayImage, page: TimecardPage): Map<string, number> {
  const out = new Map<string, number>();
  const x0 = Math.round(page.notesFrom + clean.width * 0.005);
  const x1 = Math.round(clean.width * 0.95);
  for (const day of page.days) {
    // The middle of the row's height: what is left of the lines above and below stays out.
    const pad = (day.bottom - day.top) * 0.15;
    const y0 = Math.max(0, Math.round(day.top + pad));
    const y1 = Math.min(clean.height, Math.round(day.bottom - pad));
    let ink = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (clean.data[y * clean.width + x] === 0) ink++;
    out.set(day.date, ink / Math.max(1, (x1 - x0) * (y1 - y0)));
  }
  return out;
}

/** A day has a note to ask about: words read there, or ink like handwriting. */
export const hasNote = (day: TimecardDay, ink: number | undefined) => !!day.note || (ink ?? 0) > 0.012;
