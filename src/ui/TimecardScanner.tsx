import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app-context.ts';
import type { TimecardReading } from '../ocr/browser.ts';
import { aimAt, findPage, type Aim, type FoundPage } from '../ocr/pageFind.ts';
import { addsUpToTotal, combineReadings, type CheckedDay } from '../ocr/timecard.ts';

// A live scanner for printed timecards. Hold the whole card in the frame:
// pictures are taken from the camera's live picture (no separate photo – the
// camera would refocus and change its colours each time) when it is steady
// and sharp, and read; every reading of a day is put to the vote (see
// combineReadings). Another picture is taken only while some days are not
// yet certain, or the days don't add up to the card's own total Arb Tid –
// on real scans of a card, a day that adds up as read was never wrong, so
// most cards are done after one or two pictures. A map shows which days are
// certain. Then the next card; one scanned again is known by its period, and
// its readings join the vote.

/** The frame: A4 upright, its width a share of what the screen shows. */
const FRAME_WIDTH = 0.9;
const PAGE_RATIO = 297 / 210;
/** How long the picture must be steady before it is taken (ms). */
const STEADY_MS = 700;
/** At most this many pictures of a card; days still not certain then are left to the review. */
const MAX_READS = 4;
/**
 * The smallest printed row (pixels in the picture) read reliably: smaller,
 * and digits are misread in ways that can still add up (tried on real cards:
 * 16 px read every day right, 13 px read some days wrong without noticing).
 */
const MIN_ROW_PIXELS = 15;
/** The live picture is used when it is this wide (4K upright is 2160); else a photo is taken. */
const MIN_VIDEO_WIDTH = 1800;

type Phase =
  | { kind: 'starting' }
  | { kind: 'aiming'; hint: Exclude<Aim, 'ready'> | 'steady' | 'nudge' }
  | { kind: 'reading' }
  | { kind: 'failed' }
  | { kind: 'small' }
  | { kind: 'next' };

const ARROWS: Partial<Record<Aim, string>> = { left: '←', right: '→', up: '↑', down: '↓' };

export interface ScannedPage {
  reading: TimecardReading;
}

/** A card being scanned: its dates and every reading of it so far. */
interface Card {
  key: string;
  dates: string[];
  readings: TimecardReading[];
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 62; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Each date's day as read so far: every reading of it put to the vote. */
function dayStates(card: Card | null): Map<string, CheckedDay | undefined> {
  const out = new Map<string, CheckedDay | undefined>();
  if (!card) return out;
  for (const date of card.dates) {
    const readings = card.readings.flatMap((r) => r.days.filter((d) => d.date === date));
    out.set(date, readings.length ? combineReadings(readings) : undefined);
  }
  return out;
}

/** How a card stands: days not yet certain, and whether they add up to its total (when that was read). */
function standing(card: Card) {
  const days = [...dayStates(card).values()];
  const unsure = days.filter((d) => !d || (d.status !== 'ok' && d.status !== 'empty')).length;
  const totals = card.readings.map((r) => r.totalWorked).filter((x): x is number => x !== undefined);
  const total = totals.sort((a, b) => totals.filter((x) => x === b).length - totals.filter((x) => x === a).length)[0];
  const addsUp = total === undefined || addsUpToTotal(days.filter((d): d is CheckedDay => !!d), total);
  const sure = days.filter((d) => d && d.status === 'ok').length;
  return { unsure, addsUp, sure, done: unsure === 0 && addsUp };
}

/** Saves a file to the phone (test mode: what the scanner saw, to send for troubleshooting). */
function save(data: Blob, name: string) {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');

export function TimecardScanner({ onPage, onClose, test = false }: { onPage: (page: ScannedPage) => void; onClose: () => void; test?: boolean }) {
  const { t, fmt } = useApp();
  const video = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' });
  const [error, setError] = useState(false);
  const [card, setCardState] = useState<Card | null>(null);
  /** What the last picture gave (the card done, days still to confirm …). */
  const [note, setNote] = useState<{ text: string; kind: 'ok' | 'warn' } | null>(null);
  const [cardsDone, setCardsDone] = useState(0);
  const cardRef = useRef<Card | null>(null);
  const cards = useRef(new Map<string, Card>());
  const setCard = (c: Card | null) => {
    cardRef.current = c;
    setCardState(c ? { ...c, readings: [...c.readings] } : null);
  };
  /** A card is done: wait until it is taken away (or another is put there) before the next picture. */
  const waiting = useRef(false);
  const busy = useRef(false);
  const steadySince = useRef<number | null>(null);
  /** The sharpest the picture has been while steady: a picture is taken at its sharpest. */
  const sharpest = useRef(0);
  const last = useRef<Uint8ClampedArray | null>(null);
  /**
   * The picture when the last one was taken: the next must differ a little (the phone moved a
   * bit). Readings of the very same picture would agree on the same misread – only readings of
   * different pictures confirm each other.
   */
  const lastShot = useRef<Uint8ClampedArray | null>(null);
  const capture = useRef<() => Promise<void>>(async () => undefined);
  /** The print as last found (shares of the picture), for the outline and the crop. */
  const found = useRef<FoundPage | null>(null);
  const [outline, setOutline] = useState<{ left: number; top: number; width: number; height: number; ready: boolean } | null>(null);
  const [frameOnScreen, setFrameOnScreen] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let alive = true;
    let shots = 0;
    // Test mode: a recording of what the camera saw, saved when the scanner closes.
    let recorder: MediaRecorder | null = null;
    const chunks: Blob[] = [];
    const startRecording = (s: MediaStream) => {
      try {
        const type = ['video/mp4', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
        recorder = new MediaRecorder(s, { mimeType: type, videoBitsPerSecond: 6_000_000 });
        recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        recorder.onstop = () => chunks.length && save(new Blob(chunks, { type: recorder!.mimeType }), `tidkort-test-video-${stamp()}.${recorder!.mimeType.includes('mp4') ? 'mp4' : 'webm'}`);
        recorder.start(1000);
      } catch {
        recorder = null;
      }
    };
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
        if (test) startRecording(stream);
        setPhase({ kind: 'aiming', hint: 'find' });
        timer = window.setInterval(() => void tick(), 200);
      } catch {
        setError(true);
      }
    })();

