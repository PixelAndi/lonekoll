import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app-context.ts';
import type { TimecardReading } from '../ocr/browser.ts';
import { aimAt, findPage, type Aim, type FoundPage } from '../ocr/pageFind.ts';

// A live scanner for printed timecards: it finds the sheet of paper in the
// picture and says how to move until the sheet fills the paper-shaped frame;
// when it is in place and steady it is captured at the camera's full
// resolution, cropped to the sheet and read, and the next page can follow.

/** The paper frame: A4 upright, as a share of the view. */
const FRAME = { width: 0.9, ratio: 297 / 210 };
/** How long the picture must be steady before it is taken (ms). */
const STEADY_MS = 900;

type Phase = { kind: 'starting' } | { kind: 'aiming'; hint: Exclude<Aim, 'ready'> | 'steady' } | { kind: 'reading' } | { kind: 'failed' };

const ARROWS: Partial<Record<Aim, string>> = { left: '←', right: '→', up: '↑', down: '↓' };

export interface ScannedPage {
  reading: TimecardReading;
}

export function TimecardScanner({ onPage, onClose }: { onPage: (page: ScannedPage) => void; onClose: () => void }) {
  const { t } = useApp();
  const video = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' });
  const [pages, setPages] = useState<{ month?: string; days: number }[]>([]);
  const [error, setError] = useState(false);
  const busy = useRef(false);
  const steadySince = useRef<number | null>(null);
  const last = useRef<Uint8ClampedArray | null>(null);
  const capture = useRef<() => Promise<void>>(async () => undefined);
  /** The sheet as last found (shares of the picture), for the outline and the crop. */
  const found = useRef<FoundPage | null>(null);
  const [outline, setOutline] = useState<{ left: number; top: number; width: number; height: number; ready: boolean } | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let alive = true;
    void (async () => {
      try {
        // As many pixels as the camera gives: the card's print is small.
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
          audio: false,
        });
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        if (!alive) return;
        setPhase({ kind: 'aiming', hint: 'find' });
        timer = window.setInterval(() => void tick(), 250);
      } catch {
        setError(true);
      }
    })();

    /** Find the sheet, say how to move; in place and steady for a moment: take the page. */
    const tick = async () => {
      const v = video.current;
      if (!v || busy.current || v.videoWidth === 0) return;
      const sample = videoSample(v);
      const moved = last.current ? difference(last.current, sample.data) : 1;
      last.current = sample.data;
      const page = findPage(sample);
      found.current = page;
      const aim = aimAt(page, frameShare(v));
      setOutline(page ? { ...onScreen(v, page), ready: aim === 'ready' } : null);
      if (aim !== 'ready') {
        steadySince.current = null;
        setPhase({ kind: 'aiming', hint: aim });
        return;
      }
      if (moved > 0.04) {
        steadySince.current = null;
        setPhase({ kind: 'aiming', hint: 'steady' });
        return;
      }
      setPhase({ kind: 'aiming', hint: 'steady' });
      steadySince.current ??= performance.now();
      if (performance.now() - steadySince.current >= STEADY_MS) await capture.current();
    };

    capture.current = async () => {
      const v = video.current;
      if (!v || !stream || busy.current) return;
      busy.current = true;
      steadySince.current = null;
      setPhase({ kind: 'reading' });
      try {
        const canvas = await fullResolution(stream, v);
        const page = cropToPage(canvas, found.current);
        const { readTimecardImage } = await import('../ocr/browser.ts');
        const reading = await readTimecardImage(page);
        const days = reading.days.filter((d) => d.status !== 'empty').length;
        if (!alive) return;
        if (!days) {
          setPhase({ kind: 'failed' });
        } else {
          navigator.vibrate?.(80);
          setPages((p) => [...p, { month: (reading.from ?? reading.days[0]?.date)?.slice(0, 7), days }]);
          onPage({ reading });
          setPhase({ kind: 'aiming', hint: 'find' });
        }
      } catch {
        if (alive) setPhase({ kind: 'failed' });
      } finally {
        // A moment to turn to the next page before looking again.
        window.setTimeout(() => {
          busy.current = false;
          last.current = null;
        }, 1500);
      }
    };

    return () => {
      alive = false;
      window.clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onPage]);

  const status =
    phase.kind === 'reading'
      ? t('tcscan.reading')
      : phase.kind === 'failed'
        ? t('tcscan.failed')
        : phase.kind === 'aiming'
          ? `${ARROWS[phase.hint as Aim] ?? ''} ${t(`tcscan.hint.${phase.hint}`)}`.trim()
          : t('tcscan.starting');

  return (
    <div className="scanner" role="dialog" aria-modal="true" aria-label={t('tcscan.title')}>
      <div className="scanner-view">
        <video ref={video} className="scanner-video" playsInline muted />
        <div className="tcscan-frame" aria-hidden="true" />
        {outline && (
          <div
            className={`tcscan-page ${outline.ready ? 'tcscan-page-ready' : ''}`}
            style={{ left: outline.left, top: outline.top, width: outline.width, height: outline.height }}
            aria-hidden="true"
          />
        )}
        {error && <p className="scanner-status tcscan-error">{t('tcscan.noCamera')}</p>}
      </div>
      <div className="scanner-status">
        <div className={`scanner-pill ${phase.kind === 'reading' ? 'scanner-pill-ok' : phase.kind === 'failed' ? 'scanner-pill-warn' : ''}`}>
          {status}
          {pages.length > 0 && <div className="tcscan-count">{t('tcscan.pages', { n: pages.length, days: pages.reduce((s, p) => s + p.days, 0) })}</div>}
        </div>
      </div>
      <div className="scanner-controls">
        <button type="button" className="button" onClick={onClose}>
          {pages.length ? t('tcscan.done') : t('common.close')}
        </button>
        <button type="button" className="scanner-shutter" aria-label={t('tcscan.capture')} disabled={phase.kind === 'reading'} onClick={() => void capture.current()} />
        <span className="tcscan-spacer" />
      </div>
    </div>
  );
}

