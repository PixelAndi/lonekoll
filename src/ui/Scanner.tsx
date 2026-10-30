import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app-context.ts';
import type { DayRecord } from '../domain/model.ts';
import { forgottenStamps, otherDayNeeded, type ForgottenStamp } from '../domain/shifts.ts';
import { addDays, todayLocal } from '../domain/time.ts';
import { anchorInFrame, findInFrame, readPhoto, trackInFrame, warmUp } from '../ocr/browser.ts';
import { agreement, aim, HISTORY, progress, searchArea, type Aim, type FrameReading, type Hint } from '../ocr/live.ts';
import type { ClockReading, FoundTable } from '../ocr/pipeline.ts';
import { ClockHowTo } from './ClockHowTo.tsx';
import { hasScanLog, logFrame, noteScanLog, shareScanLog, startScanLog } from './scanDiagnostics.ts';
import { ScannerHud, type HudState } from './ScannerHud.tsx';

// Live camera scanner for the clock screen. The user points the camera
// roughly at the clock's table; each frame's search area is read in one pass
// and the table is found from the words on its date bar. A targeting display
// (ScannerHud) shows how to move the phone until the table is locked on, and
// the data counts as grabbed when the latest locked frames agree (see
// live.ts). Nothing depends on the screen's colours.

/** Width the search area is drawn at for reading. */
const READ_WIDTH = 1200;
/** Show a note when text recognition hasn't started after this long (first download). */
const SLOW_START_MS = 8000;
/** Reading errors in a row before giving up on the camera. */
const MAX_ERRORS = 3;

export interface Scan {
  file: File;
  reading: ClockReading;
}

type AimHint = Hint | 'loading' | 'slow' | 'wrongDay' | 'retrying';

type Phase =
  | { kind: 'starting' }
  | { kind: 'aiming'; hint: AimHint; aim: Aim | null; progress: number }
  | { kind: 'reading' }
  | { kind: 'done'; scan: Scan; complete: boolean }
  /** Read, but a stamp looks forgotten: fill it in by hand or scan again? */
  | { kind: 'missing'; scan: Scan; forgotten: ForgottenStamp[] }
  /** Read; the shift crosses midnight and its other half is on another day's screen: scan that day too? */
  | { kind: 'otherDay'; scan: Scan; date: string; direction: 'previous' | 'next' }
  | { kind: 'error'; reason: 'denied' | 'unavailable' | 'reading'; detail?: string };

const HINT_TEXT = {
  loading: 'scan.loading',
  slow: 'scan.slow',
  retrying: 'scan.retrying',
  place: 'scan.place',
  closer: 'scan.closer',
  further: 'scan.further',
  straighten: 'scan.straighten',
  needRows: 'scan.needRows',
  steady: 'scan.steady',
  wrongDay: 'scan.wrongDay',
  up: 'scan.up',
  down: 'scan.down',
  left: 'scan.left',
  right: 'scan.right',
} as const;

/** A scan as the day it will be saved as, to check it together with the logged days. */
const asDay = (scan: Scan): DayRecord => ({ date: scan.reading.date ?? '', rows: scan.reading.rows, photoIds: [], updatedAt: 0 });