    /** Find the print, say how to move; in place, steady and at its sharpest: take the picture. */
    const tick = async () => {
      const v = video.current;
      if (!v || busy.current || v.videoWidth === 0) return;
      const sample = videoSample(v);
      const moved = last.current ? difference(last.current, sample.data) : 1;
      last.current = sample.data;
      // The print's rows only show at a finer size (at 160 px across they blur into grey).
      const fine = videoSample(v, 480);
      const page = findPage(sample, fine);
      found.current = page;
      const frame = frameShare(v, PAGE_RATIO);
      setFrameOnScreen(onScreen(v, frame));
      const aim = aimAt(page, frame);
      setOutline(page ? { ...onScreen(v, page), ready: aim === 'ready' } : null);
      if (waiting.current) {
        // The card done is still there: wait for it to go, or for a big change (the next card).
        if (!page || moved > 0.25) waiting.current = false;
        else return setPhase({ kind: 'next' });
      }
      if (aim !== 'ready') {
        steadySince.current = null;
        setPhase({ kind: 'aiming', hint: aim });
        return;
      }
      if (cardRef.current && lastShot.current && difference(lastShot.current, sample.data) < 0.02) {
        steadySince.current = null;
        setPhase({ kind: 'aiming', hint: 'nudge' });
        return;
      }
      setPhase({ kind: 'aiming', hint: 'steady' });
      if (moved > 0.04) {
        steadySince.current = null;
        sharpest.current = 0;
        return;
      }
      const sharp = sharpness(fine, page!);
      sharpest.current = Math.max(sharpest.current, sharp);
      steadySince.current ??= performance.now();
      if (performance.now() - steadySince.current >= STEADY_MS && sharp >= sharpest.current * 0.9) await capture.current();
    };

