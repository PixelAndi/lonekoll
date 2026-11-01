import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app-context.ts';
import type { TimecardReading } from '../ocr/browser.ts';

// A live scanner for printed timecards: the page is held in a frame shaped
// like the paper; when the picture is steady and sharp it is captured at the
// camera's full resolution and read, and the next page can follow at once.

/** The paper frame: A4 upright, as a share of the view. */
const FRAME = { width: 0.9, ratio: 297 / 210 };
/** How long the picture must be steady before it is taken (ms). */
const STEADY_MS = 900;

type Phase = { kind: 'starting' } | { kind: 'aiming'; hint: 'closer' | 'steady' | 'blurry' } | { kind: 'reading' } | { kind: 'failed' };

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
        setPhase({ kind: 'aiming', hint: 'closer' });
        timer = window.setInterval(() => void tick(), 300);
      } catch {
        setError(true);
      }
    })();

    /** Steady and sharp inside the frame for a moment: take the page. */
    const tick = async () => {
      const v = video.current;
      if (!v || busy.current || v.videoWidth === 0) return;
      const sample = frameSample(v);
      const moved = last.current ? difference(last.current, sample.data) : 1;
      last.current = sample.data;
      if (sample.ink < 0.02) {
        steadySince.current = null;
        setPhase({ kind: 'aiming', hint: 'closer' });
        return;
      }
      if (moved > 0.035) {
        steadySince.current = null;
        setPhase({ kind: 'aiming', hint: 'steady' });
        return;
      }
      if (sample.sharpness < 14) {
        steadySince.current = null;
        setPhase({ kind: 'aiming', hint: 'blurry' });
        return;
      }
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
        const page = cropToFrame(canvas);
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
          setPhase({ kind: 'aiming', hint: 'closer' });
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
          ? t(`tcscan.hint.${phase.hint}`)
          : t('tcscan.starting');

  return (
    <div className="scanner" role="dialog" aria-modal="true" aria-label={t('tcscan.title')}>
      <div className="scanner-view">
        <video ref={video} className="scanner-video" playsInline muted />
        <div className="tcscan-frame" aria-hidden="true" />
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

/** A small grey copy of the frame's content, with how much ink and how sharp it is. */
function frameSample(v: HTMLVideoElement) {
  const view = viewSize(v);
  const box = frameBox(v.videoWidth, v.videoHeight, view.w, view.h);
  const w = 120;
  const h = Math.round((w * box.h) / box.w);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(v, box.x, box.y, box.w, box.h, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const gray = new Uint8ClampedArray(w * h);
  let sum = 0;
  for (let i = 0; i < gray.length; i++) {
    gray[i] = (rgba[i * 4] * 3 + rgba[i * 4 + 1] * 6 + rgba[i * 4 + 2]) / 10;
    sum += gray[i];
  }
  const mean = sum / gray.length;
  let ink = 0;
  let edges = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (gray[i] < mean - 40) ink++;
      // Sharpness: how strong the edges are (a blurred page has soft ones).
      edges += Math.abs(4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w]);
    }
  }
  return { data: gray, ink: ink / gray.length, sharpness: edges / gray.length };
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

/** The part of the picture inside the paper frame, with a little margin. */
function cropToFrame(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const f = JSON.parse(canvas.dataset.frame ?? '{"x":0,"y":0,"w":1,"h":1}') as { x: number; y: number; w: number; h: number };
  const margin = 0.03;
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
