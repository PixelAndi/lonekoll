// Pixel-level helpers for reading a photo of the time clock screen.
// Everything works on plain RGBA/gray buffers so the same code runs in the
// browser (canvas ImageData) and in Node (tests).

export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

export interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Where the date bar (light cyan) and column header (lavender) sit in the photo. */
export interface TableLocation {
  barTop: number;
  barBottom: number;
  left: number;
  right: number;
  headerBottom: number;
  /** Bar tilt in radians (positive = right side lower). */
  angle: number;
}

// The date bar is light cyan (~135,240,250) and the header row lavender
// (~160,155,255). The screen background is dark blue, the wall beige.
function isCyan(r: number, g: number, b: number): boolean {
  return g > 200 && b > 200 && r < 210 && b - r > 40;
}

function isLavender(r: number, g: number, b: number): boolean {
  return b > 210 && b - g > 50 && r > 110 && r - g > -10 && g > 100;
}

// Seen from another angle or in other light the same screen shows a
// yellow-green bar (~215,245,150) over a pink header (~200,150,190). Looser
// tests that accept both, used when the strict ones find nothing.
function isBarLoose(r: number, g: number, b: number): boolean {
  return g > 160 && g >= Math.max(r, b) - 15 && g - Math.min(r, b) > 20;
}

function isHeaderLoose(r: number, g: number, b: number): boolean {
  return Math.max(r, b) > 140 && g > 70 && (r + b) / 2 - g > 25 && r - g > -10 && b - g > -10;
}

type ColorTest = (r: number, g: number, b: number) => boolean;
const STRICT = { bar: isCyan, header: isLavender };
export const LOOSE = { bar: isBarLoose, header: isHeaderLoose };

export function downscale(img: RGBAImage, maxWidth: number): RGBAImage {
  if (img.width <= maxWidth) return img;
  const f = img.width / maxWidth;
  const w = maxWidth;
  const h = Math.round(img.height / f);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor(y * f));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x * f));
      const si = (sy * img.width + sx) * 4;
      const di = (y * w + x) * 4;
      out[di] = img.data[si];
      out[di + 1] = img.data[si + 1];
      out[di + 2] = img.data[si + 2];
      out[di + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}

interface Run {
  start: number;
  end: number; // inclusive
}

function runs(flags: boolean[], minLength: number, maxGap = 0): Run[] {
  const result: Run[] = [];
  let start = -1;
  let lastOn = -1;
  for (let i = 0; i <= flags.length; i++) {
    const on = i < flags.length && flags[i];
    if (on) {
      if (start < 0) start = i;
      lastOn = i;
    } else if (start >= 0 && (i === flags.length || i - lastOn > maxGap)) {
      if (lastOn - start + 1 >= minLength) result.push({ start, end: lastOn });
      start = -1;
    }
  }
  return result;
}

function rowCounts(img: RGBAImage, test: (r: number, g: number, b: number) => boolean): number[] {
  const counts = new Array<number>(img.height).fill(0);
  for (let y = 0; y < img.height; y++) {
    let n = 0;
    const rowStart = y * img.width * 4;
    for (let x = 0; x < img.width; x += 2) {
      const i = rowStart + x * 4;
      if (test(img.data[i], img.data[i + 1], img.data[i + 2])) n++;
    }
    counts[y] = n;
  }
  return counts;
}

export function locateTable(img: RGBAImage, colors: { bar: ColorTest; header: ColorTest } = STRICT): TableLocation | null {
  const isBar = colors.bar;
  const half = img.width / 2;
  const cyan = rowCounts(img, isBar);
  const lav = rowCounts(img, colors.header);
  const cyanRuns = runs(cyan.map((n) => n > 0.08 * half), 8, 2);
  const lavRuns = runs(lav.map((n) => n > 0.08 * half), 6, 2);

  // The date bar is directly above the header row.
  let best: { bar: Run; header: Run } | null = null;
  for (const bar of cyanRuns) {
    const height = bar.end - bar.start + 1;
    const header = lavRuns.find(
      (h) => h.start >= bar.start + height * 0.5 && h.start - bar.end < height * 0.6,
    );
    if (!header) continue;
    if (!best || height > best.bar.end - best.bar.start + 1) best = { bar, header };
  }
  if (!best) return null;
  const { bar, header } = best;
  const barHeight = bar.end - bar.start + 1;

  // Horizontal extent: columns where most of the bar rows are cyan.
  const colHits = new Array<number>(img.width).fill(0);
  for (let y = bar.start; y <= bar.end; y++) {
    const rowStart = y * img.width * 4;
    for (let x = 0; x < img.width; x++) {
      const i = rowStart + x * 4;
      if (isBar(img.data[i], img.data[i + 1], img.data[i + 2])) colHits[x]++;
    }
  }
  const colRuns = runs(colHits.map((n) => n > barHeight * 0.3), 20, 12);
  if (colRuns.length === 0) return null;
  const left = Math.min(...colRuns.map((r) => r.start));
  const right = Math.max(...colRuns.map((r) => r.end));
  if (right - left < img.width * 0.12) return null;

  // Tilt: compare where the bar starts (top edge) near its left and right ends.
  const topEdge = (x0: number, x1: number): number | null => {
    const tops: number[] = [];
    for (let x = x0; x < x1; x += 3) {
      for (let y = Math.max(0, bar.start - barHeight); y <= bar.end; y++) {
        const i = (y * img.width + x) * 4;
        if (isBar(img.data[i], img.data[i + 1], img.data[i + 2])) {
          tops.push(y);
          break;
        }
      }
    }
    if (tops.length === 0) return null;
    tops.sort((a, b) => a - b);
    return tops[Math.floor(tops.length / 2)];
  };
  const span = right - left;
  const lt = topEdge(left + Math.round(span * 0.03), left + Math.round(span * 0.15));
  const rt = topEdge(right - Math.round(span * 0.15), right - Math.round(span * 0.03));
  const angle = lt !== null && rt !== null ? Math.atan2(rt - lt, span * 0.88) : 0;

  return {
    barTop: bar.start,
    barBottom: bar.end,
    left,
    right,
    headerBottom: header.end,
    angle,
  };
}

