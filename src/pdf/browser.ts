import { parsePaySlip, type PaySlip } from '../domain/payslip.ts';
import { extractTextItems, type PdfJsLike } from './extract.ts';

// pdf.js is loaded only when a pay slip is imported.
export async function readPaySlipPdf(file: Blob, hourlyRate?: number): Promise<PaySlip> {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const items = await extractTextItems(pdfjs as unknown as PdfJsLike, new Uint8Array(await file.arrayBuffer()));
  return parsePaySlip(items, hourlyRate);
}

/** Each page of a PDF drawn on a canvas (for a timecard saved as PDF), wide enough to read. */
export async function renderPdfPages(file: Blob, width = 2400): Promise<HTMLCanvasElement[]> {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
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