    capture.current = async () => {
      const v = video.current;
      if (!v || !stream || busy.current) return;
      busy.current = true;
      steadySince.current = null;
      sharpest.current = 0;
      setPhase({ kind: 'reading' });
      lastShot.current = last.current;
      try {
        const canvas = await picture(stream, v, PAGE_RATIO);
        const sheet = found.current;
        const crop = cropToPage(canvas, sheet);
        const { readTimecardImage } = await import('../ocr/browser.ts');
        const reading = await readTimecardImage(crop);
        const read = reading.days.filter((d) => d.status !== 'empty').length;
        const small = reading.rowPixels !== undefined && reading.rowPixels < MIN_ROW_PIXELS;
        if (test) {
          // Everything about this picture, to find out what went wrong and why.
          const name = `tidkort-test-${stamp()}-${++shots}`;
          canvas.toBlob((b) => b && save(b, `${name}.jpg`), 'image/jpeg', 0.95);
          const info = {
            taken: new Date().toISOString(),
            browser: navigator.userAgent,
            video: { width: v.videoWidth, height: v.videoHeight },
            picture: { width: canvas.width, height: canvas.height, via: canvas.dataset.via },
            view: viewSize(v),
            frame: frameShare(v, PAGE_RATIO),
            sheet,
            crop: { width: crop.width, height: crop.height },
            rowPixels: reading.rowPixels,
            from: reading.from,
            to: reading.to,
            printed: reading.printed,
            totalWorked: reading.totalWorked,
            days: reading.days.map(({ rowImage: _r, noteImage: _n, ...d }) => d),
          };
          save(new Blob([JSON.stringify(info, null, 1)], { type: 'application/json' }), `${name}.json`);
        }
        if (!alive) return;
        if (small) return setPhase({ kind: 'small' });
        if (!read) return setPhase({ kind: 'failed' });
        const dates = reading.days.map((d) => d.date).sort();
        const from = reading.from ?? dates[0];
        const to = reading.to ?? dates[dates.length - 1];
        // Which card: its period (the time it was printed is often too small to read).
        const key = `${from}|${to}`;
        const again = cards.current.get(key);
        const current: Card = again ?? { key, dates: datesBetween(from, to), readings: [] };
        const first = !again;
        current.readings.push(reading);
        cards.current.set(key, current);
        setCard(current);
        onPage({ reading });
        const now = standing(current);
        const month = fmt.month(`${from.slice(0, 7)}-01`);
        if (now.done || current.readings.length >= MAX_READS) {
          navigator.vibrate?.([80, 60, 80]);
          if (first || !waiting.current) setCardsDone((n) => n + 1);
          setNote({
            text: now.done ? t('tcscan.cardDone', { month, ok: now.sure }) : t('tcscan.cardLeft', { month, check: now.unsure }),
            kind: now.done ? 'ok' : 'warn',
          });
          waiting.current = true;
        } else {
          navigator.vibrate?.(60);
          setNote({ text: now.unsure ? t('tcscan.keep', { n: now.unsure }) : t('tcscan.totalOff'), kind: 'warn' });
        }
        setPhase({ kind: 'aiming', hint: 'steady' });
      } catch {
        if (alive) setPhase({ kind: 'failed' });
      } finally {
        busy.current = false;
        last.current = null;
      }
    };

    return () => {
      alive = false;
      window.clearInterval(timer);
      if (recorder?.state === 'recording') recorder.stop();
      stream?.getTracks().forEach((track) => track.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onPage, test]);

  const status =
    phase.kind === 'reading'
      ? t('tcscan.reading')
      : phase.kind === 'failed'
        ? t('tcscan.failed')
        : phase.kind === 'small'
          ? t('tcscan.small')
          : phase.kind === 'next'
            ? t('tcscan.next')
            : phase.kind === 'aiming'
              ? `${ARROWS[phase.hint as Aim] ?? ''} ${t(`tcscan.hint.${phase.hint}`)}`.trim()
              : t('tcscan.starting');

  return (
    <div className="scanner" role="dialog" aria-modal="true" aria-label={t('tcscan.title')}>
      <div className="scanner-view">
        <video ref={video} className="scanner-video" playsInline muted />
        {frameOnScreen && <div className="tcscan-frame" style={frameOnScreen} aria-hidden="true" />}
        {outline && (
          <div
            className={`tcscan-page ${outline.ready ? 'tcscan-page-ready' : ''}`}
            style={{ left: outline.left, top: outline.top, width: outline.width, height: outline.height }}
            aria-hidden="true"
          />
        )}
        <CardMap card={card} t={t} />
        {error && <p className="scanner-status tcscan-error">{t('tcscan.noCamera')}</p>}
        <div className="scanner-status">
          {test && <div className="tcscan-test">{t('tcscan.test')}</div>}
          {note && <div className={`tcscan-note tcscan-note-${note.kind}`}>{note.text}</div>}
          {!card && <div className="tcscan-do">{t('tcscan.do.page')}</div>}
          <div className={`scanner-pill ${phase.kind === 'reading' ? 'scanner-pill-ok' : phase.kind === 'failed' || phase.kind === 'small' ? 'scanner-pill-warn' : ''}`}>
            {status}
            {cardsDone > 0 && <div className="tcscan-count">{t('tcscan.cards', { n: cardsDone })}</div>}
          </div>
        </div>
      </div>
      <div className="scanner-controls">
        <button type="button" className="button" onClick={onClose}>
          {card ? t('tcscan.done') : t('common.close')}
        </button>
        <button type="button" className="scanner-shutter" aria-label={t('tcscan.capture')} disabled={phase.kind === 'reading'} onClick={() => void capture.current()} />
        <span className="tcscan-spacer" />
      </div>
    </div>
  );
}

