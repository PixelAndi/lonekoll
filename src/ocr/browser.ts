import type { RGBAImage, TableLocation } from './image.ts';
import type { ClockReading, FoundTable } from './pipeline.ts';
import type { TesseractEngine } from './tesseract.ts';
import type { CheckedDay, Rule, TimecardHint } from './timecard.ts';
import type { PreparedStrip, PrepareRequest, PrepareResponse } from './timecardWorker.ts';

// Browser side of photo reading: decode the photo, keep a small JPEG copy as
// evidence, and run the OCR pipeline with Tesseract served from ./ocr/.

const engines = new Map<string, Promise<TesseractEngine>>();

/** Text recognition with a language model: English by default, Swedish for pay slips. */
function getEngine(lang = 'eng'): Promise<TesseractEngine> {
  if (!engines.has(lang)) {
    engines.set(
      lang,
      import('./tesseract.ts').then(({ TesseractEngine }) => {
        const base = (path: string) => new URL(path, document.baseURI).href;
        return new TesseractEngine(
          { langPath: base('ocr/lang'), corePath: base('ocr/core'), workerPath: base('ocr/worker.min.js') },
          (png) => new Blob([png as BlobPart], { type: 'image/png' }),
          lang,
        );
      }),
    );
  }
  return engines.get(lang)!;
}

function draw(bitmap: ImageBitmap, maxWidth: number): HTMLCanvasElement {
  const scale = Math.min(1, maxWidth / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const toBlob = (canvas: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG encoding failed'))), 'image/jpeg', quality),
  );

export interface LoadedPhoto {
  image: RGBAImage;
  canvas: HTMLCanvasElement;
  /** Smaller JPEG kept as evidence. */
  jpeg: Blob;
}

export async function loadPhoto(file: Blob): Promise<LoadedPhoto> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const canvas = draw(bitmap, 2000);
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    const jpeg = await toBlob(draw(bitmap, 1600), 0.8);
    return { image: { width: data.width, height: data.height, data: data.data }, canvas, jpeg };
  } finally {
    bitmap.close();
  }
}

export async function readPhoto(image: RGBAImage, at?: TableLocation): Promise<ClockReading> {
  const [{ readClockPhoto }, ocr] = await Promise.all([import('./pipeline.ts'), getEngine()]);
  return readClockPhoto(image, ocr, at);
}

/** Starts loading text recognition (about 7 MB the first time) so the scanner is ready sooner. */
export function warmUp(): void {
  void Promise.all([import('./pipeline.ts'), getEngine()]);
}

/** Downloads and starts text recognition now, so the offline cache holds it (see offline.ts). */
export async function prepareRecognition(): Promise<void> {
  const [, ocr] = await Promise.all([import('./pipeline.ts'), getEngine()]);
  await ocr.ready();
}

/** One pass over a camera frame's search area: finds the table and reads it. */
export async function findInFrame(image: RGBAImage): Promise<FoundTable | null> {
  const [{ findTableByText }, ocr] = await Promise.all([import('./pipeline.ts'), getEngine()]);
  return findTableByText(image, ocr);
}

/** Starts following a table just found in this frame (see trackInFrame). */
export async function anchorInFrame(image: RGBAImage, found: FoundTable): Promise<FoundTable | null> {
  const { anchorTable } = await import('./pipeline.ts');
  return anchorTable(image, found);
}

/** Follows a locked-on table: much quicker than searching for it. Null when it has moved too much. */
export async function trackInFrame(image: RGBAImage, prev: FoundTable): Promise<FoundTable | null> {
  const [{ trackTable }, ocr] = await Promise.all([import('./pipeline.ts'), getEngine()]);
  return trackTable(image, prev, ocr);
}

