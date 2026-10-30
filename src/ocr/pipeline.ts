import {
  binarize,
  channels,
  downscale,
  estimateTilt,
  extractRegion,
  locateTable,
  LOOSE,
  straighten,
  type GrayImage,
  type RGBAImage,
  type TableLocation,
} from './image.ts';
import {
  checkOrder,
  checkPlausible,
  parseDate,
  parseRows,
  type OcrWord,
  type ReadingIssue,
  type ReadRow,
  type StampRow,
} from './parse.ts';
import type { LearnMaterial } from './glyphs.ts';

export type OcrMode = 'date' | 'dateSparse' | 'rows' | 'find';

/** Wraps the OCR library; implemented with Tesseract in ./tesseract.ts. */
export interface OcrEngine {
  recognize(image: GrayImage, mode: OcrMode): Promise<OcrWord[]>;
}

export interface VotedRow extends StampRow {
  /** The readings disagreed on this time (or it was read with low confidence). */
  inUncertain?: boolean;
  outUncertain?: boolean;
}

export interface ClockReading {
  date: string | null;
  dateUncertain: boolean;
  rows: VotedRow[];
  issues: ReadingIssue[];
  /** Lowest OCR confidence (0-100) of the stamp times. */
  confidence: number;
  /** Where the stamp table is in the photo (photo pixels), to show it zoomed in. */
  table?: { left: number; top: number; width: number; height: number };
  /** From the live scanner: what to learn the clock's digits from once the times are saved (see glyphs.ts). */
  learn?: LearnMaterial;
}

export interface PreparedCrops {
  date: GrayImage;
  rows: GrayImage;
  table: NonNullable<ClockReading['table']>;
}

export interface CropOptions {
  bias?: number;
  /** Skip our binarisation and hand Tesseract an inverted grayscale image. */
  grayscale?: boolean;
  /** Where the rows start below the header, in bar heights. */
  rowsOffset?: number;
  /** Bar height in pixels to scale to before OCR. */
  targetHeight?: number;
}

/** White border; Tesseract reads text touching the image edge poorly. */
function pad(img: GrayImage, size: number, value = 255): GrayImage {
  const w = img.width + size * 2;
  const h = img.height + size * 2;
  const data = new Uint8Array(w * h).fill(value);
  for (let y = 0; y < img.height; y++) data.set(img.data.subarray(y * img.width, (y + 1) * img.width), (y + size) * w + size);
  return { width: w, height: h, data };
}

/** Finds the table in a photo by the colours of its date bar and header. */
export function findTable(photo: RGBAImage): { img: RGBAImage; loc: TableLocation; turned: number } | null {
  let img = downscale(photo, 2000);
  // The usual colours first, then the looser ones (another angle or light),
  // then the photo straightened when it was taken at a steep angle.
  let loc = locateTable(img) ?? locateTable(img, LOOSE);
  let turned = 0;
  // Row-by-row search only finds part of a strongly tilted bar.
  if (!loc || Math.abs(loc.angle) > 0.05) {
    turned = estimateTilt(img);
    if (Math.abs(turned) >= 0.01) {
      const straight = straighten(img, turned);
      const again = locateTable(straight) ?? locateTable(straight, LOOSE);
      if (again) {
        img = straight;
        loc = again;
      } else turned = 0;
    } else turned = 0;
    if (!loc) return null;
  }
  return { img, loc, turned };
}

export function prepareCrops(photo: RGBAImage, options: CropOptions = {}): PreparedCrops | null {
  const found = findTable(photo);
  return found ? cropsAt(found.img, found.loc, options, found.turned, photo.width / found.img.width) : null;
}

/**
 * Cuts the date and the stamp rows out of an image where the table's place is
 * known. `turned` is how much the image was straightened and `toPhoto` its
 * scale, to report the table's box in the original photo.
 */
