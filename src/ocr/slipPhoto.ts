import type { TextItem } from '../domain/payslip.ts';
import type { OcrWord } from './parse.ts';

// A photographed pay slip, as the PDF reader sees one: OCR gives single
// words, a PDF gives the table's cells ("21 690,00", "Skatt beräknad på",
// "2026-09-01 - 2026-09-30") with their place on the page. The words are
// put in their printed rows (the photo's tilt taken out), joined into cells
// – words close together, a number never with a word, so "120,50" and
// "Timmar" stay apart – and placed on an A4 page in points, so the pay slip
// parser reads a photo just as it reads a PDF.

/** An A4 page is 595 points across. */
const PAGE_WIDTH = 595;

const centerX = (w: OcrWord) => (w.bbox.x0 + w.bbox.x1) / 2;
const centerY = (w: OcrWord) => (w.bbox.y0 + w.bbox.y1) / 2;
const isNumberish = (s: string) => /^[-−]?[\d\s]+([,.]\d+)?$|^\d{4}-\d{2}-\d{2}$|^[-−–]$/.test(s);

/** How much the rows slope: the median rise per pixel across, from words far apart on the same row. */
function slope(words: OcrWord[], width: number): number {
  const out: number[] = [];
  const sample = words.filter((_, i) => i % 3 === 0);
  for (const a of sample) {
    for (const b of sample) {
      const dx = centerX(b) - centerX(a);
      const dy = centerY(b) - centerY(a);
      const h = a.bbox.y1 - a.bbox.y0;
      if (dx > width * 0.2 && Math.abs(dy) < h * 0.6) out.push(dy / dx);
    }
  }
  out.sort((a, b) => a - b);
  return out.length ? out[Math.floor(out.length / 2)] : 0;
}

/** A word as read, tidied: OCR often reads the decimal comma as a point. */
function tidy(text: string): string {
  const t = text.trim();
  return /^[-−]?\d+\.\d{2}$/.test(t) ? t.replace('.', ',') : t;
}

/** Whether two neighbouring words are one cell. */
function joins(a: string, b: string, gap: number, height: number): boolean {
  if (gap > height * 0.8) return false;
  const na = isNumberish(a);
  const nb = isNumberish(b);
  // "21" "690,00": a thousands group.
  if (/^[-−]?\d{1,3}$/.test(a) && /^\d{3}(,\d+)?$/.test(b)) return true;
  // "2026-09-01" "-" "2026-09-30", "260903 - 260904": a date range.
  if (/^(\d{6}|\d{4}-\d{2}-\d{2})$|[-–]$/.test(a) && /^(\d{6}|\d{4}-\d{2}-\d{2}|[-–])$|^[-–]/.test(b) && (/[-–]/.test(a) || /[-–]/.test(b))) return true;
  return !na && !nb;
}

export function slipItemsFromWords(words: OcrWord[], width: number): TextItem[] {
  const clean = words.filter((w) => w.text.trim() !== '');
  if (!clean.length) return [];
  const s = slope(clean, width);
  const level = (w: OcrWord) => centerY(w) - s * centerX(w);
  const heights = clean.map((w) => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b);
  const h = heights[Math.floor(heights.length / 2)];
  // Rows: words at the same level (within half a line's height).
  const rows: { y: number; words: OcrWord[] }[] = [];
  for (const w of [...clean].sort((a, b) => level(a) - level(b))) {
    const row = rows[rows.length - 1];
    if (row && level(w) - row.y < h * 0.5) {
      row.words.push(w);
      row.y = row.words.reduce((sum, x) => sum + level(x), 0) / row.words.length;
    } else rows.push({ y: level(w), words: [w] });
  }
  const scale = PAGE_WIDTH / width;
  const pageHeight = Math.max(...clean.map((w) => w.bbox.y1));
  const items: TextItem[] = [];
  for (const row of rows) {
    const sorted = row.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    const cells: { text: string; x0: number; x1: number }[] = [];
    for (const w of sorted) {
      const text = tidy(w.text);
      const cell = cells[cells.length - 1];
      if (cell && joins(cell.text, text, w.bbox.x0 - cell.x1, h)) {
        cell.text = /^[-–]$/.test(text) || /[-–]$/.test(cell.text) ? `${cell.text} ${text}`.replace(/\s*([-–])\s*$/, ' $1') : `${cell.text} ${text}`;
        cell.x1 = w.bbox.x1;
      } else cells.push({ text, x0: w.bbox.x0, x1: w.bbox.x1 });
    }
    // One y for the whole row (PDF coordinates: up is larger), so the parser keeps it together.
    const y = (pageHeight - row.y) * scale;
    for (const c of cells) items.push({ str: c.text.replace(/–/g, '-'), x: c.x0 * scale, y, width: (c.x1 - c.x0) * scale });
  }
  return items;
}