/** The stamp table cut out of the photo, for checking the times side by side. */
export async function tableCrop(photo: LoadedPhoto, table: NonNullable<ClockReading['table']>): Promise<Blob> {
  const margin = Math.round(table.width * 0.03);
  const left = Math.max(0, table.left - margin);
  const top = Math.max(0, table.top - margin);
  const width = Math.min(photo.canvas.width - left, table.width + margin * 2);
  const height = Math.min(photo.canvas.height - top, table.height + margin * 2);
  const crop = document.createElement('canvas');
  crop.width = width;
  crop.height = height;
  crop.getContext('2d')!.drawImage(photo.canvas, left, top, width, height, 0, 0, width, height);
  return toBlob(crop, 0.9);
}

export interface TimecardDayReading extends CheckedDay {
  /** Ink or words in the Frånvaro box: a note to ask about, with a picture of it. */
  noteImage?: string;
  /** A picture of the day's rows on the card, to check what was read against. */
  rowImage?: string;
}

export interface TimecardReading {
  from?: string;
  to?: string;
  days: TimecardDayReading[];
  /** The page as captured, for saving (to check a reading, or send it for help). */
  pageImage?: string;
  /** How tall a printed row is in the picture as taken (pixels): too small, and digits are misread. */
  rowPixels?: number;
  /** When the card was printed (with the period, which card this is). */
  printed?: string;
  /** The month's Arb Tid from the totals box. */
  totalWorked?: number;
}

let preparer: Worker | null | undefined;
let nextId = 0;
const waitingFor = new Map<number, (r: PrepareResponse) => void>();

/** The worker that prepares timecard pictures (null where workers can't be used: then it's done here). */
function getPreparer(): Worker | null {
  if (preparer !== undefined) return preparer;
  try {
    preparer = new Worker(new URL('./timecardWorker.ts', import.meta.url), { type: 'module' });
    preparer.onmessage = (e: MessageEvent<PrepareResponse>) => {
      waitingFor.get(e.data.id)?.(e.data);
      waitingFor.delete(e.data.id);
    };
  } catch {
    preparer = null;
  }
  return preparer;
}

/** The page scaled, cleaned, its rules found and packed in strips: in the worker, or here if need be. */
async function prepare(source: HTMLCanvasElement, strips: number, overlap: number): Promise<{ width: number; height: number; clean: Uint8Array; rules: Rule[]; strips: PreparedStrip[] }> {
  const worker = getPreparer();
  if (worker) {
    const bitmap = await createImageBitmap(source);
    const id = ++nextId;
    const answer = await new Promise<PrepareResponse>((resolve) => {
      waitingFor.set(id, resolve);
      worker.postMessage({ id, bitmap, width: TIMECARD_WIDTH, strips, overlap } satisfies PrepareRequest, [bitmap]);
    });
    if (!('error' in answer)) return answer;
  }
  const [{ prepareTimecard }, { encodeGrayPng }] = await Promise.all([import('./timecard.ts'), import('./png.ts')]);
  const canvas = resized(source, TIMECARD_WIDTH);
  const { width, height } = canvas;
  const rgba = canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]);
  const { clean, rules } = prepareTimecard({ width, height, data: gray });
  const step = Math.ceil(height / strips);
  const parts = Array.from({ length: strips }, (_, k) => {
    const own = { from: k * step, to: Math.min(height, (k + 1) * step) };
    const y0 = Math.max(0, own.from - overlap);
    const y1 = Math.min(height, own.to + overlap);
    return { y0, own, png: encodeGrayPng({ width, height: y1 - y0, data: clean.data.subarray(y0 * width, y1 * width) }) };
  });
  return { width, height, clean: clean.data, rules, strips: parts };
}