export function cropsAt(img: RGBAImage, loc: TableLocation, options: CropOptions = {}, turned = 0, toPhoto = 1): PreparedCrops {
  const { bias = 20, grayscale = false, rowsOffset = 0.75, targetHeight = 70 } = options;
  const width = loc.right - loc.left + 1;
  const tilt = Math.abs(Math.tan(loc.angle)) * width;
  const thickness = loc.thickness ?? Math.max(loc.barBottom - loc.barTop + 1 - tilt, (loc.barBottom - loc.barTop + 1) * 0.6);
  const pivot = { x: (loc.left + loc.right) / 2, y: (loc.barTop + loc.barBottom) / 2 };
  const scale = Math.min(5, Math.max(1, targetHeight / thickness));

  // The date sits mid-bar; when the bar runs off the photo's edge, look further towards that edge.
  const cutLeft = loc.left <= 2;
  const cutRight = loc.right >= img.width - 3;
  const dateFrom = cutLeft ? 0.03 : 0.28;
  const dateTo = cutRight ? 0.97 : 0.72;
  const dateGray = extractRegion(
    img,
    { left: loc.left + width * dateFrom, top: pivot.y - thickness * 0.6, width: width * (dateTo - dateFrom), height: thickness * 1.2 },
    loc.angle,
    pivot,
    scale,
    channels.luminance,
  );

  // Ignore any header pixels that leak into the rows area.
  const lavender = (r: number, g: number, b: number) => b > 210 && b - g > 50 && r > 110 && r - g > -10 && g > 100;
  const pink = (r: number, g: number, b: number) => r > 150 && r - g > 30 && b - g > 20;
  const rowsChannel = (r: number, g: number, b: number) => (lavender(r, g, b) || pink(r, g, b) ? 0 : g);
  const rowsTop = pivot.y + thickness * 0.5 + thickness * rowsOffset;
  const rowsHeight = thickness * 5.5;
  const rowsGray = extractRegion(img, { left: loc.left, top: rowsTop, width, height: rowsHeight }, loc.angle, pivot, scale, rowsChannel);

  // The table's box in the photo; when the photo was straightened, the box around the turned corners.
  const top = loc.barTop - thickness * 0.3;
  const bottom = rowsTop + rowsHeight;
  const cos = Math.cos(turned);
  const sin = Math.sin(turned);
  const corners = [
    [loc.left, top],
    [loc.right, top],
    [loc.left, bottom],
    [loc.right, bottom],
  ].map(([x, y]) => {
    const ux = x - img.width / 2;
    const uy = y - img.height / 2;
    return [img.width / 2 + ux * cos - uy * sin, img.height / 2 + ux * sin + uy * cos];
  });
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const table = {
    left: Math.round(Math.max(0, Math.min(...xs)) * toPhoto),
    top: Math.round(Math.max(0, Math.min(...ys)) * toPhoto),
    width: Math.round((Math.max(...xs) - Math.max(0, Math.min(...xs))) * toPhoto),
    height: Math.round((Math.max(...ys) - Math.max(0, Math.min(...ys))) * toPhoto),
  };
  const margin = Math.round(thickness * scale * 0.3);
  const window = Math.round(thickness * scale) | 1;
  if (grayscale) {
    return {
      date: pad(dateGray, margin, 230),
      rows: pad({ ...rowsGray, data: rowsGray.data.map((v) => 255 - v) }, margin),
      table,
    };
  }
  return {
    date: pad(binarize(dateGray, false, window, bias), margin),
    rows: pad(binarize(rowsGray, true, window, bias), margin),
    table,
  };
}

/**
 * Each photo is read with several preprocessing variants and the results are
 * voted on per time. Times the variants disagree on are flagged for the user.
 */
const VARIANTS: CropOptions[] = [
  { grayscale: true, rowsOffset: 0.6 },
  { grayscale: true, rowsOffset: 0.6, targetHeight: 90 },
  { bias: 20, rowsOffset: 0.6 },
];

/**
 * Where the rows start below the date bar when the table's place is known
 * (found by the scanner): just below the column header, whose labels ("In"
 * right above the first In time) otherwise get mixed into the first row.
 */
const GUIDED_ROWS_OFFSET = 0.95;

interface VariantReading {
  date: string | null;
  rows: ReadRow[];
}

