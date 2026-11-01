import { parsePaySlip, type PaySlip } from '../domain/payslip.ts';
import { extractTextItems, type PdfJsLike } from './extract.ts';

// pdf.js is loaded only when a pay slip is imported.
export async function readPaySlipPdf(file: Blob, hourlyRate?: number): Promise<PaySlip> {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const items = await extractTextItems(pdfjs as unknown as PdfJsLike, new Uint8Array(await file.arrayBuffer()));
  return parsePaySlip(items, hourlyRate);
}

/**
 * Slips saved without a pay period by an earlier version (which didn't see
 * "Löneperiod:" with a colon, as older slips print it) are read again from
 * their PDF once a period can be found. Photos and slips kept only as a
 * preview are left as they are; their period can be set on the check card.
 * Returns how many were updated (their Drive copies move on the next sync).
 */
export async function rereadUndatedSlips(): Promise<number> {
  const [{ db, loadSettings }, { hourlyRateOn }, { todayLocal }] = await Promise.all([import('../db.ts'), import('../domain/model.ts'), import('../domain/time.ts')]);
  const undated = (await db.slips.toArray()).filter(
    (r) => !r.periodStart && !r.archived && !r.slip.checked && (r.pdf.type === 'application/pdf' || /\.pdf$/i.test(r.fileName)),
  );
  if (!undated.length) return 0;
  const settings = await loadSettings();
  let updated = 0;
  for (const record of undated) {
    try {
      const slip = await readPaySlipPdf(record.pdf, hourlyRateOn(settings, record.slip.payDate ?? todayLocal()) ?? undefined);
      if (!slip.periodStart || slip.lines.length === 0) continue;
      await db.slips.update(record.id, { slip, periodStart: slip.periodStart });
      updated++;
    } catch {
      // Left as it was: the check card still lets the user set the period.
    }
  }
  return updated;
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
