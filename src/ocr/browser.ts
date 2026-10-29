import type { RGBAImage, TableLocation } from './image.ts';
import type { ClockReading, QuickReading } from './pipeline.ts';
import type { TesseractEngine } from './tesseract.ts';

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

/** One fast read of the table at a known place in a camera frame. */
export async function quickReadImage(image: RGBAImage, loc: TableLocation): Promise<QuickReading> {
  const [{ quickRead }, ocr] = await Promise.all([import('./pipeline.ts'), getEngine()]);
  return quickRead(image, loc, ocr);
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
