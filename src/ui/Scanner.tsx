import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app-context.ts';
import { loadPhoto, readPhoto } from '../ocr/browser.ts';
import { ANALYSIS_WIDTH, checkFrame, guideBox, isSteady, readingComplete, type FrameCheck, type FrameStatus } from '../ocr/live.ts';
import type { ClockReading } from '../ocr/pipeline.ts';

// Live camera scanner for the clock screen: a guide shows where the table
// should be, each frame is checked for distance, tilt and position, and when
// the table has been in place and steady for a moment the frame is captured
// and read. Success is shown before the times go to the review dialog.

/** Checks per second while looking for the table. */
const CHECK_MS = 250;
/** Steady, well-placed checks in a row before capturing. */
const STEADY_CHECKS = 3;
/** Captures to try before handing the best one over for checking by hand. */
const MAX_TRIES = 3;

export interface Scan {
  file: File;
  reading: ClockReading;
}

type Phase =
  | { kind: 'starting' }
  | { kind: 'aiming'; check: FrameCheck; steady: number; note?: 'retry' }
  | { kind: 'reading' }
  | { kind: 'done'; scan: Scan }
  | { kind: 'error'; reason: 'denied' | 'unavailable' };

function captureJpeg(video: HTMLVideoElement): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d')!.drawImage(video, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(new File([b], `klocka-${Date.now()}.jpg`, { type: 'image/jpeg' })) : reject(new Error('capture failed'))),
      'image/jpeg',
      0.92,
    ),
  );
}

const STATUS_TEXT: Record<FrameStatus, 'scan.searching' | 'scan.closer' | 'scan.further' | 'scan.straighten' | 'scan.center' | 'scan.hold'> = {
  searching: 'scan.searching',
  closer: 'scan.closer',
  further: 'scan.further',
  straighten: 'scan.straighten',
  center: 'scan.center',
  ok: 'scan.hold',
};