/** Most common value; ties go to the higher summed confidence, then to the earlier variant. */
function pick<T>(values: { value: T; confidence: number }[]): { value: T; unanimous: boolean } {
  const tally = new Map<string, { value: T; votes: number; confidence: number; first: number }>();
  values.forEach((v, i) => {
    const key = JSON.stringify(v.value);
    const t = tally.get(key) ?? { value: v.value, votes: 0, confidence: 0, first: i };
    t.votes++;
    t.confidence += v.confidence;
    tally.set(key, t);
  });
  const best = [...tally.values()].sort((a, b) => b.votes - a.votes || b.confidence - a.confidence || a.first - b.first)[0];
  return { value: best.value, unanimous: tally.size === 1 };
}

export function vote(readings: VariantReading[]): { date: string | null; dateUncertain: boolean; rows: VotedRow[] } {
  const dates = readings.filter((r) => r.date).map((r) => ({ value: r.date, confidence: 1 }));
  const date = dates.length ? pick(dates) : { value: null, unanimous: false };

  // Prefer readings that make sense, then the most common number of rows.
  const sensible = readings.filter((r) => checkOrder(r.rows) && checkPlausible(r.rows));
  const pool = sensible.length ? sensible : readings;
  const count = pick(pool.map((r) => ({ value: r.rows.length, confidence: 1 }))).value;
  const voters = pool.filter((r) => r.rows.length === count);

  const rows: VotedRow[] = [];
  for (let i = 0; i < count; i++) {
    const row: VotedRow = { in: null, out: null };
    for (const field of ['in', 'out'] as const) {
      const conf = field === 'in' ? 'inConfidence' : 'outConfidence';
      const picked = pick(voters.map((r) => ({ value: r.rows[i][field], confidence: r.rows[i][conf] ?? 0 })));
      row[field] = picked.value;
      const lowConfidence = voters.length === 1 && (voters[0].rows[i][conf] ?? 100) < 70;
      if (!picked.unanimous || lowConfidence) row[field === 'in' ? 'inUncertain' : 'outUncertain'] = true;
    }
    rows.push(row);
  }
  return { date: date.value, dateUncertain: !date.unanimous || dates.length < readings.length, rows };
}

/** Reads a photo of the clock; `at` gives the table's place when it is known (the scanner's guide). */
export async function readClockPhoto(photo: RGBAImage, engine: OcrEngine, at?: TableLocation): Promise<ClockReading> {
  const readings: VariantReading[] = [];
  let table: ClockReading['table'];
  let confidence = 100;
  for (const variant of VARIANTS) {
    const crops = at ? cropsAt(photo, at, { ...variant, rowsOffset: GUIDED_ROWS_OFFSET }) : prepareCrops(photo, variant);
    if (!crops) return { date: null, dateUncertain: true, rows: [], issues: ['no-table'], confidence: 0 };
    table ??= crops.table;
    let dateWords = await engine.recognize(crops.date, 'date');
    // Tesseract sometimes gives up on the whole line (e.g. "Föreg Dag" beside the date): read it as loose words instead.
    if (!parseDate(dateWords).value) dateWords = await engine.recognize(crops.date, 'dateSparse');
    const rowWords = await engine.recognize(crops.rows, 'rows');
    const rows = parseRows(rowWords, crops.rows.width);
    readings.push({ date: parseDate(dateWords).value, rows: rows.value });
    // Tesseract reports 0 confidence for the single-line date even when it is
    // right, so only the stamp times count towards the confidence.
    if (rows.value.length) confidence = Math.min(confidence, rows.confidence);
  }
  const voted = vote(readings);
  const issues: ReadingIssue[] = [];
  if (!voted.date) issues.push('no-date');
  if (voted.rows.length === 0) issues.push('no-rows');
  if (!checkOrder(voted.rows)) issues.push('out-of-order');
  if (!checkPlausible(voted.rows)) issues.push('implausible');
  return { ...voted, issues, confidence, table };
}

/** Width the camera's search area is read at when looking for the table, so the date bar's text is readable. */
const FIND_WIDTH = 1200;
/**
 * Where the words on the clock's date bar start, as shares of the table's
 * width ("Nästa" is often read only in part, so starts are used, not ends);
 * the date's digits are about 0.69 of the bar's height, and the table is about
 * 23.5 bar heights wide.
 */
