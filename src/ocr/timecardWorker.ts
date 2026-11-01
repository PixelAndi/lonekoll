/// <reference lib="webworker" />
import { encodeGrayPng } from './png.ts';
import { prepareTimecard, type Rule } from './timecard.ts';

// The heavy part of reading a timecard picture, off the main thread so the
// camera keeps running smoothly while pictures are read: scaling, cleaning
// the page and finding its rules, and packing it in strips for the OCR.

export interface PrepareRequest {
  id: number;
  bitmap: ImageBitmap;
  width: number;
  strips: number;
  overlap: number;
}

export interface PreparedStrip {
  /** Where the strip starts on the page, and the part of it whose words are its own. */
  y0: number;
  own: { from: number; to: number };
  png: Uint8Array;
}

export type PrepareResponse =
  | { id: number; width: number; height: number; clean: Uint8Array; rules: Rule[]; strips: PreparedStrip[] }
  | { id: number; error: string };

self.onmessage = (e: MessageEvent<PrepareRequest>) => {
  const { id, bitmap, width, strips, overlap } = e.data;
  try {
    const height = Math.round((bitmap.height * width) / bitmap.width);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const rgba = ctx.getImageData(0, 0, width, height).data;
    const gray = new Uint8Array(width * height);
    for (let i = 0; i < gray.length; i++) gray[i] = Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]);
    const { clean, rules } = prepareTimecard({ width, height, data: gray });
    const step = Math.ceil(height / strips);
    const parts: PreparedStrip[] = Array.from({ length: strips }, (_, k) => {
      const own = { from: k * step, to: Math.min(height, (k + 1) * step) };
      const y0 = Math.max(0, own.from - overlap);
      const y1 = Math.min(height, own.to + overlap);
      return { y0, own, png: encodeGrayPng({ width, height: y1 - y0, data: clean.data.subarray(y0 * width, y1 * width) }) };
    });
    const data = new Uint8Array(clean.data);
    const response: PrepareResponse = { id, width, height, clean: data, rules, strips: parts };
    (self as unknown as Worker).postMessage(response, [data.buffer, ...parts.map((p) => p.png.buffer as ArrayBuffer)]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) } satisfies PrepareResponse);
  }
};
