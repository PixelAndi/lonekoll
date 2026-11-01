import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app-context.ts';
import type { TimecardReading } from '../ocr/browser.ts';
import { aimAt, aimAtPart, findPage, type Aim, type FoundPage } from '../ocr/pageFind.ts';
import { combineReadings, type CheckedDay } from '../ocr/timecard.ts';

// A live scanner for printed timecards, in steps: first the whole page (the
// month, which card it is, a first reading of every day), then close-ups of
// its top and bottom half, Datum to Arb Tid, where the digits come out larger
// – a second reading of every day. A map of the card says which part to aim
// at and which days are certain. A card scanned again is known by its period
// and print time, and every reading of a day is put to the vote (see
// combineReadings).

/** The frame's width, as a share of what the screen shows. */
const FRAME_WIDTH = 0.9;
/** The whole page: A4 upright. */
const PAGE_RATIO = 297 / 210;
/** A close-up: half the card's rows, Datum to Arb Tid (about 0.6 as high as wide). */
const PART_RATIO = 0.62;
/** How long the picture must be steady before it is taken (ms). */
const STEADY_MS = 900;
/**
 * The smallest printed row (pixels in the picture) read reliably: smaller,
 * and digits are misread in ways that can still add up (tried on real cards:
 * 16 px read every day right, 13 px read some days wrong without noticing).
 */
const MIN_ROW_PIXELS = 15;
/** A close-up must show the rows this much larger than the whole page did. */
const MIN_ZOOM = 1.2;

export type ScanStep = 'page' | 'top' | 'bottom';

type Phase =
  | { kind: 'starting' }
  | { kind: 'aiming'; hint: Exclude<Aim, 'ready'> | 'steady' }
  | { kind: 'reading' }
  | { kind: 'failed' }
  | { kind: 'small' };

const ARROWS: Partial<Record<Aim, string>> = { left: '←', right: '→', up: '↑', down: '↓' };

export interface ScannedPage {
  reading: TimecardReading;
  step: ScanStep;
}

