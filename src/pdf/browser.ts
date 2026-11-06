import { parsePaySlip, type PaySlip } from '../domain/payslip.ts';
import { extractTextItems, type PdfJsLike } from './extract.ts';

/**
 * Safari (iPhone, iPad, Mac) can't loop over a ReadableStream with `for await`, which pdf.js does
 * when it reads a page's text: the import failed there with "undefined is not a function (near
 * '...e of t...')". Where it's missing, the loop is added from the stream's own reader.
 */
export function addStreamIteration(proto: { getReader(): ReadableStreamDefaultReader<unknown> } & Record<PropertyKey, unknown> = ReadableStream.prototype as never): void {
  if (typeof proto[Symbol.asyncIterator] === 'function') return;
  function values(this: { getReader(): ReadableStreamDefaultReader<unknown> }, options?: { preventCancel?: boolean }) {
    const reader = this.getReader();
    return {
      next: () => reader.read(),
      async return(value?: unknown) {
        if (!options?.preventCancel) await reader.cancel(value);
        reader.releaseLock();
        return { done: true as const, value };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }
  Object.defineProperty(proto, 'values', { value: values, configurable: true, writable: true });
  Object.defineProperty(proto, Symbol.asyncIterator, { value: values, configurable: true, writable: true });
}

/**
 * pdf.js, loaded only when a PDF is read: its "legacy" build, which brings what older browsers
 * (older iPhones' Safari among them) lack, and the stream loop Safari lacks besides.
 */
async function loadPdfJs() {
  addStreamIteration();
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

export async function readPaySlipPdf(file: Blob, hourlyRate?: number): Promise<PaySlip> {
  const pdfjs = await loadPdfJs();
  const items = await extractTextItems(pdfjs as unknown as PdfJsLike, new Uint8Array(await file.arrayBuffer()));
  return parsePaySlip(items, hourlyRate);
}

/**
 * Slips saved by earlier versions, put right once at start: those without a
 * pay period (older slips print "Löneperiod:" with a colon, which wasn't seen)
 * are read again from their PDF, and those without a pay day get the one in
 * the settings (marked, so the check card says so). Photos and slips kept only
 * as a preview aren't read again; their period can be set on the check card.
 * Returns how many were updated (their Drive copies move on the next sync).
 */
export async function tidySavedSlips(): Promise<number> {
  const [{ db, loadSettings }, { hourlyRateOn }, { todayLocal }, { withPayDay }] = await Promise.all([
    import('../db.ts'),
    import('../domain/model.ts'),
    import('../domain/time.ts'),
    import('../domain/payday.ts'),
  ]);
  const settings = await loadSettings();
  let updated = 0;
  for (const record of await db.slips.toArray()) {
    let slip = record.slip;
    const pdf = record.pdf.type === 'application/pdf' || /\.pdf$/i.test(record.fileName);
    if (!record.periodStart && !record.archived && !slip.checked && pdf) {
      try {
        const read = await readPaySlipPdf(record.pdf, hourlyRateOn(settings, slip.payDate ?? todayLocal()) ?? undefined);
        if (read.periodStart && read.lines.length > 0) slip = read;
      } catch {
        // Left as it was: the check card still lets the user set the period.
      }
    }
    slip = withPayDay(slip, settings.payDay);
    if (slip === record.slip) continue;
    await db.slips.update(record.id, { slip, periodStart: slip.periodStart ?? '' });
    updated++;
  }
  return updated;
}

/** Each page of a PDF drawn on a canvas (for a timecard saved as PDF), wide enough to read. */
export async function renderPdfPages(file: Blob, width = 2400): Promise<HTMLCanvasElement[]> {
  const pdfjs = await loadPdfJs();
  // No eval: the app runs under a strict Content Security Policy.
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false } as Parameters<typeof pdfjs.getDocument>[0]);
  const canvases: HTMLCanvasElement[] = [];
  try {
    const doc = await task.promise;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: width / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport, canvas }).promise;
      canvases.push(canvas);
    }
  } finally {
    await task.destroy();
  }
  return canvases;
}
