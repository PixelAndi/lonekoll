import type { GrayImage } from './image.ts';
import type { ReadRow, TimeBox } from './parse.ts';
import shared from './shared-digits.json';

// The scanner learns this clock's digits. Each time a scan is saved, the
// digits of its times are cut out and kept with the value the user saved
// (corrections included). Once every digit has been seen a few times, a time
// read by the OCR is also compared digit by digit with the kept ones: a
// second, independent reader. When it reads every time the same, the frame
// counts for more and the scan finishes sooner; when it clearly reads a time
// differently, that time is marked for the user to double-check. It never
// makes a reading count for less than without it. The more scans are saved,
// the more examples there are and the better the comparison gets.

/** A digit's picture: ink 0–255 in a GLYPH_W × GLYPH_H box, scaled by its height. */
export const GLYPH_W = 16;
export const GLYPH_H = 20;

export interface GlyphSample {
  label: string;
  data: Uint8Array;
  /** Cut by checked single-character boxes or clean gaps: may be shared (see digitFile). */
  shareable?: boolean;
}

export interface DigitMemory {
  samples: GlyphSample[];
  /** Saved times the comparison was checked against, and how many it got right. */
  checked: number;
  correct: number;
}

export const EMPTY_MEMORY: DigitMemory = { samples: [], checked: 0, correct: 0 };

/** Kept per digit: the newest ones, so a changed screen or phone is learned over time. */
export const SAMPLES_PER_DIGIT = 40;
/** Examples of every digit needed before the comparison is used. */
export const MIN_SAMPLES = 2;
/** How much nearer the best digit must be than the next best (share of the next best's distance) for a time to count as read. */
const MIN_MARGIN = 0.2;
/** Clearer still before a different reading by the digits makes a time worth double-checking. */
const DOUBT_MARGIN = 0.5;


/**
 * One character only: no empty column between its ink. A cut that took in a
 * neighbour (or the colon) shows a gap, and must neither be learned from nor
 * shared, as it could show part of a time.
 */
export function singleCharacter(glyph: Uint8Array): boolean {
  const columns: number[] = [];
  for (let x = 0; x < GLYPH_W; x++) {
    let most = 0;
    for (let y = 0; y < GLYPH_H; y++) most = Math.max(most, glyph[y * GLYPH_W + x]);
    columns.push(most);
  }
  const inked = columns.map((v) => v >= 96);
  const first = inked.indexOf(true);
  const last = inked.lastIndexOf(true);
  if (first < 0) return false;
  return columns.slice(first, last + 1).every((v) => v >= 40);
}

/** The widest an OCR character box may be for one digit, and for a "1", as shares of the digits' height. */
const MAX_DIGIT_WIDTH = 1.05;
const MAX_ONE_WIDTH = 0.7;

/** Where a time's four digits sit across its box, as shares of the box's width. */
export type DigitLayout = [number, number][];

/** The digits' places in the times the OCR gave character boxes for, averaged. */
export function digitLayout(rows: ReadRow[]): DigitLayout | undefined {
  const sums = [0, 1, 2, 3].map(() => [0, 0]);
  let n = 0;
  for (const row of rows) {
    for (const box of [row.inBox, row.outBox]) {
      const digits = box?.symbols?.filter((c) => /^\d$/.test(c.text));
      if (!box || digits?.length !== 4) continue;
      const bw = box.x1 - box.x0;
      const height = box.y1 - box.y0;
      // Only times whose boxes hold one character each.
      if (bw <= 0 || digits.some((c) => c.bbox.x1 - c.bbox.x0 > (c.text === '1' ? MAX_ONE_WIDTH : MAX_DIGIT_WIDTH) * height)) continue;
      digits.forEach((c, k) => {
        sums[k][0] += (c.bbox.x0 - box.x0) / bw;
        sums[k][1] += (c.bbox.x1 - box.x0) / bw;
      });
      n++;
    }
  }
  return n ? sums.map(([a, b]) => [a / n, b / n] as [number, number]) : undefined;
}

/** How far apart the In and Ut columns are, as a share of the rows crop's width (see COLUMNS in parse.ts). */
const IN_TO_OUT = 0.69 - 0.475;

/**
 * Where a time the OCR couldn't read would be, from the times it did read
 * on the same screen: across, the same column in another row (or the other
 * column, moved by the distance between them); down, the other time in the
 * same row (or another row, moved by the row spacing). Null with too little
 * to go on.
 */
