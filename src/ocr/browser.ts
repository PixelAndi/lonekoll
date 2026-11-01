import type { RGBAImage, TableLocation } from './image.ts';
import type { ClockReading, FoundTable } from './pipeline.ts';
import type { TesseractEngine } from './tesseract.ts';
import type { CheckedDay, TimecardHint } from './timecard.ts';

// Browser side of photo reading: decode the photo, keep a small JPEG copy as
// evidence, and run the OCR pipeline with Tesseract served from ./ocr/.

let engine: Promise<TesseractEngine> | null = null;

function getEngine(): Promise<TesseractEngine> {
  engine ??= import('./tesseract.ts').then(({ TesseractEngine }) => {
    const base = (path: string) => new URL(path, document.baseURI).href;
    return new TesseractEngine(
      { langPath: base('ocr/lang'), corePath: base('ocr/core'), workerPath: base('ocr/worker.min.js') },
      (png) => new Blob([png as BlobPart], { type: 'image/png' }),
    );
  });
  return engine;
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

/** A printed timecard page (photo or rendered PDF page): every day's stamps, checked, and its notes. */
export async function readTimecardImage(source: HTMLCanvasElement, hint?: TimecardHint): Promise<TimecardReading> {
  const [{ prepareTimecard, parseTimecard, rowHeight, checkDay, noteInk, hasNote }, ocr] = await Promise.all([import('./timecard.ts'), getEngine()]);
  // Read at about 2400 px across: the card's small print is then large enough to read reliably.
  const canvas = resized(source, TIMECARD_WIDTH);
  const { width, height } = canvas;
  const rgba = canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) gray[i] = Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]);
  const { clean, rules } = prepareTimecard({ width, height, data: gray });
  // In strips at the same time, on as many cores as the phone has to spare (three at most).
  const strips = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
  const words = await ocr.recognizeInStrips(clean, 'find', strips, Math.round(width * 0.03));
  const page = parseTimecard(words, width, { clean, rules }, hint);
  const ink = noteInk(clean, page);
  const days = page.days.map((day) => {
    const checked: TimecardDayReading = checkDay(day);
    if (hasNote(day, ink.get(day.date))) checked.noteImage = cropOf(canvas, page.notesFrom - width * 0.01, day.top - 6, width * 0.97, day.bottom + 6);
    // The day's rows from the date to Arb Tid (where the stamps are).
    if (checked.status !== 'empty') checked.rowImage = cropOf(canvas, width * 0.02, day.top - 8, page.notesFrom, day.bottom + 8);
    return checked;
  });
  const row = rowHeight(rules, width);
  return { from: page.from, to: page.to, printed: page.printed, totalWorked: page.totalWorked, days, pageImage: source.toDataURL('image/jpeg', 0.9), rowPixels: row === null ? undefined : (row * source.width) / width };
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

/** A picture of part of the page, for showing what is written there. */
function cropOf(canvas: HTMLCanvasElement, x0: number, y0: number, x1: number, y1: number): string {
  const crop = document.createElement('canvas');
  const x = Math.max(0, Math.round(x0));
  const y = Math.max(0, Math.round(y0));
  crop.width = Math.max(1, Math.round(Math.min(canvas.width, x1) - x));
  crop.height = Math.max(1, Math.round(Math.min(canvas.height, y1) - y));
  crop.getContext('2d')!.drawImage(canvas, x, y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  return crop.toDataURL('image/jpeg', 0.85);
}
