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

/** Where in a bar's brightness its ink ends and its paper starts (shares of its pixels). */
const BAR_INK = 0.02;
const BAR_PAPER = 0.35;

const grayAt = (rgba: Uint8ClampedArray, i: number) => 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];

/**
 * The bars a slip prints its headings and payout on ("Utbetalas 2026-10-23
 * … 25 275,80") are grey, with the text darker on them. Cleaned like the
 * rest of the page, a bar turns black and its text is lost. A bar is a band
 * of rows dark across most of the page, and thin – not the table the slip
 * lies on. Found here (on a small copy will do), with how dark "dark" is.
 */
export function findDarkBars(rgba: Uint8ClampedArray, width: number, height: number): { bars: { top: number; bottom: number }[]; dark: number } {
  // The paper's brightness: most of the picture is paper.
  const sample: number[] = [];
  for (let i = 0; i < width * height; i += 97) sample.push(grayAt(rgba, i));
  sample.sort((a, b) => a - b);
  const dark = sample[Math.floor(sample.length * 0.9)] * 0.75;
  const x0 = Math.round(width * 0.1);
  const x1 = Math.round(width * 0.9);
  const step = width > 1000 ? 2 : 1;
  const isBarRow = (y: number) => {
    let n = 0;
    let all = 0;
    for (let x = x0; x < x1; x += step, all++) if (grayAt(rgba, y * width + x) < dark) n++;
    return n > all * 0.5;
  };
  const bars: { top: number; bottom: number }[] = [];
  let start = -1;
  let last = -10;
  const gap = Math.max(1, Math.round(height * 0.001));
  for (let y = 0; y <= height; y++) {
    if (y < height && isBarRow(y)) {
      if (y - last > gap) start = y;
      last = y;
    } else if (start >= 0 && y - last > gap) {
      const h = last - start + 1;
      if (h >= height * 0.004 && h <= height * 0.04) bars.push({ top: start, bottom: last });
      start = -1;
    }
  }
  return { bars, dark };
}

/**
 * One bar lightened so its grey becomes white and its ink stays dark: smoothed
 * (3 × 3) to take out its fine dot pattern and the back of the page showing
 * through, then stretched. `rgba` may be just the rows around the bar.
 */
export function lightenBar(rgba: Uint8ClampedArray, width: number, height: number, bar: { top: number; bottom: number }, dark: number): void {
  const gray = (i: number) => grayAt(rgba, i);
  const top = Math.max(0, bar.top - 3);
  const bottom = Math.min(height - 1, bar.bottom + 3);
  // Where across the bar runs: the columns dark in most of its rows.
  let left = -1;
  let right = -1;
  for (let x = 0; x < width; x++) {
    let n = 0;
    for (let y = bar.top; y <= bar.bottom; y++) if (gray(y * width + x) < dark) n++;
    if (n > (bar.bottom - bar.top + 1) * 0.5) {
      if (left < 0) left = x;
      right = x;
    }
  }
  if (left < 0) return;
  left = Math.max(0, left - 3);
  right = Math.min(width - 1, right + 3);
  const w = right - left + 1;
  const h = bottom - top + 1;
  const smooth = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = top + y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = left + x + dx;
          if (xx < 0 || xx >= width) continue;
          sum += gray(yy * width + xx);
          n++;
        }
      }
      smooth[y * w + x] = sum / n;
    }
  }
  const values = Array.from(smooth).filter((_, i) => i % 3 === 0).sort((a, b) => a - b);
  const lo = values[Math.floor(values.length * BAR_INK)];
  const hi = values[Math.floor(values.length * BAR_PAPER)];
  if (hi - lo < 10) return;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (top + y) * width + left + x;
      const v = Math.max(0, Math.min(255, ((smooth[y * w + x] - lo) / (hi - lo)) * 255));
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v;
    }
  }
}

/** Every grey bar on a page lightened (see findDarkBars), in place; returns the bars. */
export function lightenDarkBars(rgba: Uint8ClampedArray, width: number, height: number): { top: number; bottom: number }[] {
  const { bars, dark } = findDarkBars(rgba, width, height);
  for (const bar of bars) lightenBar(rgba, width, height, bar, dark);
  return bars;
}