export function estimateBox(rows: ReadRow[], row: number, field: 'in' | 'out', cropWidth: number): TimeBox | null {
  const boxOf = (r: ReadRow | undefined, f: 'in' | 'out') => (f === 'in' ? r?.inBox : r?.outBox);
  const other = field === 'in' ? 'out' : 'in';
  const read = rows.flatMap((r, i) =>
    (['in', 'out'] as const).flatMap((f) => {
      const b = boxOf(r, f);
      return b ? [{ i, f, b, cy: (b.y0 + b.y1) / 2 }] : [];
    }),
  );
  if (!read.length) return null;
  // Across: the same column, or the other one moved over.
  const column = read.find((x) => x.f === field);
  const shift = (field === 'out' ? 1 : -1) * IN_TO_OUT * cropWidth;
  const across = column ? { x0: column.b.x0, x1: column.b.x1 } : { x0: read[0].b.x0 + shift, x1: read[0].b.x1 + shift };
  // Down: the same row, or the row spacing from the others.
  const sameRow = boxOf(rows[row], other);
  let cy: number;
  const height = (sameRow ?? read[0].b).y1 - (sameRow ?? read[0].b).y0;
  if (sameRow) cy = (sameRow.y0 + sameRow.y1) / 2;
  else {
    const byRow = new Map<number, number>();
    for (const x of read) byRow.set(x.i, x.cy);
    const known = [...byRow.entries()].sort((a, b) => a[0] - b[0]);
    if (known.length < 2) return null;
    const [first, last] = [known[0], known[known.length - 1]];
    const pitch = (last[1] - first[1]) / (last[0] - first[0]);
    cy = first[1] + pitch * (row - first[0]);
  }
  return { x0: across.x0, x1: across.x1, y0: cy - height / 2, y1: cy + height / 2 };
}

/**
 * The four digits of a time ("HH:MM") in its box in a crop, as pictures.
 * The OCR's own character boxes are used where it gives four digits (the
 * digits often touch at camera resolution); otherwise the box must split
 * cleanly into digit, digit, colon, digit, digit by its gaps, or, given a
 * layout (where the digits sit in other times of the same screen), is cut
 * by it. Null when none works: such times are neither learned from nor
 * compared.
 */
export function timeGlyphs(img: GrayImage, box: TimeBox, layout?: DigitLayout): Uint8Array[] | null {
  return cutTime(img, box, layout)?.glyphs ?? null;
}

/** How a time was cut into digits: by the OCR's character boxes, by the gaps, or by another time's layout. */
export type CutBy = 'symbols' | 'gaps' | 'layout';