const FOREG_AT = 0.101;
const NASTA_AT = 0.751;
const DATE_CENTRE_AT = 0.55;
const DATE_HEIGHT_SHARE = 0.69;
const TABLE_WIDTH_IN_BARS = 23.5;

export interface FoundTable {
  /** The table's place in the image. */
  loc: TableLocation;
  date: string | null;
  /** The stamp rows, read again on their own (digits only) where the table was found. */
  rows: ReadRow[];
  /** The search pass read the same rows: two independent readings agree. */
  confirmed: boolean;
  /** The table's width as a share of the image's width. */
  width: number;
  /** Both ends of the date bar were read (else the width is estimated from the date's size). */
  bothEnds: boolean;
  /** The date bar's height in the image's pixels: below about 24 the text is too small to read reliably. */
  barHeight: number;
  /** Where the date was read, in the image's pixels: what the next frames follow. */
  dateBox?: { x0: number; y0: number; x1: number; y1: number };
  /** Read by following the table (trackTable), not by searching for it. */
  tracked?: boolean;
  /** Set once locked on (anchorTable): what the following frames are compared with. */
  track?: Track;
  /** The crop the rows were read from (the boxes in `rows` are in its pixels). */
  rowsCrop?: GrayImage;
}

/**
 * Finds the clock's table anywhere in an image from the words on its date
 * bar: the date gives the bar's height and line, "Föreg Dag" and "Nästa Dag"
 * its ends and tilt. No colours are involved, so the table only has to be
 * roughly in view.
 */
