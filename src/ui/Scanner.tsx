import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app-context.ts';
import { quickReadImage, readPhoto, warmUp } from '../ocr/browser.ts';
import { confirms, consensus, guideBox, guideLocation, hintFor, HISTORY, readRegion, type Hint } from '../ocr/live.ts';
import type { ClockReading, QuickReading } from '../ocr/pipeline.ts';

// Live camera scanner for the clock screen. The user lines the clock's table
// up with a guide shaped like it; the area inside the guide is read again and
// again, hints come from what was read, and the data counts as grabbed when
// the readings of several frames and a full reading agree (see live.ts).
// Nothing depends on the screen's colours.

/** Full readings that didn't confirm the fast ones before suggesting the shutter. */
const STUCK_AFTER = 3;

/** Longest side of the guide area that is read, in pixels. */
const READ_WIDTH = 1600;

export interface Scan {
  file: File;
  reading: ClockReading;
}

type Phase =
  | { kind: 'starting' }
  | { kind: 'aiming'; hint: Hint | 'loading' | 'stuck'; latest: QuickReading | null }
  | { kind: 'reading' }
  | { kind: 'done'; scan: Scan; complete: boolean }
  | { kind: 'error'; reason: 'denied' | 'unavailable' };

const HINT_TEXT = {
  loading: 'scan.loading',
  place: 'scan.place',
  needDate: 'scan.needDate',
  needRows: 'scan.needRows',
  closer: 'scan.closer',
  further: 'scan.further',
  center: 'scan.center',
  straighten: 'scan.straighten',
  steady: 'scan.steady',
  stuck: 'scan.stuck',
} as const;

/** The guide area of the current video frame, drawn onto a canvas. */
function grab(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
  const guide = guideBox(video.videoWidth, video.videoHeight);
  const region = readRegion(guide, video.videoWidth, video.videoHeight);
  const scale = Math.min(1, READ_WIDTH / region.width);
  canvas.width = Math.round(region.width * scale);
  canvas.height = Math.round(region.height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(video, region.left, region.top, region.width, region.height, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return {
    image: { width: data.width, height: data.height, data: data.data },
    loc: guideLocation(guide, region.left, region.top, scale),
  };
}

const toFile = (canvas: HTMLCanvasElement) =>
  new Promise<File>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(new File([b], `klocka-${Date.now()}.jpg`, { type: 'image/jpeg' })) : reject(new Error('capture failed'))), 'image/jpeg', 0.92),
  );