export function cutTime(img: GrayImage, box: TimeBox, layout?: DigitLayout): { glyphs: Uint8Array[]; by: CutBy } | null {
  const pad = 2;
  const x0 = Math.max(0, Math.floor(box.x0) - pad);
  const y0 = Math.max(0, Math.floor(box.y0) - pad);
  const x1 = Math.min(img.width, Math.ceil(box.x1) + pad);
  const y1 = Math.min(img.height, Math.ceil(box.y1) + pad);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 10 || h < 6) return null;
  const cell: GrayImage = { width: w, height: h, data: new Uint8Array(w * h) };
  for (let y = 0; y < h; y++) cell.data.set(img.data.subarray((y0 + y) * img.width + x0, (y0 + y) * img.width + x1), y * w);
  // Ink is the smaller side of the midpoint between the darkest and lightest levels, whichever way round the crop is.
  const sorted = [...cell.data].sort((a, b) => a - b);
  const darkLevel = sorted[Math.floor(sorted.length * 0.05)];
  const lightLevel = sorted[Math.floor(sorted.length * 0.95)];
  if (lightLevel - darkLevel < 30) return null;
  const threshold = (darkLevel + lightLevel) / 2;
  let dark = 0;
  for (const v of cell.data) if (v < threshold) dark++;
  const inkIsDark = dark < cell.data.length / 2;
  const ink = (x: number, y: number) => {
    const v = cell.data[y * w + x];
    return inkIsDark ? v < threshold : v >= threshold;
  };
  // How much ink, 0–255, from the background's level to the ink's (blur keeps some of the shape).
  const span = lightLevel - darkLevel;
  const strength = (x: number, y: number) => {
    const v = (cell.data[y * w + x] - darkLevel) / span;
    return Math.round(255 * Math.min(1, Math.max(0, inkIsDark ? 1 - v : v)));
  };

  // The time's ink from top to bottom: every digit is framed by it.
  let top = h;
  let bottom = -1;
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = 0; x < w; x++) if (ink(x, y)) n++;
    if (n >= Math.max(2, w * 0.04)) {
      top = Math.min(top, y);
      bottom = y;
    }
  }
  if (bottom - top < 5) return null;

  const digits = box.symbols?.filter((c) => /^\d$/.test(c.text));
  if (digits?.length === 4) {
    // An OCR box can take in a neighbour or the colon too: a digit is narrower than it is tall. Else try the gaps.
    const inkHeight = bottom - top + 1;
    const narrow = digits.every((c) => c.bbox.x1 - c.bbox.x0 <= (c.text === '1' ? MAX_ONE_WIDTH : MAX_DIGIT_WIDTH) * inkHeight);
    const cut = narrow ? digits.map((c) => glyph(strength, Math.max(0, Math.floor(c.bbox.x0) - x0), Math.min(w - 1, Math.ceil(c.bbox.x1) - x0 - 1), top, bottom)) : null;
    if (cut?.every(singleCharacter)) return { glyphs: cut, by: 'symbols' };
  }

  // Where the digits sit in other times on the screen, for digits that run into each other.
  const byLayout = () => {
    if (!layout) return null;
    const bw = box.x1 - box.x0;
    const col = (x: number) => Math.min(w - 1, Math.max(0, Math.round(box.x0 + x * bw) - x0));
    const cut = layout.map(([from, to]) => glyph(strength, col(from), col(to), top, bottom));
    return cut.every(singleCharacter) ? { glyphs: cut, by: 'layout' as const } : null;
  };

  // Columns with ink, grouped into runs: the characters.
  const minInk = Math.max(1, Math.round(h * 0.06));
  const runs: { from: number; to: number }[] = [];
  for (let x = 0; x < w; x++) {
    let n = 0;
    for (let y = 0; y < h; y++) if (ink(x, y)) n++;
    if (n < minInk) continue;
    const last = runs[runs.length - 1];
    if (last && last.to === x - 1) last.to = x;
    else runs.push({ from: x, to: x });
  }
  if (runs.length !== 5) return byLayout();
  const widths = runs.map((r) => r.to - r.from + 1);
  const digitWidth = Math.max(widths[0], widths[1], widths[3], widths[4]);
  // The colon is the narrow one in the middle: two dots, with a gap between them.
  if (widths[2] > digitWidth * 0.6) return byLayout();
  const colonRows: boolean[] = [];
  for (let y = 0; y < h; y++) {
    let any = false;
    for (let x = runs[2].from; x <= runs[2].to && !any; x++) any = ink(x, y);
    colonRows.push(any);
  }
  const first = colonRows.indexOf(true);
  const last = colonRows.lastIndexOf(true);
  if (first < 0 || !colonRows.slice(first, last + 1).includes(false)) return byLayout();
  return { glyphs: [runs[0], runs[1], runs[3], runs[4]].map((run) => glyph(strength, run.from, run.to, top, bottom)), by: 'gaps' };
}

/**
 * The ink between two columns as a digit picture, framed the same way for
 * every digit: those columns across, the whole time's ink from top to bottom
 * (a digit's own ink would frame a "0" with a faint top differently).
 */
function glyph(strength: (x: number, y: number) => number, from: number, to: number, top: number, bottom: number): Uint8Array {
  const out = new Uint8Array(GLYPH_W * GLYPH_H);
  const gw = to - from + 1;
  const gh = bottom - top + 1;
  for (let y = 0; y < GLYPH_H; y++) {
    for (let x = 0; x < GLYPH_W; x++) {
      // The average over the source pixels this one covers.
      const sx0 = from + (x * gw) / GLYPH_W;
      const sx1 = from + ((x + 1) * gw) / GLYPH_W;
      const sy0 = top + (y * gh) / GLYPH_H;
      const sy1 = top + ((y + 1) * gh) / GLYPH_H;
      let sum = 0;
      let n = 0;
      for (let sy = Math.floor(sy0); sy < Math.max(Math.floor(sy0) + 1, Math.ceil(sy1)); sy++) {
        for (let sx = Math.floor(sx0); sx < Math.max(Math.floor(sx0) + 1, Math.ceil(sx1)); sx++) {
          sum += strength(sx, sy);
          n++;
        }
      }
      out[y * GLYPH_W + x] = Math.round(sum / n);
    }
  }
  return out;
}

const distance = (a: Uint8Array, b: Uint8Array) => {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += (a[i] - b[i]) ** 2;
  return d;
};