/** The search area of the current video frame, drawn onto a canvas. */
function grab(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
  const area = searchArea(video.videoWidth, video.videoHeight);
  const scale = Math.min(1, READ_WIDTH / area.width);
  canvas.width = Math.round(area.width * scale);
  canvas.height = Math.round(area.height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(video, area.left, area.top, area.width, area.height, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: data.width, height: data.height, data: data.data };
}

const toFile = (canvas: HTMLCanvasElement) =>
  new Promise<File>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(new File([b], `klocka-${Date.now()}.jpg`, { type: 'image/jpeg' })) : reject(new Error('capture failed'))), 'image/jpeg', 0.92),
  );

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Scanner({
  onScanned,
  onClose,
  onPickFiles,
  onManual,
}: {
  /** One scan, or several when a shift's halves were scanned from two days' screens. */
  onScanned: (scans: Scan[]) => void;
  onClose: () => void;
  onPickFiles: () => void;
  /** Type the day in by hand instead. */
  onManual: () => void;
}) {
  const { t, fmt, days, settings } = useApp();
  const diagnostics = !!settings.scanDiagnostics;
  const diagnosticsRef = useRef(diagnostics);
  diagnosticsRef.current = diagnostics;
  const [diagnosticsShared, setDiagnosticsShared] = useState<string | null>(null);
  const daysRef = useRef(days);
  daysRef.current = days;
  const video = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' });
  const [frame, setFrame] = useState({ width: 16, height: 9 });
  const manual = useRef(false);
  /** Scans waiting for the other day of a shift over midnight. */
  const pending = useRef<Scan[]>([]);
  /** The day the user was asked to scan next, if any. */
  const [target, setTarget] = useState<{ date: string; direction: 'previous' | 'next' } | null>(null);
  const targetRef = useRef(target);
  targetRef.current = target;
  /** The day the other day is scanned from, for the how-to sketch. */
  const [fromDate, setFromDate] = useState<string | null>(null);
  const [showHow, setShowHow] = useState(false);

  // Camera on while the scanner is open; text recognition loads meanwhile.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let alive = true;
    warmUp();
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('unavailable');
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (!alive) return;
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        setFrame({ width: v.videoWidth, height: v.videoHeight });
        startScanLog({ width: v.videoWidth, height: v.videoHeight });
        setPhase({ kind: 'aiming', hint: 'loading', aim: null, progress: 0 });
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

  // Read frame after frame until the latest readings agree.
  const aiming = phase.kind === 'aiming';
  useEffect(() => {
    if (!aiming) return;
    let alive = true;
    // Scanning again after a question: the video was paused on the read frame.
    if (video.current?.paused) void video.current.play();
    const canvas = document.createElement('canvas');
    let started = false;
    // The first reading waits for text recognition to load (about 7 MB the first time).
    const slow = setTimeout(() => {
      if (alive && !started) setPhase((p) => (p.kind === 'aiming' && p.hint === 'loading' ? { ...p, hint: 'slow' } : p));
    }, SLOW_START_MS);
    (async () => {
      let history: FrameReading[] = [];
      let lastFound: FoundTable | null = null;
      // Once locked on, the table is followed from frame to frame instead of searched for.
      let following: FoundTable | null = null;
      let errors = 0;
      let wasLocked = false;
      while (alive) {
        const v = video.current;
        if (!v || v.videoWidth === 0) {
          await new Promise((r) => setTimeout(r, 100));
          continue;
        }
        setFrame({ width: v.videoWidth, height: v.videoHeight });
        const image = grab(v, canvas);
        if (manual.current) {
          // Shutter pressed: read this frame as well as possible and hand it over as it is.
          manual.current = false;
          v.pause();
          setPhase({ kind: 'reading' });
          let reading: ClockReading;
          try {
            reading = await readPhoto(image, lastFound?.loc);
          } catch {
            reading = { date: null, dateUncertain: true, rows: [], issues: ['no-table'], confidence: 0 };
          }
          if (diagnosticsRef.current) {
            logFrame(canvas, { mode: 'shutter', ms: 0, hint: 'shutter', found: lastFound, votes: 0, agreed: false });
            noteScanLog(`shutter read: ${reading.date ?? '-'} ${reading.rows.map((r) => `${r.in ?? '?'}-${r.out ?? '?'}`).join(',')} issues=${reading.issues.join(',')}`);
          }
          if (!alive) return;
          setPhase({ kind: 'done', scan: { file: await toFile(canvas), reading }, complete: false });
          return;
        }
        let found: FoundTable | null;
        const frameStart = performance.now();
        let mode = 'find';
        try {
          found = following ? await trackInFrame(image, following) : null;
          if (following) mode = found ? 'track' : 'lost+find';
          // Not locked on yet, or lost: search the whole area.
          if (!found) found = await findInFrame(image);
          started = true;
          errors = 0;
        } catch (e) {
          if (!alive) return;
          errors++;
          if (diagnosticsRef.current) noteScanLog(`error: ${errorText(e)}`);
          if (errors >= MAX_ERRORS) {
            setPhase({ kind: 'error', reason: 'reading', detail: errorText(e) });
            return;
          }
          setPhase({ kind: 'aiming', hint: 'retrying', aim: null, progress: 0 });
          await new Promise((r) => setTimeout(r, 800));
          continue;
        }
        if (!alive) return;
        if (found) lastFound = found;
        const a = aim(found, image.width, image.height);
        let hint: AimHint = a?.hint ?? 'place';
        // A short tick when it locks on.
        if (a?.locked && !wasLocked) navigator.vibrate?.(15);
        wasLocked = !!a?.locked;
        // Locked on: follow the table from here (a table just found is anchored in this frame).
        following = a?.locked && found ? (found.track ? found : await anchorInFrame(image, found)) : null;
        // Asked for another day, but the clock still shows a different one.
        const wanted = targetRef.current;
        if (wanted && found?.date && found.date !== wanted.date) {
          hint = 'wrongDay';
          setShowHow(true);
        }
        // Only locked frames count towards the agreement: searched ones where both readings agree, and followed ones.
        if (hint === 'steady' && found?.confirmed) history = [...history, { date: found.date, rows: found.rows, weight: found.tracked ? 1 : 2 }].slice(-HISTORY);
        else if (hint !== 'steady') history = history.slice(1);
        setPhase({ kind: 'aiming', hint, aim: a, progress: progress(history) });
        const agreed = hint === 'steady' ? agreement(history) : null;
        if (diagnosticsRef.current) {
          logFrame(canvas, { mode, ms: performance.now() - frameStart, hint, found, aim: a, votes: progress(history), agreed: !!agreed });
        }
        if (!agreed) continue;

        v.pause();
        navigator.vibrate?.(80);
        const file = await toFile(canvas);
        const reading: ClockReading = {
          date: agreed.date,
          dateUncertain: false,
          rows: agreed.rows,
          issues: [],
          confidence: 100,
          table: { left: 0, top: 0, width: canvas.width, height: canvas.height },
        };
        const scan = { file, reading };
        // The logged days plus what was scanned just now.
        const known = [...daysRef.current, ...pending.current.map(asDay)];
        const forgotten = forgottenStamps(agreed.date, agreed.rows, known);
        const other = forgotten.length ? null : otherDayNeeded(agreed.date, agreed.rows, known, todayLocal());
        if (forgotten.length) setPhase({ kind: 'missing', scan, forgotten });
        else if (other) setPhase({ kind: 'otherDay', scan, direction: other, date: addDays(agreed.date, other === 'previous' ? -1 : 1) });
        else setPhase({ kind: 'done', scan, complete: true });
        return;
      }
    })();
    return () => {
      alive = false;
      clearTimeout(slow);
    };
  }, [aiming]);

  // Show the result for a moment, then go on to checking the times.
  useEffect(() => {
    if (phase.kind !== 'done') return;
    const timer = setTimeout(() => onScanned([...pending.current, phase.scan]), phase.complete ? 1300 : 300);
    return () => clearTimeout(timer);
  }, [phase, onScanned]);

  const area = searchArea(frame.width, frame.height);
  const toFrame = area.width / Math.min(area.width, READ_WIDTH);
  const currentAim = phase.kind === 'aiming' ? phase.aim : null;
  const locked = phase.kind === 'aiming' && phase.hint === 'steady';
  const grabbed = phase.kind === 'done' && phase.complete;
  const shown = phase.kind === 'done' || phase.kind === 'missing' || phase.kind === 'otherDay' ? phase.scan.reading : null;
  const rowsText = (shown?.rows ?? []).map((r) => `${r.in ?? '?'}–${r.out ?? '?'}`).join('  ');

  let message: string;
  let tone: 'info' | 'ok' | 'warn' = 'info';
  if (phase.kind === 'starting') message = t('scan.starting');
  else if (phase.kind === 'reading') message = t('scan.reading');
  else if (phase.kind === 'error') {
    message =
      phase.reason === 'reading'
        ? t('scan.failed', { error: phase.detail ?? '' })
        : t(phase.reason === 'denied' ? 'scan.denied' : 'scan.unavailable');
    tone = 'warn';
  } else if (phase.kind === 'missing') {
    tone = 'warn';
    message = phase.forgotten.map((f) => t(f.field === 'in' ? 'scan.forgotIn' : 'scan.forgotOut', { other: f.other ?? '' })).join(' ');
  } else if (phase.kind === 'otherDay') {
    tone = 'ok';
    message = t(phase.direction === 'previous' ? 'scan.startedBefore' : 'scan.endedAfter', { date: fmt.date(phase.date) });
  } else if (phase.kind === 'done') {
    tone = phase.complete ? 'ok' : 'info';
    message = phase.complete ? t('scan.grabbed') : t('scan.check');
  } else {
    message = t(HINT_TEXT[phase.hint], { date: target ? fmt.date(target.date) : '', shown: ''  });
    if (phase.hint === 'steady') tone = 'ok';
    if (phase.hint === 'wrongDay') tone = 'warn';
  }
  const busy = phase.kind === 'starting' || phase.kind === 'reading' || (phase.kind === 'aiming' && ['loading', 'slow', 'retrying'].includes(phase.hint));

  const dots = phase.kind === 'aiming' ? phase.progress : grabbed ? 3 : 0;
  const hudState: HudState =
    grabbed ? 'grabbed' : locked ? 'locked' : phase.kind === 'aiming' && currentAim ? 'adjusting' : phase.kind === 'aiming' && !busy ? 'searching' : 'idle';

  return (
    <div className="scanner" role="dialog" aria-modal="true" aria-label={t('scan.title')}>
      <div className="scanner-view">
        <video ref={video} className="scanner-video" playsInline muted />
        {phase.kind !== 'error' && (
          <ScannerHud
            frame={frame}
            area={area}
            toFrame={toFrame}
            aim={currentAim}
            hint={phase.kind === 'aiming' && phase.hint in HINT_TEXT ? (phase.hint as Hint) : null}
            state={hudState}
            progress={phase.kind === 'aiming' ? phase.progress : grabbed ? 3 : 0}
          />
        )}
        {phase.kind === 'otherDay' && phase.scan.reading.date && (
          <div className="scanner-howto">
            <ClockHowTo from={phase.scan.reading.date} to={phase.date} direction={phase.direction} />
          </div>
        )}
        {target && phase.kind === 'aiming' && fromDate && showHow ? (
          <div className="scanner-howto">
            <ClockHowTo from={fromDate} to={target.date} direction={target.direction} compact />
            <button type="button" className="link-button scanner-howto-hide" onClick={() => setShowHow(false)}>
              {t('scan.hideHow')}
            </button>
          </div>
        ) : (
          target &&
          phase.kind === 'aiming' && (
            <div className="scanner-target">
              <span>{t(target.direction === 'previous' ? 'scan.targetPrevious' : 'scan.targetNext', { date: fmt.date(target.date) })}</span>
              <button type="button" className="link-button" onClick={() => setShowHow(true)}>
                {t('scan.showHow')}
              </button>
            </div>
          )
        )}
        <div className="scanner-status">
          {shown && rowsText && (
            <div className="scanner-result">
              {shown.date && <strong>{fmt.date(shown.date)}</strong>} {rowsText}
            </div>
          )}
          <div className={`scanner-pill scanner-pill-${tone}`} role="status" aria-live="polite">
            {busy && <span className="spinner-dot" aria-hidden="true" />}
            <span>{message}</span>
            {(phase.kind === 'aiming' || grabbed) && (
              <span className="scanner-dots" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <i key={i} className={i < dots ? 'on' : ''} />
                ))}
              </span>
            )}
          </div>
        </div>
      </div>

      {phase.kind === 'otherDay' ? (
        <div className="scanner-question">
          <div className="scanner-question-buttons">
            <button type="button" className="button" onClick={() => onScanned([...pending.current, phase.scan])}>
              {t('scan.skipOtherDay')}
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={() => {
                pending.current = [...pending.current, phase.scan];
                setFromDate(phase.scan.reading.date);
                setTarget({ date: phase.date, direction: phase.direction });
                setPhase({ kind: 'aiming', hint: 'place', aim: null, progress: 0 });
              }}
            >
              {t('scan.scanDay', { date: fmt.date(phase.date) })}
            </button>
          </div>
        </div>
      ) : phase.kind === 'missing' ? (
        <div className="scanner-question">
          <p>{t('scan.forgotQuestion')}</p>
          <div className="scanner-question-buttons">
            <button type="button" className="button" onClick={() => setPhase({ kind: 'aiming', hint: 'place', aim: null, progress: 0 })}>
              {t('scan.again')}
            </button>
            <button type="button" className="button button-primary" onClick={() => onScanned([...pending.current, markForgotten(phase.scan, phase.forgotten)])}>
              {t('scan.fillIn')}
            </button>
          </div>
        </div>
      ) : (
        <div className="scanner-controls">
          <button type="button" className="link-button" onClick={onClose}>
            {t('common.close')}
          </button>
          {phase.kind === 'error' ? (
            <button type="button" className="button button-primary" onClick={onManual}>
              {t('scan.manual')}
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
          <div className="scanner-more">
            <button type="button" className="link-button" onClick={onManual} disabled={phase.kind === 'reading'}>
              {t('scan.manualShort')}
            </button>
            <button type="button" className="link-button" onClick={onPickFiles} disabled={phase.kind === 'reading'}>
              {t('scan.pick')}
            </button>
            {diagnostics && (
              <button
                type="button"
                className="link-button"
                onClick={async () => setDiagnosticsShared(hasScanLog() ? t(`diag.${await shareScanLog()}`) : t('diag.empty'))}
              >
                {diagnosticsShared ?? t('diag.share')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** The scan with the forgotten stamps marked, so the review points them out. */
function markForgotten(scan: Scan, forgotten: ForgottenStamp[]): Scan {
  const rows = scan.reading.rows.map((r, i) => ({
    ...r,
    inUncertain: r.inUncertain || forgotten.some((f) => f.row === i && f.field === 'in'),
    outUncertain: r.outUncertain || forgotten.some((f) => f.row === i && f.field === 'out'),
  }));
  return { ...scan, reading: { ...scan.reading, rows } };
}
