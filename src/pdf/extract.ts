import type { TextItem } from '../domain/payslip.ts';

// Positioned text from a PDF via pdf.js. The pdf.js module is passed in so the
// browser build and Node tests can each use their own entry point.

interface PdfJsTextItem {
  str: string;
  transform: number[];
  width: number;
}

export interface PdfJsLike {
  getDocument(src: { data: Uint8Array; isEvalSupported?: boolean }): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }>;
    }>;
    destroy(): Promise<void>;
  };
}

/** Text items of all pages; later pages are shifted down so lines never collide. */
export async function extractTextItems(pdfjs: PdfJsLike, data: Uint8Array): Promise<TextItem[]> {
  // No eval: the app runs under a strict Content Security Policy.
  const task = pdfjs.getDocument({ data, isEvalSupported: false });
  const items: TextItem[] = [];
  try {
    const doc = await task.promise;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      for (const raw of content.items) {
        const item = raw as PdfJsTextItem;
        if (typeof item.str !== 'string' || !item.transform) continue;
        items.push({ str: item.str, x: item.transform[4], y: item.transform[5] - (n - 1) * 10_000, width: item.width });
      }
    }
  } finally {
    await task.destroy();
  }
  return items;
}