/**
 * Tilt of the date bar (radians, positive = right side lower), found by
 * projecting the bar-coloured pixels along candidate angles: the bar is a long
 * thin stripe, so its projection is sharpest at the right angle.
 */
export function estimateTilt(img: RGBAImage): number {
  const small = downscale(img, 500);
  const points: [number, number][] = [];
  for (let y = 0; y < small.height; y++) {
    for (let x = 0; x < small.width; x++) {
      const i = (y * small.width + x) * 4;
      if (isBarLoose(small.data[i], small.data[i + 1], small.data[i + 2])) points.push([x, y]);
    }
  }
  // Too little of the bar's colour to say anything.
  if (points.length < small.width * small.height * 0.002) return 0;
  let best = 0;
  let bestScore = -1;
  for (let a = -0.3; a <= 0.3001; a += 0.005) {
    const t = Math.tan(a);
    const bins = new Map<number, number>();
    for (const [x, y] of points) {
      const k = Math.round(y - x * t);
      bins.set(k, (bins.get(k) ?? 0) + 1);
    }
    let score = 0;
    for (const n of bins.values()) score += n * n;
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

/** The image rotated by -angle around its centre (straightens a tilt of `angle`). */
export function straighten(img: RGBAImage, angle: number): RGBAImage {
  const { width: w, height: h } = img;
  const out = new Uint8ClampedArray(w * h * 4);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const cx = w / 2;
  const cy = h / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ux = x - cx;
      const uy = y - cy;
      const sx = Math.round(cx + ux * cos - uy * sin);
      const sy = Math.round(cy + ux * sin + uy * cos);
      const o = (y * w + x) * 4;
      out[o + 3] = 255;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      const i = (sy * w + sx) * 4;
      out[o] = img.data[i];
      out[o + 1] = img.data[i + 1];
      out[o + 2] = img.data[i + 2];
    }
  }
  return { width: w, height: h, data: out };
}

/** Bilinear sample of one channel combination, returning 0-255. */
function sample(img: RGBAImage, x: number, y: number, channel: (r: number, g: number, b: number) => number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const px = (xx: number, yy: number) => {
    const cx = Math.min(img.width - 1, Math.max(0, xx));
    const cy = Math.min(img.height - 1, Math.max(0, yy));
    const i = (cy * img.width + cx) * 4;
    return channel(img.data[i], img.data[i + 1], img.data[i + 2]);
  };
  const top = px(x0, y0) * (1 - fx) + px(x0 + 1, y0) * fx;
  const bottom = px(x0, y0 + 1) * (1 - fx) + px(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

/**
 * Cut out a region of the photo, undoing the tilt, scaled by `scale`.
 * (x, y) of the output map to rotated source coordinates around (cx, cy).
 */
export function extractRegion(
  img: RGBAImage,
  region: { left: number; top: number; width: number; height: number },
  angle: number,
  pivot: { x: number; y: number },
  scale: number,
  channel: (r: number, g: number, b: number) => number,
): GrayImage {
  const w = Math.max(1, Math.round(region.width * scale));
  const h = Math.max(1, Math.round(region.height * scale));
  const out = new Uint8Array(w * h);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Point in the deskewed frame…
      const ux = region.left + x / scale - pivot.x;
      const uy = region.top + y / scale - pivot.y;
      // …rotated back into the photo.
      const sx = pivot.x + ux * cos - uy * sin;
      const sy = pivot.y + ux * sin + uy * cos;
      out[y * w + x] = Math.round(sample(img, sx, sy, channel));
    }
  }
  return { width: w, height: h, data: out };
}

export function otsuThreshold(img: GrayImage): number {
  const hist = new Array<number>(256).fill(0);
  for (const v of img.data) hist[v]++;
  const total = img.data.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/**
 * Black-on-white binarisation. `brightText` = the text is lighter than the
 * background (stamp rows); otherwise darker (date bar). Uses a local mean so
 * reflections and glare on the screen don't swallow the text.
 */
export function binarize(img: GrayImage, brightText: boolean, window = 41, bias = 18): GrayImage {
  const { width: w, height: h, data } = img;
  // Integral image for fast local means.
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += data[y * w + x];
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + rowSum;
    }
  }
  const r = Math.floor(window / 2);
  const global = otsuThreshold(img);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const area = (y1 - y0) * (x1 - x0);
      const s =
        integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
      const mean = s / area;
      const v = data[y * w + x];
      const isText = brightText
        ? v > mean + bias && v > global * 0.8
        : v < mean - bias && v < global * 1.2;
      out[y * w + x] = isText ? 0 : 255;
    }
  }
  return { width: w, height: h, data: out };
}

export const channels = {
  green: (_r: number, g: number) => g,
  luminance: (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b,
};