/** How sharp the print is: the mean difference between neighbouring pixels inside it. */
function sharpness(img: { width: number; height: number; data: Uint8ClampedArray }, page: FoundPage): number {
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

/**
 * The card in miniature: a row per date, green when certain, orange when not
 * (yet), grey without stamps.
 */
function CardMap({ card, t }: { card: Card | null; t: ReturnType<typeof useApp>['t'] }) {
  const W = 70;
  const H = 99;
  const top = 16;
  const bottom = 90;
  const dates = card?.dates ?? Array.from({ length: 31 }, (_, i) => String(i));
  const states = dayStates(card);
  const rowH = (bottom - top) / dates.length;
  return (
    <div className="tcscan-map" aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} width={W * 1.3} height={H * 1.3}>
        <rect x="0.5" y="0.5" width={W - 1} height={H - 1} rx="2" fill="#fff" stroke="#9ca3af" />
        <rect x="5" y="4" width={W - 10} height="8" fill="#e5e7eb" />
        {dates.map((d, i) => {
          const day = states.get(d);
          const fill = !card || !day ? '#f3f4f6' : day.status === 'empty' ? '#d1d5db' : day.status === 'ok' ? '#16a34a' : '#f59e0b';
          return <rect key={d} x="5" y={top + i * rowH + 0.3} width={(W - 10) * 0.72} height={Math.max(0.8, rowH - 0.6)} fill={fill} />;
        })}
        <rect x="5" y={top + (bottom - top) + 1} width={W - 10} height="5" fill="#e5e7eb" />
      </svg>
      {card && (
        <div className="tcscan-map-key">
          <span>
            <i style={{ background: '#16a34a' }} />
            {t('tcscan.map.ok')}
          </span>
          <span>
            <i style={{ background: '#f59e0b' }} />
            {t('tcscan.map.check')}
          </span>
        </div>
      )}
    </div>
  );
}

/** Where the paper frame is in the video, in its own pixels (the video fills the view, cropped). */
function frameBox(vw: number, vh: number, viewW: number, viewH: number, ratio: number) {
  // The video is shown with object-fit: cover; work out what part of it is on screen.
  const scale = Math.max(viewW / vw, viewH / vh);
  const shownW = viewW / scale;
  const shownH = viewH / scale;
  const fw = shownW * FRAME_WIDTH;
  const fh = Math.min(shownH * 0.8, fw * ratio);
  const w = fh / ratio;
  return { x: (vw - w) / 2, y: (vh - fh) / 2, w, h: fh };
}

function viewSize(v: HTMLVideoElement) {
  return { w: v.clientWidth || v.videoWidth, h: v.clientHeight || v.videoHeight };
}

/** A small grey copy of the whole picture (160 px across), to find the sheet and see movement. */
function videoSample(v: HTMLVideoElement, w = 160) {
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
function frameShare(v: HTMLVideoElement, ratio: number) {
  const view = viewSize(v);
  const box = frameBox(v.videoWidth, v.videoHeight, view.w, view.h, ratio);
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

/**
 * The picture to read: the live picture when it is large enough (4K) – taken
 * at once, with no refocusing or change of colours – else a photo at the
 * camera's full resolution where the browser can take one.
 */
async function picture(stream: MediaStream, v: HTMLVideoElement, ratio: number): Promise<HTMLCanvasElement> {
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
function fromSource(source: CanvasImageSource, width: number, height: number, v: HTMLVideoElement, ratio: number): HTMLCanvasElement {
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
