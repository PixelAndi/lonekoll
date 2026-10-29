import { parsePaySlip, type PaySlip } from '../domain/payslip.ts';
import { extractTextItems, type PdfJsLike } from './extract.ts';

// pdf.js is loaded only when a pay slip is imported.
export async function readPaySlipPdf(file: Blob, hourlyRate?: number): Promise<PaySlip> {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const items = await extractTextItems(pdfjs as unknown as PdfJsLike, new Uint8Array(await file.arrayBuffer()));
  return parsePaySlip(items, hourlyRate);
}