/** A card being scanned: its dates and every reading of it so far. */
interface Card {
  key: string;
  dates: string[];
  rowPixels?: number;
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

/** The dates a step is for: all of them, or the top or bottom half of the rows. */
function stepDates(card: Card | null, step: ScanStep): string[] {
  if (!card) return [];
  const half = Math.ceil(card.dates.length / 2);
  return step === 'page' ? card.dates : step === 'top' ? card.dates.slice(0, half) : card.dates.slice(half);
}

const dayNo = (date: string) => String(Number(date.slice(8)));
const span = (dates: string[]) => ({ from: dayNo(dates[0]), to: dayNo(dates[dates.length - 1]) });

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
  const [step, setStepState] = useState<ScanStep>('page');
  const [card, setCardState] = useState<Card | null>(null);
  /** What the last picture gave (a step done, the wrong part, the same card again …). */
  const [note, setNote] = useState<{ text: string; kind: 'ok' | 'warn' } | null>(null);
  const [pages, setPages] = useState(0);
  // The same as refs, for the camera loop.
  const stepRef = useRef<ScanStep>('page');
  const cardRef = useRef<Card | null>(null);
  const cards = useRef(new Map<string, Card>());
  const setStep = (s: ScanStep) => {
    stepRef.current = s;
    setStepState(s);
  };
  const setCard = (c: Card | null) => {
    cardRef.current = c;
    setCardState(c ? { ...c, readings: [...c.readings] } : null);
  };
  const busy = useRef(false);
  const steadySince = useRef<number | null>(null);
  const last = useRef<Uint8ClampedArray | null>(null);
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
        timer = window.setInterval(() => void tick(), 250);
      } catch {
        setError(true);
      }
    })();

    const ratio = () => (stepRef.current === 'page' ? PAGE_RATIO : PART_RATIO);

    /** Find the print, say how to move; in place and steady for a moment: take the picture. */
    const tick = async () => {
      const v = video.current;
      if (!v || busy.current || v.videoWidth === 0) return;
      const sample = videoSample(v);
      const moved = last.current ? difference(last.current, sample.data) : 1;
      last.current = sample.data;
      // The print's rows only show at a finer size (at 160 px across they blur into grey).
      const page = findPage(sample, videoSample(v, 480));
      found.current = page;
      const frame = frameShare(v, ratio());
      setFrameOnScreen(onScreen(v, frame));
      const aim = (stepRef.current === 'page' ? aimAt : aimAtPart)(page, frame);
      setOutline(page ? { ...onScreen(v, page), ready: aim === 'ready' } : null);
      if (aim !== 'ready') {
        steadySince.current = null;
        setPhase({ kind: 'aiming', hint: aim });
        return;
      }
      setPhase({ kind: 'aiming', hint: 'steady' });
      if (moved > 0.04) {
        steadySince.current = null;
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
      const now = stepRef.current;
      const current = cardRef.current;
      const target = stepDates(current, now);
      try {
        const canvas = await fullResolution(stream, v, ratio());
        const sheet = found.current;
        const crop = cropToPage(canvas, sheet);
        const { readTimecardImage } = await import('../ocr/browser.ts');
        // A close-up's rows can be the half aimed at, or a few days either side.
        const hint =
          now !== 'page' && current && target.length
            ? {
                from: current.dates[0],
                to: current.dates[current.dates.length - 1],
                near: { from: addDays(target[0], -4), to: addDays(target[target.length - 1], 4) },
              }
            : undefined;
        const reading = await readTimecardImage(crop, hint);
        const read = reading.days.filter((d) => d.status !== 'empty').length;
        const small = reading.rowPixels !== undefined && reading.rowPixels < MIN_ROW_PIXELS;
        const notCloser = now !== 'page' && !!current?.rowPixels && !!reading.rowPixels && reading.rowPixels < current.rowPixels * MIN_ZOOM;
        if (test) {
          // Everything about this picture, to find out what went wrong and why.
          const name = `tidkort-test-${stamp()}-${++shots}-${now}`;
          canvas.toBlob((b) => b && save(b, `${name}.jpg`), 'image/jpeg', 0.95);
          const info = {
            taken: new Date().toISOString(),
            step: now,
            hint,
            browser: navigator.userAgent,
            video: { width: v.videoWidth, height: v.videoHeight },
            picture: { width: canvas.width, height: canvas.height, via: canvas.dataset.via },
            view: viewSize(v),
            frame: frameShare(v, ratio()),
            sheet,
            crop: { width: crop.width, height: crop.height },
            rowPixels: reading.rowPixels,
            from: reading.from,
            to: reading.to,
            printed: reading.printed,
            days: reading.days.map(({ rowImage: _r, noteImage: _n, ...d }) => d),
          };
          save(new Blob([JSON.stringify(info, null, 1)], { type: 'application/json' }), `${name}.json`);
        }
        if (!alive) return;
        if (small) return setPhase({ kind: 'small' });
        if (notCloser) {
          setNote({ text: t('tcscan.notCloser', span(target)), kind: 'warn' });
          return setPhase({ kind: 'aiming', hint: 'closer' });
        }
        if (now === 'page') {
          if (!read) return setPhase({ kind: 'failed' });
          const dates = reading.days.map((d) => d.date).sort();
          const from = reading.from ?? dates[0];
          const to = reading.to ?? dates[dates.length - 1];
          // Which card: its period and when it was printed.
          const key = `${from}|${to}|${reading.printed ?? ''}`;
          const again = cards.current.get(key);
          const next: Card = again ?? { key, dates: datesBetween(from, to), readings: [] };
          next.rowPixels = reading.rowPixels;
          next.readings.push(reading);
          cards.current.set(key, next);
          setCard(next);
          setPages((n) => n + 1);
          navigator.vibrate?.(80);
          onPage({ reading, step: now });
          setNote(again ? { text: t('tcscan.sameCard'), kind: 'ok' } : { text: t('tcscan.newCard', { month: fmt.month(`${from.slice(0, 7)}-01`) }), kind: 'ok' });
          setStep('top');
        } else if (current) {
          const got = reading.days.map((d) => d.date).sort();
          if (!got.length) return setPhase({ kind: 'failed' });
          current.readings.push(reading);
          setCard(current);
          onPage({ reading, step: now });
          const hit = target.filter((d) => got.includes(d)).length;
          if (hit >= target.length * 0.6) {
            navigator.vibrate?.(80);
            if (now === 'top') {
              setNote({ text: t('tcscan.partDone', span(target)), kind: 'ok' });
              setStep('bottom');
            } else finishCard(current);
          } else {
            // Another part of the card: still a reading of those days; say where to go.
            const middle = (ds: string[]) => ds.reduce((sum, d) => sum + Number(d.slice(8)), 0) / ds.length;
            const dir = middle(got) < middle(target) ? 'down' : 'up';
            setNote({ text: t(`tcscan.wrongPart.${dir}`, { got: `${span(got).from}–${span(got).to}`, want: `${span(target).from}–${span(target).to}` }), kind: 'warn' });
          }
        }
        setPhase({ kind: 'aiming', hint: 'find' });
      } catch {
        if (alive) setPhase({ kind: 'failed' });
      } finally {
        // A moment to move to the next part before looking again.
        window.setTimeout(() => {
          busy.current = false;
          last.current = null;
        }, 2000);
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

  // The frame takes the step's shape at once (the camera loop pauses while a picture is read).
  useEffect(() => {
    const v = video.current;
    if (v?.videoWidth) setFrameOnScreen(onScreen(v, frameShare(v, step === 'page' ? PAGE_RATIO : PART_RATIO)));
  }, [step]);

  /** All steps of a card done: how it stands, then ready for the next card. */
  function finishCard(c: Card) {
    const states = [...dayStates(c).values()].filter((d) => d && d.status !== 'empty');
    const sure = states.filter((d) => d!.status === 'ok').length;
    setNote({ text: t('tcscan.cardDone', { ok: sure, check: states.length - sure }), kind: sure === states.length ? 'ok' : 'warn' });
    setStep('page');
  }

  const skip = () => {
    if (step === 'top') setStep('bottom');
    else if (cardRef.current) finishCard(cardRef.current);
    setNote(null);
  };

  const target = stepDates(card, step);
  const status =
    phase.kind === 'reading'
      ? t('tcscan.reading')
      : phase.kind === 'failed'
        ? t('tcscan.failed')
        : phase.kind === 'small'
          ? t('tcscan.small')
          : phase.kind === 'aiming'
            ? `${ARROWS[phase.hint as Aim] ?? ''} ${t(phase.hint === 'closer' && step !== 'page' ? 'tcscan.hint.closerPart' : `tcscan.hint.${phase.hint}`)}`.trim()
            : t('tcscan.starting');
  const steps: ScanStep[] = ['page', 'top', 'bottom'];
  const stepLabel = (s: ScanStep) => (s === 'page' ? t('tcscan.step.page') : card ? t('tcscan.step.part', span(stepDates(card, s))) : t(`tcscan.step.${s}`));

  return (
    <div className="scanner" role="dialog" aria-modal="true" aria-label={t('tcscan.title')}>
      <div className="scanner-view">
        <video ref={video} className="scanner-video" playsInline muted />
        {frameOnScreen && <div className={`tcscan-frame ${step !== 'page' ? 'tcscan-frame-part' : ''}`} style={frameOnScreen} aria-hidden="true" />}
        {outline && (
          <div
            className={`tcscan-page ${outline.ready ? 'tcscan-page-ready' : ''}`}
            style={{ left: outline.left, top: outline.top, width: outline.width, height: outline.height }}
            aria-hidden="true"
          />
        )}
        <ol className="tcscan-steps">
          {steps.map((s, i) => {
            const done = card && steps.indexOf(step) > i;
            return (
              <li key={s} className={s === step ? 'tcscan-step-now' : done ? 'tcscan-step-done' : ''}>
                {done ? '✓' : i + 1} {stepLabel(s)}
              </li>
            );
          })}
        </ol>
        <CardMap card={card} target={step === 'page' ? null : target} t={t} />
        {error && <p className="scanner-status tcscan-error">{t('tcscan.noCamera')}</p>}
        <div className="scanner-status">
          {test && <div className="tcscan-test">{t('tcscan.test')}</div>}
          {note && <div className={`tcscan-note tcscan-note-${note.kind}`}>{note.text}</div>}
          <div className="tcscan-do">{step === 'page' ? t('tcscan.do.page') : t('tcscan.do.part', span(target))}</div>
          <div className={`scanner-pill ${phase.kind === 'reading' ? 'scanner-pill-ok' : phase.kind === 'failed' || phase.kind === 'small' ? 'scanner-pill-warn' : ''}`}>
            {status}
            {pages > 0 && <div className="tcscan-count">{t('tcscan.cards', { n: cards.current.size })}</div>}
          </div>
        </div>
      </div>
      <div className="scanner-controls">
        <button type="button" className="button" onClick={onClose}>
          {pages ? t('tcscan.done') : t('common.close')}
        </button>
        <button type="button" className="scanner-shutter" aria-label={t('tcscan.capture')} disabled={phase.kind === 'reading'} onClick={() => void capture.current()} />
        {step !== 'page' ? (
          <button type="button" className="button" onClick={skip}>
            {t('tcscan.skip')}
          </button>
        ) : (
          <span className="tcscan-spacer" />
        )}
      </div>
    </div>
  );
}

/**
 * The card in miniature: a row per date, green when certain, orange when not
 * (yet), grey without stamps; the part to aim at outlined in blue.
 */
function CardMap({ card, target, t }: { card: Card | null; target: string[] | null; t: ReturnType<typeof useApp>['t'] }) {
  const W = 70;
  const H = 99;
  const top = 16;
  const bottom = 90;
  const dates = card?.dates ?? Array.from({ length: 31 }, (_, i) => String(i));
  const states = dayStates(card);
  const rowH = (bottom - top) / dates.length;
  const first = target ? dates.indexOf(target[0]) : 0;
  const lastRow = target ? dates.indexOf(target[target.length - 1]) : dates.length - 1;
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
        {(target || !card) && (
          <rect
            x="2.5"
            y={target ? top + first * rowH - 1.5 : 2}
            width={target ? (W - 10) * 0.72 + 5 : W - 5}
            height={target ? (lastRow - first + 1) * rowH + 3 : H - 4}
            rx="2"
            fill="none"
            stroke="#2563eb"
            strokeWidth="2"
          />
        )}
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

/** The picture at the camera's full resolution: a photo where the browser can take one, else the video frame. */
async function fullResolution(stream: MediaStream, v: HTMLVideoElement, ratio: number): Promise<HTMLCanvasElement> {
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