export function Scanner({ onScanned, onClose, onPickFiles }: { onScanned: (scan: Scan) => void; onClose: () => void; onPickFiles: () => void }) {
  const { t, fmt } = useApp();
  const video = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' });
  const [frame, setFrame] = useState({ width: 16, height: 9 });
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const busy = useRef(false);
  const tries = useRef<Scan[]>([]);

  // Camera on while the scanner is open.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let alive = true;
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
        setPhase({ kind: 'aiming', check: { status: 'searching' }, steady: 0 });
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

  const capture = async () => {
    const v = video.current;
    if (!v || busy.current) return;
    busy.current = true;
    v.pause();
    setPhase({ kind: 'reading' });
    try {
      const file = await captureJpeg(v);
      const photo = await loadPhoto(file);
      const reading = await readPhoto(photo.image);
      const scan = { file, reading };
      tries.current.push(scan);
      if (readingComplete(reading) || tries.current.length >= MAX_TRIES) {
        // After a few tries, hand over the reading that got the most, to check by hand.
        const best = readingComplete(reading) ? scan : [...tries.current].sort((a, b) => score(b.reading) - score(a.reading))[0];
        navigator.vibrate?.(80);
        setPhase({ kind: 'done', scan: best });
        return;
      }
    } catch {
      // Fall through to another try.
    } finally {
      busy.current = false;
    }
    setPhase({ kind: 'aiming', check: { status: 'searching' }, steady: 0, note: 'retry' });
    void v.play();
  };

  // Check frames while aiming; capture once the table is placed and steady.
  useEffect(() => {
    if (phase.kind !== 'aiming') return;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const timer = setInterval(() => {
      const v = video.current;
      const current = phaseRef.current;
      if (!v || busy.current || current.kind !== 'aiming' || v.videoWidth === 0) return;
      const scale = Math.min(1, ANALYSIS_WIDTH / v.videoWidth);
      canvas.width = Math.round(v.videoWidth * scale);
      canvas.height = Math.round(v.videoHeight * scale);
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const check = checkFrame({ width: data.width, height: data.height, data: data.data });
      const steady = check.status === 'ok' && isSteady(current.check.bar, check.bar) ? current.steady + 1 : check.status === 'ok' ? 1 : 0;
      setFrame({ width: v.videoWidth, height: v.videoHeight });
      setPhase({ kind: 'aiming', check, steady, note: check.status === 'ok' ? undefined : current.note });
      if (steady >= STEADY_CHECKS) void capture();
    }, CHECK_MS);
    return () => clearInterval(timer);
    // Restart only when entering or leaving the aiming phase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.kind]);

  // Show the success for a moment, then go on to checking the times.
  useEffect(() => {
    if (phase.kind !== 'done') return;
    const timer = setTimeout(() => onScanned(phase.scan), 1400);
    return () => clearTimeout(timer);
  }, [phase, onScanned]);

  const guide = guideBox(frame.width, frame.height);
  const analysisScale = frame.width / Math.min(frame.width, ANALYSIS_WIDTH);
  const check = phase.kind === 'aiming' ? phase.check : undefined;
  const bar = check?.bar;
  const ok = check?.status === 'ok';

  let message: string;
  let tone: 'info' | 'ok' | 'warn' = 'info';
  if (phase.kind === 'starting') message = t('scan.starting');
  else if (phase.kind === 'reading') message = t('scan.reading');
  else if (phase.kind === 'error') {
    message = t(phase.reason === 'denied' ? 'scan.denied' : 'scan.unavailable');
    tone = 'warn';
  } else if (phase.kind === 'done') {
    const r = phase.scan.reading;
    tone = readingComplete(r) ? 'ok' : 'warn';
    message = readingComplete(r)
      ? t(r.rows.length === 1 ? 'scan.doneOne' : 'scan.done', { date: r.date ? fmt.date(r.date) : '', n: r.rows.length })
      : t('scan.partial');
  } else {
    message = phase.note === 'retry' && !ok ? `${t('scan.retry')} ${t(STATUS_TEXT[phase.check.status])}` : t(STATUS_TEXT[phase.check.status]);
    if (ok) tone = 'ok';
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
                <rect x={guide.left} y={guide.top} width={guide.width} height={guide.height} rx={guide.width * 0.02} fill="black" />
              </mask>
            </defs>
            <rect width={frame.width} height={frame.height} className="scanner-dim" mask="url(#scanner-cutout)" />
            <rect
              x={guide.left}
              y={guide.top}
              width={guide.width}
              height={guide.height}
              rx={guide.width * 0.02}
              className={`scanner-guide ${ok ? 'scanner-guide-ok' : ''} ${phase.kind === 'done' ? 'scanner-guide-done' : ''}`}
            />
            <line x1={guide.left + guide.width * 0.04} x2={guide.left + guide.width * 0.96} y1={guide.barY} y2={guide.barY} className="scanner-barline" />
            <text x={frame.width / 2} y={guide.top - guide.height * 0.06} className="scanner-label" fontSize={guide.height * 0.09}>
              {t('scan.barHere')}
            </text>
            {bar && (
              <polygon
                className={ok ? 'scanner-found scanner-found-ok' : 'scanner-found'}
                points={barCorners(bar)
                  .map(([x, y]) => `${x * analysisScale},${y * analysisScale}`)
                  .join(' ')}
              />
            )}
            {phase.kind === 'done' && readingComplete(phase.scan.reading) && (
              <g className="scanner-check" transform={`translate(${frame.width / 2} ${guide.top + guide.height / 2}) scale(${guide.height / 100})`}>
                <circle r="34" />
                <path d="M-15 1 -4 12 17 -11" />
              </g>
            )}
          </svg>
        )}
      </div>

      <div className={`scanner-message scanner-message-${tone}`} role="status" aria-live="polite">
        {phase.kind === 'reading' && <span className="spinner-dot" aria-hidden="true" />}
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
            onClick={() => void capture()}
          />
        )}
        <button type="button" className="button" onClick={onPickFiles} disabled={phase.kind === 'reading'}>
          {t('scan.pick')}
        </button>
      </div>
    </div>
  );
}

/** Corners of the tilted date bar, from its upright bounds and angle. */
function barCorners(bar: NonNullable<FrameCheck['bar']>): [number, number][] {
  const drop = Math.tan(bar.angle) * (bar.right - bar.left);
  return [
    [bar.left, bar.top + Math.max(0, -drop)],
    [bar.right, bar.top + Math.max(0, drop)],
    [bar.right, bar.bottom - Math.max(0, -drop)],
    [bar.left, bar.bottom - Math.max(0, drop)],
  ];
}

/** How much of the day a reading got, for picking the best of several tries. */
function score(r: ClockReading): number {
  const times = r.rows.reduce((n, row) => n + (row.in && !row.inUncertain ? 1 : 0) + (row.out && !row.outUncertain ? 1 : 0), 0);
  return (r.date ? 10 : 0) + times * 2 - r.issues.length;
}