/** Every digit has been seen often enough to compare with. */
export function memoryReady(memory: DigitMemory): boolean {
  const counts = new Map<string, number>();
  for (const s of memory.samples) counts.set(s.label, (counts.get(s.label) ?? 0) + 1);
  return [...'0123456789'].every((d) => (counts.get(d) ?? 0) >= MIN_SAMPLES);
}

/** How many of the ten digits have been seen often enough. */
export function digitsLearned(memory: DigitMemory): number {
  const counts = new Map<string, number>();
  for (const s of memory.samples) counts.set(s.label, (counts.get(s.label) ?? 0) + 1);
  return [...'0123456789'].filter((d) => (counts.get(d) ?? 0) >= MIN_SAMPLES).length;
}

/** The nearest kept digit and how clear that is: 0 = another digit is as near, 1 = nothing else is near. */
function classify(glyph: Uint8Array, memory: DigitMemory): { digit: string; margin: number } | null {
  const best = new Map<string, number>();
  for (const s of memory.samples) {
    const d = distance(glyph, s.data);
    if (d < (best.get(s.label) ?? Infinity)) best.set(s.label, d);
  }
  const [first, second] = [...best.entries()].sort((a, b) => a[1] - b[1]);
  if (!first) return null;
  return { digit: first[0], margin: second ? (second[1] - first[1]) / Math.max(1, second[1]) : 1 };
}

/** A time read from its digits by comparing them with the kept ones, and how clear its least clear digit was. */
export function readTimeDetailed(img: GrayImage, box: TimeBox, memory: DigitMemory, layout?: DigitLayout): { value: string; margin: number } | null {
  const glyphs = timeGlyphs(img, box, layout);
  if (!glyphs) return null;
  const digits = glyphs.map((g) => classify(g, memory));
  if (digits.some((d) => d === null)) return null;
  const [a, b, c, d] = digits as { digit: string; margin: number }[];
  return { value: `${a.digit}${b.digit}:${c.digit}${d.digit}`, margin: Math.min(a.margin, b.margin, c.margin, d.margin) };
}

/** A time read from its digits; null unless every digit is clear. */
export function readTimeByGlyphs(img: GrayImage, box: TimeBox, memory: DigitMemory, layout?: DigitLayout): string | null {
  const read = readTimeDetailed(img, box, memory, layout);
  return read && read.margin >= MIN_MARGIN ? read.value : null;
}

export type GlyphCheck = 'agree' | 'unsure';

export interface RowsCheck {
  /** Every time was read clearly by the digits too, the same as by the OCR. */
  verdict: GlyphCheck;
  /** Times the digits very clearly read differently (one digit off, as an OCR misread is), as "row:field". */
  doubts: string[];
}

/**
 * Compares the OCR's times with the digits' own reading. Before every digit
 * has been learned there is nothing to compare with ('unsure', no doubts).
 */
export function checkRows(rows: ReadRow[], crop: GrayImage | undefined, memory: DigitMemory): RowsCheck {
  if (!crop || !memoryReady(memory)) return { verdict: 'unsure', doubts: [] };
  const layout = digitLayout(rows);
  let agreed = 0;
  let unsure = false;
  const doubts: string[] = [];
  rows.forEach((row, i) => {
    for (const field of ['in', 'out'] as const) {
      const value = row[field];
      const box = row[field === 'in' ? 'inBox' : 'outBox'];
      if (!value) continue;
      const own = box ? readTimeDetailed(crop, box, memory, layout) : null;
      if (own && own.value === value && own.margin >= MIN_MARGIN) {
        agreed++;
        continue;
      }
      unsure = true;
      // More than one digit off is a bad cut rather than a misread.
      const off = own ? [...own.value].filter((ch, k) => ch !== value[k]).length : 0;
      if (own && off === 1 && own.margin >= DOUBT_MARGIN) doubts.push(`${i}:${field}`);
    }
  });
  return { verdict: !unsure && agreed > 0 ? 'agree' : 'unsure', doubts };
}

/** What a scan leaves to learn from: the rows crop it was read from and where each time was. */
export interface LearnMaterial {
  crop: GrayImage;
  rows: ReadRow[];
}

/**
 * Learns from a saved scan: the digits of each time are kept with the value
 * the user saved for it. Also counts how often the digits' own reading was
 * right, to show how far the learning has come.
 */