export async function findTableByText(img: RGBAImage, engine: OcrEngine): Promise<FoundTable | null> {
  // Small camera frames (under 800 pixels across) are enlarged so the bar's text is big enough for OCR.
  const scale = img.width < 800 ? Math.min(2, 1000 / img.width) : Math.min(1, FIND_WIDTH / img.width);
  const gray = extractRegion(img, { left: 0, top: 0, width: img.width, height: img.height }, 0, { x: 0, y: 0 }, scale, channels.luminance);
  const words = (await engine.recognize(gray, 'find')).map((w) => ({
    ...w,
    bbox: { x0: w.bbox.x0 / scale, y0: w.bbox.y0 / scale, x1: w.bbox.x1 / scale, y1: w.bbox.y1 / scale },
  }));
  const dateWord = findDateWord(words);
  const foreg = words.find((w) => /f.?reg/i.test(w.text));
  if (!dateWord && !foreg) return null;
  // The bar's line: through the date, or else through "Föreg".
  const anchor = dateWord ?? foreg!;
  const cx = (anchor.bbox.x0 + anchor.bbox.x1) / 2;
  let cy = (anchor.bbox.y0 + anchor.bbox.y1) / 2;
  let thickness = (anchor.bbox.y1 - anchor.bbox.y0) / DATE_HEIGHT_SHARE;
  // Words on the same bar: close to that line (allowing for some tilt).
  const onBar = (w: OcrWord) => Math.abs((w.bbox.y0 + w.bbox.y1) / 2 - cy) < thickness * 2.5;
  const left = foreg && onBar(foreg) && (!dateWord || foreg.bbox.x1 < dateWord.bbox.x0) ? foreg : undefined;
  // The first word after the date (or "Föreg Dag") that starts like "Nästa" (sometimes only "N" is read).
  const after = dateWord ? dateWord.bbox.x1 : anchor.bbox.x1 + thickness * 3;
  const right = words
    .filter((w) => /^n/i.test(w.text.trim()) && w.bbox.x0 > after && onBar(w))
    .sort((a, b) => a.bbox.x0 - b.bbox.x0)[0];
  // Without the date the table can only be placed from both ends of the bar.
  if (!dateWord && !right) return null;
  let tableLeft: number;
  let width: number;
  let angle = 0;
  if (left && right) {
    width = (right.bbox.x0 - left.bbox.x0) / (NASTA_AT - FOREG_AT);
    // The width is measured more reliably than the date's height.
    thickness = width / TABLE_WIDTH_IN_BARS;
    tableLeft = left.bbox.x0 - width * FOREG_AT;
    // The bar's line through the middles of "Föreg" and "Nästa" (the date's box sometimes reaches into the header).
    const ly = (left.bbox.y0 + left.bbox.y1) / 2;
    const ry = (right.bbox.y0 + right.bbox.y1) / 2;
    angle = Math.atan2(ry - ly, right.bbox.x0 - left.bbox.x0);
    cy = ly + ((tableLeft + width / 2 - left.bbox.x0) / (right.bbox.x0 - left.bbox.x0)) * (ry - ly);
  } else {
    width = thickness * TABLE_WIDTH_IN_BARS;
    tableLeft = left ? left.bbox.x0 - width * FOREG_AT : right ? right.bbox.x0 - width * NASTA_AT : cx - width * DATE_CENTRE_AT;
  }
  // cropsAt takes the bar's upright bounds, which grow with the tilt.
  const reach = thickness / 2 + (Math.abs(Math.tan(angle)) * width) / 2;
  const loc: TableLocation = {
    left: tableLeft,
    right: tableLeft + width,
    barTop: cy - reach,
    barBottom: cy + reach,
    headerBottom: cy + reach + thickness * 0.9,
    angle,
    thickness,
  };
  // The times, in the table's own frame: tilt undone, x as a share of the table's width.
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const px = tableLeft + width / 2;
  const toTable = (x: number, y: number) => ({ x: px + (x - px) * cos - (y - cy) * sin - tableLeft, y: cy + (x - px) * sin + (y - cy) * cos });
  const below = words
    .map((w) => {
      const a = toTable(w.bbox.x0, w.bbox.y0);
      const b = toTable(w.bbox.x1, w.bbox.y1);
      return { ...w, text: timeLike(w.text), bbox: { x0: a.x, y0: a.y, x1: b.x, y1: b.y } };
    })
    // Below the column header, and not further down than a few rows.
    .filter((w) => w.bbox.y0 > cy + thickness * 1.2 && w.bbox.y0 < cy + thickness * 8 && w.bbox.x0 > -width * 0.02 && w.bbox.x1 < width * 1.02);
  if (!dateWord) {
    // Found from the bar's ends only: the text is there but too small or blurred to read the date.
    return { loc, date: null, rows: [], confirmed: false, width: width / img.width, bothEnds: true, barHeight: thickness };
  }
  const passRows = parseRows(below, width).value;
  // The rows once more, cut out where the table is and read as digits only.
  const crops = cropsAt(img, loc, { ...VARIANTS[0], rowsOffset: GUIDED_ROWS_OFFSET });
  const rows = parseRows(await engine.recognize(crops.rows, 'rows'), crops.rows.width).value;
  const same = (a: ReadRow[], b: ReadRow[]) => a.length === b.length && a.every((r, i) => r.in === b[i].in && r.out === b[i].out);
  return {
    loc,
    date: parseDate([dateWord]).value,
    rows,
    confirmed: same(rows, passRows),
    width: width / img.width,
    bothEnds: !!(left && right),
    barHeight: thickness,
    dateBox: dateWord.bbox,
    rowsCrop: crops.rows,
  };
}

/** Preprocessing for the rows while following the table (binarising reads these crops poorly). */
const TRACK_CROP: CropOptions = { grayscale: true, targetHeight: 56, rowsOffset: GUIDED_ROWS_OFFSET };
/** Tracked frames in a row before the table is searched for again, to catch a phone moved closer or further. */
export const TRACK_FRAMES = 6;
/** How far (in bar heights) the table may move between frames and still be followed. */
const TRACK_REACH = 1.5;
/** Below this match the patch isn't there any more (moved too much, turned, or another day shown). */
const TRACK_MIN_MATCH = 0.75;

/** A table being followed from the frame it was locked on in. */
export interface Track {
  /** The table's place when locked on. */
  loc: TableLocation;
  /** Grey patch around the date then, sampled every `step` pixels, and its top-left corner in the image. */
  patch: GrayImage;
  step: number;
  /** The same patch at full resolution, to place it to the pixel. */
  fine: GrayImage;
  left: number;
  top: number;
  /** How far the table has moved since, in the latest frame. */
  dx: number;
  dy: number;
  /** Frames followed since the search. */
  frames: number;
}

