import { createWorker, PSM, type Worker } from 'tesseract.js';
import type { GrayImage } from './image.ts';
import type { OcrWord } from './parse.ts';
import type { OcrEngine, OcrMode } from './pipeline.ts';
import { encodeGrayPng } from './png.ts';

export interface TesseractPaths {
  /** Folder with eng.traineddata.gz. */
  langPath: string;
  /** Folder with tesseract-core*.wasm.js (browser only). */
  corePath?: string;
  /** worker.min.js (browser only). */
  workerPath?: string;
}

const PARAMS: Record<OcrMode, Record<string, string>> = {
  date: { tessedit_pageseg_mode: PSM.SINGLE_LINE, tessedit_char_whitelist: '0123456789-' },
  dateSparse: { tessedit_pageseg_mode: PSM.SPARSE_TEXT, tessedit_char_whitelist: '0123456789-' },
  find: { tessedit_pageseg_mode: PSM.SPARSE_TEXT, tessedit_char_whitelist: '' },
  rows: { tessedit_pageseg_mode: PSM.SPARSE_TEXT, tessedit_char_whitelist: '0123456789:x' },
};

type PageLike = { blocks: { paragraphs: { lines: { words: (OcrWord & { symbols?: { text: string; bbox: OcrWord['bbox'] }[] })[] }[] }[] }[] | null };

function wordsOf(page: PageLike): OcrWord[] {
  return (page.blocks ?? []).flatMap((b) =>
    b.paragraphs.flatMap((p) =>
      p.lines.flatMap((l) =>
        l.words.map(({ text, confidence, bbox, symbols }) => ({ text, confidence, bbox, symbols: symbols?.map((c) => ({ text: c.text, bbox: c.bbox })) })),
      ),
    ),
  );
}

/** One Tesseract worker, reused for every photo and run one job at a time. */
export class TesseractEngine implements OcrEngine {
  private worker: Promise<Worker> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly paths: TesseractPaths;
  private readonly toImage: (png: Uint8Array) => unknown;

  constructor(paths: TesseractPaths, toImage: (png: Uint8Array) => unknown) {
    this.paths = paths;
    this.toImage = toImage;
  }

  private getWorker(): Promise<Worker> {
    // Only pass paths that are set: undefined would override the library defaults.
    const paths = Object.fromEntries(Object.entries(this.paths).filter(([, v]) => v !== undefined));
    this.worker ??= createWorker('eng', 1, { ...paths, cacheMethod: 'none', gzip: true });
    return this.worker;
  }

  /** Loads the recognition engine and language data now (for use without internet). */
  async ready(): Promise<void> {
    await this.getWorker();
  }

  recognize(image: GrayImage, mode: OcrMode): Promise<OcrWord[]> {
    const job = this.queue.then(async () => {
      const worker = await this.getWorker();
      // debug_file silences Tesseract's console chatter ("Detected N diacritics").
      await worker.setParameters({ ...PARAMS[mode], user_defined_dpi: '300', debug_file: '/dev/null' });
      const result = await worker.recognize(this.toImage(encodeGrayPng(image)) as Blob, {}, { blocks: true });
      return wordsOf(result.data as unknown as PageLike);
    });
    this.queue = job.catch(() => undefined);
    return job;
  }

  /** Workers besides the main one, for reading strips of a page at the same time. */
  private helpers: Promise<Worker>[] = [];

  /**
   * A large page read in horizontal strips at the same time, one worker each (a phone has several
   * cores; one worker uses one). The strips overlap so that no line of text is cut; a word is kept
   * from the strip whose own part (without the overlap) its middle lies in.
   */
  async recognizeInStrips(image: GrayImage, mode: OcrMode, strips: number, overlap: number): Promise<OcrWord[]> {
    if (strips <= 1) return this.recognize(image, mode);
    const { width, height, data } = image;
    const step = Math.ceil(height / strips);
    return this.recognizeStrips(
      Array.from({ length: strips }, (_, k) => {
        const own = { from: k * step, to: Math.min(height, (k + 1) * step) };
        const y0 = Math.max(0, own.from - overlap);
        const y1 = Math.min(height, own.to + overlap);
        return { y0, own, png: encodeGrayPng({ width, height: y1 - y0, data: data.subarray(y0 * width, y1 * width) }) };
      }),
      mode,
    );
  }

  /** Strips already packed as PNGs (by the preparing worker), read at the same time. */
  async recognizeStrips(strips: { y0: number; own: { from: number; to: number }; png: Uint8Array }[], mode: OcrMode): Promise<OcrWord[]> {
    const paths = Object.fromEntries(Object.entries(this.paths).filter(([, v]) => v !== undefined));
    while (this.helpers.length < strips.length - 1) this.helpers.push(createWorker('eng', 1, { ...paths, cacheMethod: 'none', gzip: true }));
    const read = async (part: (typeof strips)[number], worker: Promise<Worker> | null) => {
      const run = async (w: Worker) => {
        await w.setParameters({ ...PARAMS[mode], user_defined_dpi: '300', debug_file: '/dev/null' });
        const result = await w.recognize(this.toImage(part.png) as Blob, {}, { blocks: true });
        return wordsOf(result.data as unknown as PageLike);
      };
      let words: OcrWord[];
      if (worker) words = await run(await worker);
      else {
        // The main worker takes its turn in the queue.
        const job = this.queue.then(async () => run(await this.getWorker()));
        this.queue = job.catch(() => undefined);
        words = await job;
      }
      const shift = (b: OcrWord['bbox']) => ({ ...b, y0: b.y0 + part.y0, y1: b.y1 + part.y0 });
      return words
        .map((w) => ({ ...w, bbox: shift(w.bbox), symbols: w.symbols?.map((c) => ({ ...c, bbox: shift(c.bbox) })) }))
        .filter((w) => {
          const mid = (w.bbox.y0 + w.bbox.y1) / 2;
          return mid >= part.own.from && mid < part.own.to;
        });
    };
    const results = await Promise.all(strips.map((p, k) => read(p, k === 0 ? null : this.helpers[k - 1])));
    return results.flat();
  }

  async terminate(): Promise<void> {
    if (this.worker) await (await this.worker).terminate();
    this.worker = null;
    for (const h of this.helpers) await (await h).terminate();
    this.helpers = [];
  }
}