/** Where the paper frame is in the video, in its own pixels (the video fills the view, cropped). */
function frameBox(vw: number, vh: number, viewW: number, viewH: number) {
  // The video is shown with object-fit: cover; work out what part of it is on screen.
  const scale = Math.max(viewW / vw, viewH / vh);
  const shownW = viewW / scale;
  const shownH = viewH / scale;
  const fw = shownW * FRAME.width;
  const fh = Math.min(shownH * 0.92, fw * FRAME.ratio);
  const w = fh / FRAME.ratio;
  return { x: (vw - w) / 2, y: (vh - fh) / 2, w, h: fh };
}

function viewSize(v: HTMLVideoElement) {
  return { w: v.clientWidth || v.videoWidth, h: v.clientHeight || v.videoHeight };
}

/** A small grey copy of the whole picture (160 px across), to find the sheet and see movement. */
function videoSample(v: HTMLVideoElement) {
  const w = 160;
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

/** The paper frame as shares of the picture. */
function frameShare(v: HTMLVideoElement) {
  const view = viewSize(v);
  const box = frameBox(v.videoWidth, v.videoHeight, view.w, view.h);
  return { x: box.x / v.videoWidth, y: box.y / v.videoHeight, w: box.w / v.videoWidth, h: box.h / v.videoHeight };
}

/** Where a part of the picture (shares) is on screen, with the video filling the view (object-fit: cover). */
function onScreen(v: HTMLVideoElement, r: { x: number; y: number; w: number; h: number }) {
  const view = viewSize(v);
  const scale = Math.max(view.w / v.videoWidth, view.h / v.videoHeight);
  const ox = (view.w - v.videoWidth * scale) / 2;
  const oy = (view.h - v.videoHeight * scale) / 2;
  return { left: ox + r.x * v.videoWidth * scale, top: oy + r.y * v.videoHeight * scale, width: r.w * v.videoWidth * scale, height: r.h * v.videoHeight * scale };
}

/** Share of the picture that changed since the last look. */
function difference(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  if (a.length !== b.length) return 1;
  let changed = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 24) changed++;
  return changed / a.length;
}

/** The picture at the camera's full resolution: a photo where the browser can take one, else the video frame. */
async function fullResolution(stream: MediaStream, v: HTMLVideoElement): Promise<HTMLCanvasElement> {
  const track = stream.getVideoTracks()[0];
  const Capture = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { takePhoto(): Promise<Blob> } }).ImageCapture;
  if (Capture && track) {
    try {
      const bitmap = await createImageBitmap(await new Capture(track).takePhoto());
      return fromSource(bitmap, bitmap.width, bitmap.height, v);
    } catch {
      // Fall back to the video frame.
    }
  }
  return fromSource(v, v.videoWidth, v.videoHeight, v);
}

/** The picture drawn on a canvas, with the paper frame's position for it. */
function fromSource(source: CanvasImageSource, width: number, height: number, v: HTMLVideoElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(source, 0, 0, width, height);
  // The frame as shares of the video, which the photo shares (same view, more pixels).
  const view = viewSize(v);
  const box = frameBox(v.videoWidth, v.videoHeight, view.w, view.h);
  canvas.dataset.frame = JSON.stringify({ x: box.x / v.videoWidth, y: box.y / v.videoHeight, w: box.w / v.videoWidth, h: box.h / v.videoHeight });
  return canvas;
}

/** The sheet (as found just before), with a little margin; the paper frame when no sheet was found. */
function cropToPage(canvas: HTMLCanvasElement, page: FoundPage | null): HTMLCanvasElement {
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
