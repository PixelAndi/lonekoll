import type { FoundPage } from '../ocr/pageFind.ts';

// The camera parts the live scanners share (timecards and pay slips): where
// the paper frame is on screen and in the picture, small grey copies of the
// live picture to find the page and see movement, how sharp the print is,
// and the picture itself, taken at once and cut to the page.

/** The frame: upright, its width a share of what the screen shows. */
const FRAME_WIDTH = 0.9;
/** The live picture is used when it is this wide (4K upright is 2160); else a photo is taken. */
const MIN_VIDEO_WIDTH = 1800;

/** A grey picture a third the size (each pixel the mean of three by three). */
export function shrinkBy3(img: { width: number; height: number; data: Uint8ClampedArray }) {
  const w = Math.floor(img.width / 3);
  const h = Math.floor(img.height / 3);
  const data = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) sum += img.data[(y * 3 + dy) * img.width + x * 3 + dx];
      data[y * w + x] = sum / 9;
    }
  }
  return { width: w, height: h, data };
}

/** How sharp the print is: the mean difference between neighbouring pixels inside it. */
export function sharpness(img: { width: number; height: number; data: Uint8ClampedArray }, page: FoundPage): number {
  const { width: w, height: h, data } = img;
  const x0 = Math.max(1, Math.round(page.x * w));
  const x1 = Math.min(w - 1, Math.round((page.x + page.w) * w));
  const y0 = Math.max(1, Math.round(page.y * h));
  const y1 = Math.min(h - 1, Math.round((page.y + page.h) * h));
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = y * w + x;
      sum += Math.abs(4 * data[i] - data[i - 1] - data[i + 1] - data[i - w] - data[i + w]);
      n++;
    }
  }
  return n ? sum / n : 0;
}

/** Where the paper frame is in the video, in its own pixels (the video fills the view, cropped). */
export function frameBox(vw: number, vh: number, viewW: number, viewH: number, ratio: number) {
  // The video is shown with object-fit: cover; work out what part of it is on screen.
  const scale = Math.max(viewW / vw, viewH / vh);
  const shownW = viewW / scale;
  const shownH = viewH / scale;
  const fw = shownW * FRAME_WIDTH;
  const fh = Math.min(shownH * 0.8, fw * ratio);
  const w = fh / ratio;
  return { x: (vw - w) / 2, y: (vh - fh) / 2, w, h: fh };
}

export function viewSize(v: HTMLVideoElement) {
  return { w: v.clientWidth || v.videoWidth, h: v.clientHeight || v.videoHeight };
}

/** A small grey copy of the whole picture (160 px across), to find the sheet and see movement. */
export function videoSample(v: HTMLVideoElement, w = 160) {
  const h = Math.round((w * v.videoHeight) / v.videoWidth);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(v, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const data = new Uint8ClampedArray(w * h);
  for (let i = 0; i < data.length; i++) data[i] = (rgba[i * 4] * 3 + rgba[i * 4 + 1] * 6 + rgba[i * 4 + 2]) / 10;
  return { width: w, height: h, data };
}

/** The frame as shares of the picture. */
export function frameShare(v: HTMLVideoElement, ratio: number) {
  const view = viewSize(v);
  const box = frameBox(v.videoWidth, v.videoHeight, view.w, view.h, ratio);
  return { x: box.x / v.videoWidth, y: box.y / v.videoHeight, w: box.w / v.videoWidth, h: box.h / v.videoHeight };
}

/** Where a part of the picture (shares) is on screen, with the video filling the view (object-fit: cover). */
export function onScreen(v: HTMLVideoElement, r: { x: number; y: number; w: number; h: number }) {
  const view = viewSize(v);
  const scale = Math.max(view.w / v.videoWidth, view.h / v.videoHeight);
  const ox = (view.w - v.videoWidth * scale) / 2;
  const oy = (view.h - v.videoHeight * scale) / 2;
  return { left: ox + r.x * v.videoWidth * scale, top: oy + r.y * v.videoHeight * scale, width: r.w * v.videoWidth * scale, height: r.h * v.videoHeight * scale };
}

/** Share of the picture that changed since the last look. */
export function difference(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  if (a.length !== b.length) return 1;
  let changed = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 24) changed++;
  return changed / a.length;
}

/**
 * The picture to read: the live picture when it is large enough (4K) – taken
 * at once, with no refocusing or change of colours – else a photo at the
 * camera's full resolution where the browser can take one.
 */
export async function picture(stream: MediaStream, v: HTMLVideoElement, ratio: number): Promise<HTMLCanvasElement> {
  if (Math.min(v.videoWidth, v.videoHeight) >= MIN_VIDEO_WIDTH) {
    const canvas = fromSource(v, v.videoWidth, v.videoHeight, v, ratio);
    canvas.dataset.via = 'video';
    return canvas;
  }
  const track = stream.getVideoTracks()[0];
  const Capture = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { takePhoto(): Promise<Blob> } }).ImageCapture;
  if (Capture && track) {
    try {
      const bitmap = await createImageBitmap(await new Capture(track).takePhoto());
      const canvas = fromSource(bitmap, bitmap.width, bitmap.height, v, ratio);
      canvas.dataset.via = 'photo';
      return canvas;
    } catch {
      // Fall back to the video frame.
    }
  }
  const canvas = fromSource(v, v.videoWidth, v.videoHeight, v, ratio);
  canvas.dataset.via = 'video';
  return canvas;
}

/** The picture drawn on a canvas, with the paper frame's position for it. */
export function fromSource(source: CanvasImageSource, width: number, height: number, v: HTMLVideoElement, ratio: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(source, 0, 0, width, height);
  // The frame as shares of the video, which the photo shares (same view, more pixels).
  const view = viewSize(v);
  const box = frameBox(v.videoWidth, v.videoHeight, view.w, view.h, ratio);
  canvas.dataset.frame = JSON.stringify({ x: box.x / v.videoWidth, y: box.y / v.videoHeight, w: box.w / v.videoWidth, h: box.h / v.videoHeight });
  return canvas;
}

/** The sheet (as found just before), with a little margin; the paper frame when no sheet was found. */
export function cropToPage(canvas: HTMLCanvasElement, page: FoundPage | null): HTMLCanvasElement {
  const f = page ?? (JSON.parse(canvas.dataset.frame ?? '{"x":0,"y":0,"w":1,"h":1}') as { x: number; y: number; w: number; h: number });
  const margin = 0.015;
  const x = Math.max(0, (f.x - margin) * canvas.width);
  const y = Math.max(0, (f.y - margin) * canvas.height);
  const w = Math.min(canvas.width - x, (f.w + 2 * margin) * canvas.width);
  const h = Math.min(canvas.height - y, (f.h + 2 * margin) * canvas.height);
  const out = document.createElement('canvas');
  out.width = Math.round(w);
  out.height = Math.round(h);
  out.getContext('2d')!.drawImage(canvas, x, y, w, h, 0, 0, out.width, out.height);
  return out;
}