/** Luminance of an upright box of the image, sampled every `step` pixels (averaging each step × step cell). */
function greyBox(img: RGBAImage, left: number, top: number, width: number, height: number, step: number): GrayImage {
  const w = Math.max(1, Math.floor(width / step));
  const h = Math.max(1, Math.floor(height / step));
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let n = 0;
      for (let j = 0; j < step; j++) {
        const sy = Math.round(top) + y * step + j;
        if (sy < 0 || sy >= img.height) continue;
        for (let i = 0; i < step; i++) {
          const sx = Math.round(left) + x * step + i;
          if (sx < 0 || sx >= img.width) continue;
          const k = (sy * img.width + sx) * 4;
          sum += 0.299 * img.data[k] + 0.587 * img.data[k + 1] + 0.114 * img.data[k + 2];
          n++;
        }
      }
      data[y * w + x] = n ? Math.round(sum / n) : 0;
    }
  }
  return { width: w, height: h, data };
}

/** Normalised cross-correlation of `patch` placed at (ox, oy) in `area`: 1 = the same picture. */
function match(area: GrayImage, patch: GrayImage, ox: number, oy: number): number {
  const n = patch.width * patch.height;
  let sa = 0;
  let sp = 0;
  let saa = 0;
  let spp = 0;
  let sap = 0;
  for (let y = 0; y < patch.height; y++) {
    const ar = (oy + y) * area.width + ox;
    const pr = y * patch.width;
    for (let x = 0; x < patch.width; x++) {
      const a = area.data[ar + x];
      const p = patch.data[pr + x];
      sa += a;
      sp += p;
      saa += a * a;
      spp += p * p;
      sap += a * p;
    }
  }
  const va = saa - (sa * sa) / n;
  const vp = spp - (sp * sp) / n;
  return va > 0 && vp > 0 ? (sap - (sa * sp) / n) / Math.sqrt(va * vp) : 0;
}