/** A printed timecard page (photo or rendered PDF page): every day's stamps, checked, and its notes. */
export async function readTimecardImage(source: HTMLCanvasElement, hint?: TimecardHint): Promise<TimecardReading> {
  const [{ parseTimecard, rowHeight, checkDay, noteInk, hasNote }, ocr] = await Promise.all([import('./timecard.ts'), getEngine()]);
  // Read at about 2400 px across (the card's small print is then large enough to read reliably),
  // in strips at the same time, on as many cores as the phone has to spare (three at most).
  const strips = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
  const prepared = await prepare(source, strips, Math.round(TIMECARD_WIDTH * 0.03));
  const { width, height } = prepared;
  const clean = { width, height, data: prepared.clean };
  const words = await ocr.recognizeStrips(prepared.strips, 'find');
  const page = parseTimecard(words, width, { clean, rules: prepared.rules }, hint);
  const ink = noteInk(clean, page);
  // The page at reading size, for the pictures of the days' rows.
  const canvas = resized(source, TIMECARD_WIDTH);
  const days = await Promise.all(
    page.days.map(async (day) => {
      const checked: TimecardDayReading = checkDay(day);
      if (hasNote(day, ink.get(day.date))) checked.noteImage = await cropOf(canvas, page.notesFrom - width * 0.01, day.top - 6, width * 0.97, day.bottom + 6);
      // The day's rows from the date to Arb Tid (where the stamps are).
      if (checked.status !== 'empty') checked.rowImage = await cropOf(canvas, width * 0.02, day.top - 8, page.notesFrom, day.bottom + 8);
      return checked;
    }),
  );
  const row = rowHeight(prepared.rules, width);
  return {
    from: page.from,
    to: page.to,
    printed: page.printed,
    totalWorked: page.totalWorked,
    days,
    pageImage: URL.createObjectURL(await toBlob(source, 0.9)),
    rowPixels: row === null ? undefined : (row * source.width) / width,
  };
}

const TIMECARD_WIDTH = 2400;

function resized(source: HTMLCanvasElement, width: number): HTMLCanvasElement {
  if (source.width === width) return source;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.round((source.height * width) / source.width);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** A picture of part of the page, for showing what is written there (encoded off the main thread). */
async function cropOf(canvas: HTMLCanvasElement, x0: number, y0: number, x1: number, y1: number): Promise<string> {
  const crop = document.createElement('canvas');
  const x = Math.max(0, Math.round(x0));
  const y = Math.max(0, Math.round(y0));
  crop.width = Math.max(1, Math.round(Math.min(canvas.width, x1) - x));
  crop.height = Math.max(1, Math.round(Math.min(canvas.height, y1) - y));
  crop.getContext('2d')!.drawImage(canvas, x, y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  return URL.createObjectURL(await toBlob(crop, 0.85));
}

const slipStrips = () => Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));

/** Gets the Swedish text recognition ready (while the camera is open), so reading starts at once. */
export function warmUpSlipReading(): void {
  void getEngine('swe').then((e) => e.warm(slipStrips()));
  getPreparer();
}

/**
 * A photographed pay slip, read like a PDF one: the page prepared as a
 * timecard is (lines removed, read in strips at once), its words put back
 * into the table's cells (see slipPhoto.ts) and given to the same parser.
 */
export async function readPaySlipImage(file: Blob, hourlyRate?: number): Promise<import('../domain/payslip.ts').PaySlip> {
  const [{ slipItemsFromWords, lightenDarkBars }, { parsePaySlip }, ocr] = await Promise.all([import('./slipPhoto.ts'), import('../domain/payslip.ts'), getEngine('swe')]);
  // Scaled to reading size as it is decoded: a phone photo is 12 megapixels, far more than needed.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image', resizeWidth: TIMECARD_WIDTH, resizeQuality: 'high' });
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d')!;
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  // The grey bars (the pay day and payout are printed on one) made readable before the page is cleaned.
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  if (lightenDarkBars(pixels.data, canvas.width, canvas.height).length) context.putImageData(pixels, 0, 0);
  const strips = slipStrips();
  const prepared = await prepare(canvas, strips, Math.round(TIMECARD_WIDTH * 0.03));
  const words = await ocr.recognizeStrips(prepared.strips, 'find');
  const items = slipItemsFromWords(words, prepared.width);
  const slip = parsePaySlip(items, hourlyRate);
  // The payout is often printed on a dark bar a photo can't read: then it is gross pay less tax and
  // other deductions, rounded up to whole kronor (öresutjämning, as these slips do).
  if (slip.net === undefined && slip.gross !== undefined && slip.tax !== undefined) slip.net = Math.ceil(slip.gross - slip.tax - (slip.otherDeductions ?? 0) - 0.005);
  return slip;
}
