import { binarize, type GrayImage } from './image.ts';
import type { OcrWord } from './parse.ts';

// Reading a printed timecard (tidkort) from the time clock's system: one page
// per month with a row per day – Datum, Dag, Schema, In, Avr In, In Typ, Ut,
// Avr Ut, Ut Typ, … Arb Tid, Ord Tim, OB1, Frånvaro, Avvikelse – and a second
// row for a second stamp pair. The table's lines are removed before the text
// is read; each day is then checked against the card's own Arb Tid.

type Box = OcrWord['bbox'];

/** Black text on white, with the table's lines removed (they confuse the OCR and look like notes). */
export function cleanTimecard(gray: GrayImage): GrayImage {
  const bin = binarize(gray, false, 31, 12);
  const { width: w, height: h } = bin;
  const line = new Uint8Array(w * h);
  // A run of ink longer than a couple of characters is a line, not text.
  const maxRunX = Math.round(w * 0.02);
  const maxRunY = Math.round(h * 0.016);
  for (let y = 0; y < h; y++) {
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const ink = x < w && bin.data[y * w + x] === 0;
      if (ink && start < 0) start = x;
      if (!ink && start >= 0) {
        if (x - start > maxRunX) for (let i = start; i < x; i++) line[y * w + i] = 1;
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
  return { width: w, height: h, data: out };
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
  const m = /^(\d{1,2})[,.](\d{2})$/.exec(t) ?? /^(\d)(\d{2})$/.exec(t);
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
  return out.map((l) => l.words.sort((a, b) => a.bbox.x0 - b.bbox.x0));
}

/** The x-centres of the time columns (In, Avr In, Ut, Avr Ut), from where times were found. */
function timeColumns(xs: number[], width: number): number[] {
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

function addDay(date: string, n = 1): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const weekdayOf = (date: string) => ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

export function parseTimecard(words: OcrWord[], width: number): TimecardPage {
  const all = lines(words, width);
  const header = (re: RegExp) => words.find((w) => re.test(clean(w.text)));

  // The period: "Fr o m: 2023-08-01" and "T o m: 2023-08-31".
  let from: string | undefined;
  let to: string | undefined;
  for (const line of all) {
    const text = line.map((w) => w.text).join(' ');
    from ??= /fr\s*o\s*m:?\s*(20\d{2}-\d{2}-\d{2})/i.exec(text)?.[1];
    to ??= /t\s*o\s*m:?\s*(20\d{2}-\d{2}-\d{2})/i.exec(text)?.[1];
  }

  // Columns: the times from where they were found; Arb Tid, Ord Tim and Frånvaro from the header when it was read.
  const timeWords = all.flat().filter((w) => asTime(w.text) && !SCHEDULE.test(w.text));
  const columns = timeColumns(
    timeWords.map((w) => centerX(w.bbox)),
    width,
  );
  const afterTimes = (columns[3] ?? width * 0.55) + width * 0.03;
  const arb = header(/^arb$/i);
  const ord = header(/^ord$/i);
  const notesFrom = header(/^fr[åa]nvaro/i)?.bbox.x0 ?? width * 0.82;
  const column = (w: OcrWord) => {
    if (columns.length !== 4) return -1;
    let best = 0;
    for (let i = 1; i < 4; i++) if (Math.abs(centerX(w.bbox) - columns[i]) < Math.abs(centerX(w.bbox) - columns[best])) best = i;
    return Math.abs(centerX(w.bbox) - columns[best]) < width * 0.03 ? best : -1;
  };
  const near = (w: OcrWord, h: OcrWord | undefined) => !!h && Math.abs(w.bbox.x0 - h.bbox.x0) < width * 0.04;

  const page: TimecardPage = { from, to, days: [], notesFrom };
  let current: TimecardDay | null = null;
  for (const line of all) {
    const texts = line.map((w) => clean(w.text));
    // The totals below the table end it.
    if (texts.some((t) => /^totaler$/i.test(t))) break;
    if (from && line.every((w) => w.bbox.y1 < (words.find((x) => x.text.includes(from!))?.bbox.y1 ?? 0) + 5)) continue;

    const left = line.filter((w) => w.bbox.x0 < width * 0.3);
    const fullDate = left.map((w) => FULL_DATE.exec(clean(w.text))).find((m) => m);
    const dateLike = left.some((w) => /\d{2}-\d{2}$|^20\d{2}/.test(clean(w.text)));
    const weekday = left.map((w) => WEEKDAYS.find(([re]) => re.test(clean(w.text)))?.[1]).find((d) => d);
    const startsDay = !!fullDate || dateLike || !!weekday || line.some((w) => SCHEDULE.test(clean(w.text)) && w.bbox.x0 < width * 0.3);
    const top = Math.min(...line.map((w) => w.bbox.y0));
    const bottom = Math.max(...line.map((w) => w.bbox.y1));

    if (startsDay) {
      // Every date of the period has a row, in order: count on from the last one, and let a
      // date that was read whole (within the period, after the last) or the weekday correct it.
      const expected: string | undefined = current ? addDay(current.date) : from;
      let date: string | undefined = expected;
      const read = fullDate ? `${fullDate[1]}-${fullDate[2]}-${fullDate[3]}` : undefined;
      if (read && (!current || read > current.date) && (!from || read >= from) && (!to || read <= to)) date = read;
      else if (weekday && expected && weekdayOf(expected) !== weekday) {
        for (let k = 1; k <= 3; k++) if (weekdayOf(addDay(expected, k)) === weekday) date = addDay(expected, k);
      }
      if (!date || (to && date > to)) continue;
      current = { date, pairs: [], rounded: [], top, bottom };
      page.days.push(current);
    } else if (!current) {
      continue;
    }
    current.bottom = Math.max(current.bottom, bottom);

    // The times in their columns: In, Avr In, Ut, Avr Ut.
    const cells: (string | null)[] = [null, null, null, null];
    for (const w of line) {
      const time = !SCHEDULE.test(clean(w.text)) ? asTime(w.text) : null;
      const c = time ? column(w) : -1;
      if (time && c >= 0) cells[c] = time;
      if (centerX(w.bbox) > afterTimes && centerX(w.bbox) < notesFrom) {
        const hours = asHours(w.text);
        if (hours !== null) {
          // Arb Tid comes before Ord Tim; by the header when it was read.
          const isArb = arb ? near(w, arb) : current.worked === undefined;
          const isOrd = ord ? near(w, ord) : !isArb && current.ordinary === undefined;
          if (isArb && current.worked === undefined) current.worked = hours;
          else if (isOrd && current.ordinary === undefined) current.ordinary = hours;
        }
      }
      if (w.bbox.x0 >= notesFrom - width * 0.01 && /\p{L}{3,}/u.test(clean(w.text))) {
        current.note = `${current.note ? `${current.note} ` : ''}${clean(w.text)}`;
      }
    }
    if (cells.some((c) => c)) {
      current.pairs.push({ in: cells[0], out: cells[2] });
      current.rounded.push({ in: cells[1], out: cells[3] });
    }
  }
  return page;
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
}

/** Digits OCR mixes up on this kind of print, for a time's first digits. */
const CONFUSED: Record<string, string[]> = { '0': ['2', '8'], '2': ['0', '7'], '1': ['7', '4'], '7': ['1', '2'], '5': ['6', '3'], '6': ['5', '8'], '3': ['8', '5'], '8': ['3', '6', '0'], '4': ['1'] };

function variants(time: string): string[] {
  const out: string[] = [];
  for (const i of [0, 1, 3]) {
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
