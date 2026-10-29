// Runs the full photo-reading pipeline on real photos of the clock screen.
// Photos are personal data, so they are never committed: point OCR_SAMPLES at
// a folder with *.jpg files and an optional expected.json, e.g.
//   OCR_SAMPLES=/path/to/photos npx vitest run src/ocr/samples.test.ts
// Set OCR_DEBUG=/some/dir to also write the preprocessed crops as PNG.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { afterAll, describe, expect, it } from 'vitest';
import { prepareCrops, readClockPhoto } from './pipeline.ts';
import { encodeGrayPng } from './png.ts';
import { TesseractEngine } from './tesseract.ts';

const dir = process.env.OCR_SAMPLES;
const debugDir = process.env.OCR_DEBUG;
const require = createRequire(import.meta.url);
const langPath = path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');

describe.skipIf(!dir)('clock photos', () => {
  const engine = new TesseractEngine({ langPath }, (png) => Buffer.from(png));
  afterAll(() => engine.terminate());
  const files = dir ? readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f)).sort() : [];
  const expectedPath = dir ? path.join(dir, 'expected.json') : '';
  const expected: Record<string, unknown> = expectedPath && existsSync(expectedPath) ? JSON.parse(readFileSync(expectedPath, 'utf8')) : {};

  for (const file of files) {
    it(file, async () => {
      const decoded = jpeg.decode(readFileSync(path.join(dir!, file)), { useTArray: true, formatAsRGBA: true });
      const photo = { width: decoded.width, height: decoded.height, data: decoded.data };
      if (debugDir) {
        mkdirSync(debugDir, { recursive: true });
        const crops = prepareCrops(photo);
        if (crops) {
          writeFileSync(path.join(debugDir, `${file}.date.png`), encodeGrayPng(crops.date));
          writeFileSync(path.join(debugDir, `${file}.rows.png`), encodeGrayPng(crops.rows));
        }
      }
      const reading = await readClockPhoto(photo, engine);
      console.log(file, JSON.stringify(reading));
      const rows = reading.rows.map((r) => ({ in: r.in, out: r.out }));
      if (expected[file]) expect({ date: reading.date, rows }).toEqual(expected[file]);
    }, 60_000);
  }
});