/** Best place for `patch` in `area` among the offsets given, and how well it matches there. */
function bestMatch(area: GrayImage, patch: GrayImage, xs: number[], ys: number[]) {
  let best = { x: 0, y: 0, score: -1 };
  for (const y of ys) {
    for (const x of xs) {
      if (x < 0 || y < 0 || x + patch.width > area.width || y + patch.height > area.height) continue;
      const score = match(area, patch, x, y);
      if (score > best.score) best = { x, y, score };
    }
  }
  return best;
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/**
 * Starts following a table found by the search pass: keeps a grey patch of
 * the date bar around the date, to find again in the following frames.
 */
export function anchorTable(img: RGBAImage, found: FoundTable): FoundTable | null {
  const box = found.dateBox;
  if (!box) return null;
  const thickness = found.loc.thickness ?? found.barHeight;
  // Sampled so the bar is about 12 pixels high: plenty to match on, quick to compare.
  const step = Math.max(1, Math.round(thickness / 12));
  const left = box.x0 - thickness * 0.5;
  const top = (box.y0 + box.y1) / 2 - thickness * 0.6;
  const patch = greyBox(img, left, top, box.x1 - box.x0 + thickness, thickness * 1.2, step);
  const fine = greyBox(img, left, top, patch.width * step, patch.height * step, 1);
  return { ...found, track: { loc: found.loc, patch, step, fine, left, top, dx: 0, dy: 0, frames: 0 } };
}

/**
 * Follows a locked-on table instead of searching the whole image again: the
 * date's patch is looked for near where it was in the frame before (by
 * comparing pixels), and only the date and the rows are read where it is
 * now. Much quicker than the search pass. Null when the patch isn't found
 * (the phone moved too much), the date is another one, or after
 * TRACK_FRAMES frames: search again then.
 */
export async function trackTable(img: RGBAImage, prev: FoundTable, engine: OcrEngine): Promise<FoundTable | null> {
  const track = prev.track;
  if (!track || track.frames >= TRACK_FRAMES) return null;
  const { patch, step } = track;
  const thickness = track.loc.thickness ?? prev.barHeight;
  // Search around where it was in the frame before, roughly first and then to the pixel.
  const reach = Math.ceil((thickness * TRACK_REACH) / step);
  const areaLeft = track.left + track.dx - reach * step;
  const areaTop = track.top + track.dy - reach * step;
  const area = greyBox(img, areaLeft, areaTop, (patch.width + reach * 2) * step, (patch.height + reach * 2) * step, step);
  const rough = bestMatch(area, patch, range(0, reach * 2), range(0, reach * 2));
  if (rough.score < TRACK_MIN_MATCH) return null;
  let dx = areaLeft + rough.x * step - track.left;
  let dy = areaTop + rough.y * step - track.top;
  if (step > 1) {
    // Then to the pixel, with the full-resolution patch around the rough place.
    const fine = track.fine;
    const near = greyBox(img, track.left + dx - step, track.top + dy - step, fine.width + step * 2, fine.height + step * 2, 1);
    const best = bestMatch(near, fine, range(0, step * 2), range(0, step * 2));
    dx += best.x - step;
    dy += best.y - step;
  }
  const at = track.loc;
  const loc: TableLocation = {
    ...at,
    left: at.left + dx,
    right: at.right + dx,
    barTop: at.barTop + dy,
    barBottom: at.barBottom + dy,
    headerBottom: at.headerBottom + dy,
  };
  // The date is read too (a small strip, digits only): a day changed on the clock looks much the same as a patch.
  const box = prev.dateBox!;
  const scale = Math.min(5, Math.max(0.5, 70 / thickness));
  const margin = Math.round(thickness * scale * 0.3);
  const strip = extractRegion(
    img,
    { left: box.x0 + dx - thickness * 0.5, top: (box.y0 + box.y1) / 2 + dy - thickness * 0.6, width: box.x1 - box.x0 + thickness, height: thickness * 1.2 },
    0,
    { x: 0, y: 0 },
    scale,
    channels.luminance,
  );
  const dateWord = findDateWord(await engine.recognize(pad(strip, margin, 230), 'dateSparse'));
  if (!dateWord || parseDate([dateWord]).value !== prev.date) return null;
  const crop = cropsAt(img, loc, TRACK_CROP).rows;
  const rows = parseRows(await engine.recognize(crop, 'rows'), crop.width).value;
  return {
    ...prev,
    loc,
    rows,
    // One reading, not two: it counts for less towards the agreement (see live.ts).
    confirmed: true,
    tracked: true,
    track: { ...track, dx, dy, frames: track.frames + 1 },
    rowsCrop: crop,
  };
}

/** The date on the bar, also when it was read as two or three pieces ("2026-1", "0-29"). */
function findDateWord(words: OcrWord[]): OcrWord | null {
  const pattern = /20\d{2}-?\d{2}-?\d{2}/;
  for (let i = 0; i < words.length; i++) {
    for (let n = 1; n <= 3 && i + n <= words.length; n++) {
      const parts = words.slice(i, i + n);
      // Pieces of one word sit side by side on the same line.
      const sameLine = parts.every((p) => Math.abs(p.bbox.y0 - parts[0].bbox.y0) < (parts[0].bbox.y1 - parts[0].bbox.y0) * 0.5);
      const text = parts.map((p) => p.text.trim()).join('');
      if (sameLine && pattern.test(text)) {
        return {
          text: text.match(pattern)![0],
          confidence: Math.min(...parts.map((p) => p.confidence)),
          bbox: {
            x0: Math.min(...parts.map((p) => p.bbox.x0)),
            y0: Math.min(...parts.map((p) => p.bbox.y0)),
            x1: Math.max(...parts.map((p) => p.bbox.x1)),
            y1: Math.max(...parts.map((p) => p.bbox.y1)),
          },
        };
      }
    }
  }
  return null;
}

/** Letters the search pass sometimes reads for digits in a time ("l4:3O" → "14:30"). */
function timeLike(text: string): string {
  const t = text.trim();
  if (!/^[0-9OoIl|SB:.;xX×]{3,5}$/.test(t) || /^[xX×:.;]+$/.test(t)) return t;
  return t.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8');
}