export function Scanner({ onScanned, onClose, onPickFiles }: { onScanned: (scan: Scan) => void; onClose: () => void; onPickFiles: () => void }) {
  const { t, fmt } = useApp();
  const video = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' });
  const [frame, setFrame] = useState({ width: 16, height: 9 });
  const manual = useRef(false);

  // Camera on while the scanner is open; text recognition loads meanwhile.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let alive = true;
    warmUp();
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('unavailable');
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
          audio: false,
        });
        if (!alive) return;
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        setFrame({ width: v.videoWidth, height: v.videoHeight });
        setPhase({ kind: 'aiming', hint: 'loading', latest: null });
      } catch (e) {
        if (!alive) return;
        const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
        setPhase({ kind: 'error', reason: denied ? 'denied' : 'unavailable' });
      }
    })();
    return () => {
      alive = false;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  // Read the guide area over and over until the data is confirmed.
  const aiming = phase.kind === 'aiming';
  useEffect(() => {
    if (!aiming) return;
    let alive = true;
    const canvas = document.createElement('canvas');
    (async () => {
      let history: QuickReading[] = [];
      let failedConfirms = 0;
      while (alive) {
        const v = video.current;
        if (!v || v.videoWidth === 0) {
          await new Promise((r) => setTimeout(r, 100));
          continue;
        }
        setFrame({ width: v.videoWidth, height: v.videoHeight });
        const { image, loc } = grab(v, canvas);
        if (manual.current) {
          // Shutter pressed: read this frame as well as possible and hand it over as it is.
          manual.current = false;
          v.pause();
          setPhase({ kind: 'reading' });
          const reading = await readPhoto(image, loc);
          if (!alive) return;
          setPhase({ kind: 'done', scan: { file: await toFile(canvas), reading }, complete: false });
          return;
        }
        const q = await quickReadImage(image, loc);
        if (!alive) return;
        const hint = hintFor(q);
        setPhase({ kind: 'aiming', hint: hint === 'steady' && failedConfirms >= STUCK_AFTER ? 'stuck' : hint, latest: q });
        // Only readings from a well-placed table count; others let the oldest one go.
        history = hint === 'steady' ? [...history, q].slice(-HISTORY) : history.slice(1);
        const agreed = consensus(history);
        if (!agreed) continue;
        // Keep this frame while the full reading runs on it.
        const file = await toFile(canvas);
        const full = await readPhoto(image, loc);
        if (!alive) return;
        if (confirms(full, agreed)) {
          v.pause();
          navigator.vibrate?.(80);
          // Several frames and the full reading agree, so nothing is left in doubt.
          const reading: ClockReading = { ...full, dateUncertain: false, rows: agreed.rows };
          setPhase({ kind: 'done', scan: { file, reading }, complete: true });
          return;
        }
        failedConfirms++;
        history = history.slice(1);
      }
    })();
    return () => {
      alive = false;
    };
  }, [aiming]);

  // Show the result for a moment, then go on to checking the times.
  useEffect(() => {
    if (phase.kind !== 'done') return;
    const timer = setTimeout(() => onScanned(phase.scan), phase.complete ? 1500 : 300);
    return () => clearTimeout(timer);
  }, [phase, onScanned]);

  const guide = guideBox(frame.width, frame.height);
  const barHeight = guide.barBottom - guide.top;
  const done = phase.kind === 'done' ? phase : null;
  const shown = done ? done.scan.reading : phase.kind === 'aiming' ? phase.latest : null;
  const rowsText = (shown?.rows ?? []).map((r) => `${r.in ?? '–'}–${r.out ?? '–'}`).join(', ');

  let message: string;
  let tone: 'info' | 'ok' | 'warn' = 'info';
  if (phase.kind === 'starting') message = t('scan.starting');
  else if (phase.kind === 'reading') message = t('scan.reading');
  else if (phase.kind === 'error') {
    message = t(phase.reason === 'denied' ? 'scan.denied' : 'scan.unavailable');
    tone = 'warn';
  } else if (phase.kind === 'done') {
    tone = phase.complete ? 'ok' : 'info';
    const r = phase.scan.reading;
    message = phase.complete
      ? t(r.rows.length === 1 ? 'scan.doneOne' : 'scan.done', { date: r.date ? fmt.date(r.date) : '', n: r.rows.length })
      : t('scan.check');
  } else {
    message = t(HINT_TEXT[phase.hint]);
    if (phase.hint === 'steady') tone = 'ok';
  }

  return (
    <div className="scanner" role="dialog" aria-modal="true" aria-label={t('scan.title')}>
      <div className="scanner-view">
        <video ref={video} className="scanner-video" playsInline muted />
        {phase.kind !== 'error' && (
          <svg className="scanner-hud" viewBox={`0 0 ${frame.width} ${frame.height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            <defs>
              <mask id="scanner-cutout">
                <rect width={frame.width} height={frame.height} fill="white" />
                <rect x={guide.left} y={guide.top} width={guide.width} height={guide.height} fill="black" />
              </mask>
            </defs>
            <rect width={frame.width} height={frame.height} className="scanner-dim" mask="url(#scanner-cutout)" />
            {/* A sketch of the clock's table: date bar, column header, stamp rows. */}
            <g className={`scanner-template ${done?.complete ? 'scanner-template-done' : ''}`} fontSize={barHeight * 0.42}>
              <rect x={guide.left} y={guide.top} width={guide.width} height={barHeight} className="scanner-bar" />
              <text x={guide.left + guide.width * 0.03} y={guide.top + barHeight * 0.68} className="scanner-ghost">
                ‹‹ Föreg Dag
              </text>
              <text x={guide.left + guide.width / 2} y={guide.top + barHeight * 0.68} className="scanner-ghost" textAnchor="middle">
                {t('scan.dateHere')}
              </text>
              <text x={guide.left + guide.width * 0.97} y={guide.top + barHeight * 0.68} className="scanner-ghost" textAnchor="end">
                Nästa Dag ››
              </text>
              <line
                x1={guide.left}
                x2={guide.left + guide.width}
                y1={guide.barBottom + barHeight * 0.9}
                y2={guide.barBottom + barHeight * 0.9}
                className="scanner-rule"
              />
              {['In', 'Ut'].map((label, i) => (
                <text key={label} x={guide.left + guide.width * (i === 0 ? 0.5 : 0.71)} y={guide.barBottom + barHeight * 0.62} className="scanner-ghost" textAnchor="middle">
                  {label}
                </text>
              ))}
              <rect x={guide.left} y={guide.top} width={guide.width} height={guide.height} className="scanner-guide" />
            </g>
            {done?.complete && (
              <g className="scanner-check" transform={`translate(${frame.width / 2} ${guide.top + guide.height * 0.6}) scale(${guide.height / 110})`}>
                <circle r="34" />
                <path d="M-15 1 -4 12 17 -11" />
              </g>
            )}
          </svg>
        )}
        {(phase.kind === 'aiming' || phase.kind === 'done') && (
          // While aiming only what was found; the times themselves once they are confirmed.
          <div className="scanner-readout">
            <span className={done ? 'scanner-chip scanner-chip-ok' : 'scanner-chip'}>
              {t('scan.dateChip')}: {shown?.date ? fmt.date(shown.date) : '…'}
            </span>
            <span className={done ? 'scanner-chip scanner-chip-ok' : 'scanner-chip'}>
              {t('scan.timesChip')}: {done ? rowsText || '–' : shown?.rows.length ? t(shown.rows.length === 1 ? 'scan.rowFound' : 'scan.rowsFound', { n: shown.rows.length }) : '…'}
            </span>
          </div>
        )}
      </div>

      <div className={`scanner-message scanner-message-${tone}`} role="status" aria-live="polite">
        {(phase.kind === 'reading' || (phase.kind === 'aiming' && phase.hint === 'loading')) && <span className="spinner-dot" aria-hidden="true" />}
        {message}
      </div>

      <div className="scanner-controls">
        <button type="button" className="button" onClick={onClose}>
          {t('common.close')}
        </button>
        {phase.kind === 'error' ? (
          <button type="button" className="button button-primary" onClick={onPickFiles}>
            {t('scan.pickInstead')}
          </button>
        ) : (
          <button
            type="button"
            className="scanner-shutter"
            aria-label={t('scan.takeNow')}
            disabled={phase.kind !== 'aiming'}
            onClick={() => (manual.current = true)}
          />
        )}
        <button type="button" className="button" onClick={onPickFiles} disabled={phase.kind === 'reading'}>
          {t('scan.pick')}
        </button>
      </div>
    </div>
  );
}