export function learn(memory: DigitMemory, material: LearnMaterial, saved: { in: string | null; out: string | null }[]): DigitMemory {
  // Only when the rows still line up with what was read (none added or removed).
  if (saved.length !== material.rows.length) return memory;
  const ready = memoryReady(memory);
  let { checked, correct } = memory;
  const added: GlyphSample[] = [];
  const layout = digitLayout(material.rows);
  material.rows.forEach((row, i) => {
    for (const field of ['in', 'out'] as const) {
      const value = saved[i][field];
      if (!value || !/^\d\d:\d\d$/.test(value)) continue;
      const labels = value.replace(':', '');
      let box = row[field === 'in' ? 'inBox' : 'outBox'];
      if (box) {
        if (ready) {
          checked++;
          if (readTimeByGlyphs(material.crop, box, memory, layout) === value) correct++;
        }
        // Where the OCR's characters were used to cut the digits, they must be the saved digits but for one
        // (a corrected digit): more differences mean the cut is off, and it would teach the wrong shapes.
        const read = box.symbols?.filter((c) => /^\d$/.test(c.text)).map((c) => c.text);
        if (read?.length === 4 && read.filter((d, k) => d !== labels[k]).length > 1) continue;
      } else {
        // A time the OCR couldn't read, typed in by the user: learn its digits where it should be on the screen.
        box = estimateBox(material.rows, i, field, material.crop.width) ?? undefined;
        if (!box) continue;
      }
      // A checked cut by the OCR's boxes or the gaps; by the layout of the other times only once its digits can be checked.
      const cut = cutTime(material.crop, { ...box, symbols: row[field === 'in' ? 'inBox' : 'outBox'] ? box.symbols : undefined }) ??
        (ready ? cutTime(material.crop, { ...box, symbols: undefined }, layout) : null);
      if (!cut) continue;
      // A cut by the layout or a guessed place may be off: at least half the digits must look like the saved ones.
      const guessed = cut.by === 'layout' || !row[field === 'in' ? 'inBox' : 'outBox'];
      if (guessed && ready && cut.glyphs.filter((g, k) => classify(g, memory)?.digit === labels[k]).length < 2) continue;
      // Only checked single-character cuts may ever be shared.
      cut.glyphs.forEach((data, k) => added.push({ label: labels[k], data, shareable: cut.by !== 'layout' || undefined }));
    }
  });
  if (!added.length && checked === memory.checked) return memory;
  // Newest first; keep the newest SAMPLES_PER_DIGIT of each digit.
  const all = [...added.reverse(), ...memory.samples];
  const kept = new Map<string, number>();
  const samples = all.filter((s) => {
    const n = kept.get(s.label) ?? 0;
    kept.set(s.label, n + 1);
    return n < SAMPLES_PER_DIGIT;
  });
  return { samples, checked, correct };
}

/**
 * Digit samples as a file to share: the small pictures of single digits and
 * which digit each is, in shuffled order, so no times, dates or names can be
 * put back together from them.
 */
export interface DigitFile {
  format: 'lonekoll-digits';
  version: 1;
  width: number;
  height: number;
  samples: { d: string; px: string }[];
}

const toBase64 = (data: Uint8Array) => btoa(String.fromCharCode(...data));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** The samples that may be shared: cut by checked single-character boxes or clean gaps. */
export function shareableSamples(memory: DigitMemory): GlyphSample[] {
  return memory.samples.filter((s) => s.shareable && singleCharacter(s.data));
}

export function digitFile(memory: DigitMemory): DigitFile {
  const samples = shareableSamples(memory).map((s) => ({ d: s.label, px: toBase64(s.data) }));
  for (let i = samples.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [samples[i], samples[j]] = [samples[j], samples[i]];
  }
  return { format: 'lonekoll-digits', version: 1, width: GLYPH_W, height: GLYPH_H, samples };
}

export function readDigitFile(file: DigitFile): GlyphSample[] {
  if (file.format !== 'lonekoll-digits' || file.width !== GLYPH_W || file.height !== GLYPH_H) return [];
  return file.samples
    .filter((s) => /^\d$/.test(s.d))
    .map((s) => ({ label: s.d, data: fromBase64(s.px) }))
    .filter((s) => s.data.length === GLYPH_W * GLYPH_H);
}

/** Samples shared by other users and built into the app, so the scanner knows the clock's digits from the start. */
const SHARED = readDigitFile(shared as DigitFile);

/** The user's own samples with the shared ones: what the scanner compares with. */
export function withShared(memory: DigitMemory): DigitMemory {
  return SHARED.length ? { ...memory, samples: [...memory.samples, ...SHARED] } : memory;
}
