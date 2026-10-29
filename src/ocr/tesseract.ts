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
  rows: { tessedit_pageseg_mode: PSM.SPARSE_TEXT, tessedit_char_whitelist: '0123456789:x' },
};

type PageLike = { blocks: { paragraphs: { lines: { words: OcrWord[] }[] }[] }[] | null };

function wordsOf(page: PageLike): OcrWord[] {
  return (page.blocks ?? []).flatMap((b) =>
    b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words.map(({ text, confidence, bbox }) => ({ text, confidence, bbox })))),
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

  async terminate(): Promise<void> {
    if (this.worker) await (await this.worker).terminate();
    this.worker = null;
  }
}
