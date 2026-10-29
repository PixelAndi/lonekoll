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
  readTimeToken,
  type OcrWord,
  type ReadingIssue,
  type ReadRow,
  type StampRow,
} from './parse.ts';

export type OcrMode = 'date' | 'dateLine' | 'dateSparse' | 'rows';

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
}

export interface PreparedCrops {
  date: GrayImage;
  rows: GrayImage;
  /** Height of the date bar in the crops' pixels. */
  barHeight: number;
  /** Turns an x in the date crop into a share of the table's width (0 = its left end). */
  dateX: (x: number) => number;
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
  /** Cut out the whole date bar, not just its middle (to see where its ends are). */
  wholeBar?: boolean;
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
  const { bias = 20, grayscale = false, rowsOffset = 0.75, targetHeight = 70, wholeBar = false } = options;
  const width = loc.right - loc.left + 1;
  const tilt = Math.abs(Math.tan(loc.angle)) * width;
  const thickness = Math.max(loc.barBottom - loc.barTop + 1 - tilt, (loc.barBottom - loc.barTop + 1) * 0.6);
  const pivot = { x: (loc.left + loc.right) / 2, y: (loc.barTop + loc.barBottom) / 2 };
  const scale = Math.min(5, Math.max(1, targetHeight / thickness));

  // The date sits mid-bar; when the bar runs off the photo's edge, look further towards that edge.
  const cutLeft = loc.left <= 2;
  const cutRight = loc.right >= img.width - 3;
  const dateFrom = wholeBar ? -0.03 : cutLeft ? 0.03 : 0.28;
  const dateTo = wholeBar ? 1.03 : cutRight ? 0.97 : 0.72;
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
  const dateX = (x: number) => dateFrom + (x - margin) / scale / width;
  const window = Math.round(thickness * scale) | 1;
  if (grayscale) {
    return {
      date: pad(dateGray, margin, 230),
      rows: pad({ ...rowsGray, data: rowsGray.data.map((v) => 255 - v) }, margin),
      barHeight: thickness * scale,
      dateX,
      table,
    };
  }
  return {
    date: pad(binarize(dateGray, false, window, bias), margin),
    rows: pad(binarize(rowsGray, true, window, bias), margin),
    barHeight: thickness * scale,
    dateX,
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
 * Where the rows start below the date bar when the table is lined up in the
 * scanner's guide: just below the column header, whose labels ("In" right
 * above the first In time) otherwise get mixed into the first row. A table
 * smaller than the guide would lose its first row this way, which is why the
 * scanner asks to come closer until the table fills the guide.
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

/** What one fast pass over a camera frame found, for the live scanner. */
export interface QuickReading {
  date: string | null;
  rows: ReadRow[];
  /** Height of the date's digits as a share of the date bar's height. */
  dateSize: number | null;
  /**
   * Where the text on the date bar ("‹‹ Föreg Dag … Nästa Dag ››") starts and
   * ends, as shares of the guide's width; about 0.03 and 0.97 when the table
   * fills the guide. Null where that end's words weren't read.
   */
  barText: { left: number | null; right: number | null };
  /** Median height of the stamp times as a share of the date bar's height. */
  timeSize: number | null;
  /** Slope of the stamp rows (dy/dx), 0 when level. */
  slope: number | null;
}

/**
 * Reads the table at a known place (the scanner's guide) with a single
 * preprocessing variant: fast enough to run on camera frames as they come.
 */
export async function quickRead(img: RGBAImage, loc: TableLocation, engine: OcrEngine): Promise<QuickReading> {
  const crops = cropsAt(img, loc, { ...VARIANTS[0], rowsOffset: GUIDED_ROWS_OFFSET, wholeBar: true });
  // The whole bar line as words: the date, and "Föreg Dag" / "Nästa Dag" at its ends.
  const lineWords = await engine.recognize(crops.date, 'dateLine');
  const left = lineWords.find((w) => /f.?reg/i.test(w.text));
  const right = [...lineWords].reverse().find((w) => /n.?sta|dag/i.test(w.text) && (w.bbox.x0 + w.bbox.x1) / 2 > crops.date.width / 2);
  const barText = { left: left ? crops.dateX(left.bbox.x0) : null, right: right ? crops.dateX(right.bbox.x1) : null };
  let dateWords = lineWords;
  if (!parseDate(dateWords).value) dateWords = await engine.recognize(crops.date, 'dateSparse');
  const rowWords = await engine.recognize(crops.rows, 'rows');
  const dateWord = dateWords.find((w) => /\d{4}-?\d{2}-?\d{2}/.test(w.text));
  const dateSize = dateWord ? (dateWord.bbox.y1 - dateWord.bbox.y0) / crops.barHeight : null;
  const timeHeights = rowWords.filter((w) => readTimeToken(w.text)).map((w) => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b);
  const timeSize = timeHeights.length ? timeHeights[Math.floor(timeHeights.length / 2)] / crops.barHeight : null;
  return { date: parseDate(dateWords).value, rows: parseRows(rowWords, crops.rows.width).value, dateSize, barText, timeSize, slope: rowSlope(rowWords) };
}

/** Median slope between time stamps on the same line, far enough apart to tell. */
function rowSlope(words: OcrWord[]): number | null {
  const times = words
    .filter((w) => readTimeToken(w.text))
    .map((w) => ({ x: (w.bbox.x0 + w.bbox.x1) / 2, y: (w.bbox.y0 + w.bbox.y1) / 2, h: w.bbox.y1 - w.bbox.y0 }));
  const slopes: number[] = [];
  for (const a of times) {
    for (const b of times) {
      const dx = b.x - a.x;
      if (dx > a.h * 4 && Math.abs(b.y - a.y) < a.h * 0.8) slopes.push((b.y - a.y) / dx);
    }
  }
  if (slopes.length === 0) return null;
  slopes.sort((p, q) => p - q);
  return slopes[Math.floor(slopes.length / 2)];
}
