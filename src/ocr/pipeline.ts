import {
  binarize,
  channels,
  downscale,
  extractRegion,
  locateTable,
  type GrayImage,
  type RGBAImage,
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

export type OcrMode = 'date' | 'rows';

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

export function prepareCrops(photo: RGBAImage, options: CropOptions = {}): PreparedCrops | null {
  const { bias = 20, grayscale = false, rowsOffset = 0.75, targetHeight = 70 } = options;
  const img = downscale(photo, 2000);
  const loc = locateTable(img);
  if (!loc) return null;
  const width = loc.right - loc.left + 1;
  const tilt = Math.abs(Math.tan(loc.angle)) * width;
  const thickness = Math.max(loc.barBottom - loc.barTop + 1 - tilt, (loc.barBottom - loc.barTop + 1) * 0.6);
  const pivot = { x: (loc.left + loc.right) / 2, y: (loc.barTop + loc.barBottom) / 2 };
  const scale = Math.min(3, Math.max(1, targetHeight / thickness));

  const dateGray = extractRegion(
    img,
    { left: loc.left + width * 0.28, top: pivot.y - thickness * 0.6, width: width * 0.44, height: thickness * 1.2 },
    loc.angle,
    pivot,
    scale,
    channels.luminance,
  );

  // Ignore any lavender header pixels that leak into the rows area.
  const rowsChannel = (r: number, g: number, b: number) =>
    b > 210 && b - g > 50 && r > 110 && r - g > -10 && g > 100 ? 0 : g;
  const rowsTop = pivot.y + thickness * 0.5 + thickness * rowsOffset;
  const rowsHeight = thickness * 5.5;
  const rowsGray = extractRegion(img, { left: loc.left, top: rowsTop, width, height: rowsHeight }, loc.angle, pivot, scale, rowsChannel);

  const toPhoto = photo.width / img.width;
  const table = {
    left: Math.round(loc.left * toPhoto),
    top: Math.round((loc.barTop - thickness * 0.3) * toPhoto),
    width: Math.round(width * toPhoto),
    height: Math.round((rowsTop + rowsHeight - loc.barTop + thickness * 0.3) * toPhoto),
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
  { grayscale: true, rowsOffset: 0.85 },
  { grayscale: true, rowsOffset: 0.85, targetHeight: 90 },
  { bias: 20 },
];

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

export async function readClockPhoto(photo: RGBAImage, engine: OcrEngine): Promise<ClockReading> {
  const readings: VariantReading[] = [];
  let table: ClockReading['table'];
  let confidence = 100;
  for (const variant of VARIANTS) {
    const crops = prepareCrops(photo, variant);
    if (!crops) return { date: null, dateUncertain: true, rows: [], issues: ['no-table'], confidence: 0 };
    table ??= crops.table;
    const dateWords = await engine.recognize(crops.date, 'date');
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
