// Finding the sheet of paper in a camera frame, to guide the aim: the
// paper is the largest bright area – or, on a background as light as the
// paper (a white table or sheet), where the print is: the area of fine
// detail. Works on a small grey copy of the frame (about 160 px across),
// many times a second.

export interface Gray {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** Where the paper is, as shares of the frame (0–1), and whether it is cut off by the frame's edges. */
export interface FoundPage {
  x: number;
  y: number;
  w: number;
  h: number;
  /** The paper runs off the top, bottom, left or right of the picture. */
  cut: { top: boolean; bottom: boolean; left: boolean; right: boolean };
}

export function findPage(img: Gray): FoundPage | null {
  const paper = findPaper(img);
  const print = findPrint(img);
  // The paper merged with a light background: much larger than the print on it, or no paper found.
  if (print && (!paper || paper.w * paper.h > print.w * print.h * 1.8)) return print;
  return paper;
}

/** The largest bright area that fills its box like a sheet of paper. */
function findPaper(img: Gray): FoundPage | null {
  const { width: w, height: h, data } = img;
  const sorted = Uint8Array.from(data).sort();
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p10 = sorted[Math.floor(sorted.length * 0.1)];
  // Paper is among the brightest; with no contrast there is nothing to find.
  if (p95 - p10 < 25 && p95 < 200) return null;
  const threshold = Math.max(p95 - 35, (p95 + p10) / 2);
  const bright = new Uint8Array(w * h);
  for (let i = 0; i < bright.length; i++) bright[i] = data[i] >= threshold ? 1 : 0;

  // The largest connected bright area (the paper's printed lines break it a little, so close small gaps first).
  const closed = new Uint8Array(bright);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!bright[i] && ((bright[i - 1] && bright[i + 1]) || (bright[i - w] && bright[i + w]))) closed[i] = 1;
    }
  }
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let best = { size: 0, x0: 0, y0: 0, x1: 0, y1: 0 };
  for (let start = 0; start < closed.length; start++) {
    if (!closed[start] || seen[start]) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    let size = 0;
    let x0 = w;
    let y0 = h;
    let x1 = 0;
    let y1 = 0;
    while (top) {
      const i = stack[--top];
      size++;
      const x = i % w;
      const y = (i - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const j of [i - 1, i + 1, i - w, i + w]) {
        if (j < 0 || j >= closed.length || seen[j] || !closed[j]) continue;
        if ((j === i - 1 && x === 0) || (j === i + 1 && x === w - 1)) continue;
        seen[j] = 1;
        stack[top++] = j;
      }
    }
    if (size > best.size) best = { size, x0, y0, x1, y1 };
  }
  const bw = best.x1 - best.x0 + 1;
  const bh = best.y1 - best.y0 + 1;
  // Too small, or not filling its box like a sheet of paper would.
  if (best.size < w * h * 0.04 || best.size / (bw * bh) < 0.55) return null;
  return {
    x: best.x0 / w,
    y: best.y0 / h,
    w: bw / w,
    h: bh / h,
    cut: { top: best.y0 === 0, bottom: best.y1 === h - 1, left: best.x0 === 0, right: best.x1 === w - 1 },
  };
}

/**
 * Where the print is: the area of fine detail (lines and text against the
 * paper; folds and shadows in a background are smooth at this size), widened
 * by the page's margins.
 */
export function findPrint(img: Gray): FoundPage | null {
  const { width: w, height: h, data } = img;
  // Detail: how much a pixel differs from its neighbours.
  const detail = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const d = Math.abs(2 * data[i] - data[i - 1] - data[i + 1]) + Math.abs(2 * data[i] - data[i - w] - data[i + w]);
      detail[i] = d > 24 ? 1 : 0;
    }
  }
  const rows = new Array<number>(h).fill(0);
  const cols = new Array<number>(w).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (detail[y * w + x]) rows[y]++;
  /** The longest run of busy lines (a gap of a few quiet ones allowed), as [first, last]. */
  const span = (counts: number[], min: number): [number, number] | null => {
    let best: [number, number] | null = null;
    let start = -1;
    let lastBusy = -1;
    for (let i = 0; i <= counts.length; i++) {
      const busy = i < counts.length && counts[i] >= min;
      if (busy) {
        if (start < 0 || i - lastBusy > 4) start = i;
        lastBusy = i;
      }
      if (start >= 0 && (i === counts.length || i - lastBusy > 4)) {
        if (!best || lastBusy - start > best[1] - best[0]) best = [start, lastBusy];
        start = -1;
      }
    }
    return best;
  };
  const ys = span(rows, w * 0.1);
  if (!ys) return null;
  for (let y = ys[0]; y <= ys[1]; y++) for (let x = 0; x < w; x++) if (detail[y * w + x]) cols[x]++;
  const xs = span(cols, (ys[1] - ys[0] + 1) * 0.1);
  if (!xs) return null;
  const bw = xs[1] - xs[0] + 1;
  const bh = ys[1] - ys[0] + 1;
  if (bw < w * 0.15 || bh < h * 0.1) return null;
  // The page's margins around its print (a tenth of the print's size each way).
  const x0 = Math.max(0, xs[0] - bw * 0.06);
  const x1 = Math.min(w - 1, xs[1] + bw * 0.06);
  const y0 = Math.max(0, ys[0] - bh * 0.06);
  const y1 = Math.min(h - 1, ys[1] + bh * 0.06);
  return {
    x: x0 / w,
    y: y0 / h,
    w: (x1 - x0 + 1) / w,
    h: (y1 - y0 + 1) / h,
    cut: { top: ys[0] <= 1, bottom: ys[1] >= h - 2, left: xs[0] <= 1, right: xs[1] >= w - 2 },
  };
}

export type Aim = 'find' | 'closer' | 'further' | 'left' | 'right' | 'up' | 'down' | 'ready';

/**
 * How to move the phone so the paper fills the frame (both as shares of the
 * picture). "Left" means move the phone left: the paper is left of the frame.
 */
export function aimAt(page: FoundPage | null, frame: { x: number; y: number; w: number; h: number }): Aim {
  if (!page) return 'find';
  if ((page.cut.top && page.cut.bottom) || (page.cut.left && page.cut.right)) return 'further';
  const cx = page.x + page.w / 2 - (frame.x + frame.w / 2);
  const cy = page.y + page.h / 2 - (frame.y + frame.h / 2);
  if (Math.abs(cx) > 0.08 || page.cut.left !== page.cut.right) return (page.cut.left ? -1 : page.cut.right ? 1 : cx) < 0 ? 'left' : 'right';
  if (Math.abs(cy) > 0.08 || page.cut.top !== page.cut.bottom) return (page.cut.top ? -1 : page.cut.bottom ? 1 : cy) < 0 ? 'up' : 'down';
  if (page.h < frame.h * 0.75 && page.w < frame.w * 0.75) return 'closer';
  return 'ready';
}
