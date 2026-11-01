import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app-context.ts';
import type { PaySlip } from '../domain/payslip.ts';
import { aimAt, findPage, SLIP_GAPS, type Aim, type FoundPage } from '../ocr/pageFind.ts';
import { cropToPage, difference, frameShare, onScreen, picture, sharpness, shrinkBy3, videoSample } from './camera.ts';

// A live scanner for paper pay slips, like the timecard scanner: hold the
// slip in the frame and the picture is taken by itself the moment it is
// steady and sharp, cut to the page and read (PaddleOCR, see
// ocr/paddle.ts) while the next slip is put down. A reading that doesn't
// add up gets another picture while the slip is still in view, and the most
// complete reading is kept. Each slip is saved as soon as it is read.

const PAGE_RATIO = 297 / 210;
/** How long the picture must be steady before it is taken (ms). */
const STEADY_MS = 350;
/** Pictures of one slip at most, when its readings don't add up. */
const MAX_SHOTS = 3;

type Phase = { kind: 'starting' } | { kind: 'aiming'; hint: Exclude<Aim, 'ready'> | 'steady' } | { kind: 'next' };

const ARROWS: Partial<Record<Aim, string>> = { left: '←', right: '→', up: '↑', down: '↓' };

/** What became of a slip read in the scanner (said in its list). */
export interface SlipOutcome {
  status: 'saved' | 'duplicate' | 'none';
  period?: string;
  /** Saved but to be checked (its lines don't add up, or its period is uncertain). */
  check?: boolean;
}

/** How complete a reading is: its lines add up to its gross pay, and it has a period and a pay day. */
export function completeness(slip: PaySlip): number {
  const sum = slip.lines.reduce((s, l) => s + (l.amount ?? 0), 0);
  const addsUp = slip.gross !== undefined && slip.lines.length > 0 && Math.abs(sum - slip.gross) < 0.02;
  return (addsUp ? 4 : 0) + (slip.periodStart && !slip.periodDoubt ? 2 : 0) + (slip.payDate ? 1 : 0) + Math.min(0.9, slip.lines.length / 100);
}
const COMPLETE = 7;

interface Shot {
  blob: Blob;
  canvas: HTMLCanvasElement;
  /** Which slip (pictures of the same slip share it). */
  slip: number;
}

export function SlipScanner({ onSlip, onClose, onCameraFailed }: { onSlip: (slip: PaySlip, picture: Blob) => Promise<SlipOutcome>; onClose: () => void; onCameraFailed: () => void }) {
  const { t, fmt } = useApp();
  const video = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' });
  const [error, setError] = useState(false);
  const [note, setNote] = useState<{ text: string; kind: 'ok' | 'warn' } | null>(null);
  const [list, setList] = useState<{ key: number; text: string; kind: 'ok' | 'warn' }[]>([]);
  const [pending, setPending] = useState(0);
  const [closing, setClosing] = useState(false);
  const [torch, setTorch] = useState<{ on: boolean; set: (on: boolean) => void } | null>(null);
  const closingRef = useRef(false);
  // The callbacks as they are now: the camera keeps running however often the page around it renders.
  const onSlipRef = useRef(onSlip);
  onSlipRef.current = onSlip;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const capture = useRef<() => Promise<void>>(async () => undefined);
  /** Saves the slips read but not yet saved (waiting for a better picture). */
  const flush = useRef<() => Promise<void>>(async () => undefined);
  const found = useRef<FoundPage | null>(null);
  const [outline, setOutline] = useState<{ left: number; top: number; width: number; height: number; ready: boolean } | null>(null);
  const [frameOnScreen, setFrameOnScreen] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let alive = true;
    let working = false;
    let busy = false;
    let steadySince: number | null = null;
    let sharpest = 0;
    let last: Uint8ClampedArray | null = null;
    /** The picture when the last one was taken, to know when another slip is put there. */
    let lastShot: Uint8ClampedArray | null = null;
    let missing = 0;
    /** This slip has its picture: wait until it is taken away (or another picture is asked for). */
    let waiting = false;
    let slipNo = 0;
    const shotsOf = new Map<number, number>();
    const best = new Map<number, { slip: PaySlip; blob: Blob; score: number }>();
    const queue: Shot[] = [];
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
          audio: false,
        });
        const track = stream.getVideoTracks()[0];
        // Focus kept on what is in view, and the lamp where the phone has one.
        type Caps = MediaTrackCapabilities & { focusMode?: string[]; torch?: boolean };
        const caps = (track.getCapabilities?.() ?? {}) as Caps;
        if (caps.focusMode?.includes('continuous')) void track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => undefined);
        if (caps.torch) {
          const set = (on: boolean) => {
            void track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] }).catch(() => undefined);
            setTorch({ on, set });
          };
          setTorch({ on: false, set });
        }
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        if (!alive) return;
        setPhase({ kind: 'aiming', hint: 'find' });
        timer = window.setInterval(() => void tick(), 150);
      } catch {
        setError(true);
      }
    })();
    // The reader gets ready while the camera starts.
    void import('../ocr/browser.ts').then((m) => m.warmUpPaddle());

    const tick = async () => {
      const v = video.current;
      if (!v || busy || v.videoWidth === 0 || closingRef.current) return;
      const fine = videoSample(v, 480);
      const sample = shrinkBy3(fine);
      const moved = last ? difference(last, sample.data) : 1;
      last = sample.data;
      const page = findPage(sample, fine, SLIP_GAPS);
      found.current = page;
      const frame = frameShare(v, PAGE_RATIO);
      setFrameOnScreen(onScreen(v, frame));
      const aim = aimAt(page, frame);
      setOutline(page ? { ...onScreen(v, page), ready: aim === 'ready' } : null);
      missing = page ? 0 : missing + 1;
      if (waiting) {
        // Taken away, or quite another picture now: the next slip.
        if (missing >= 3 || (lastShot && difference(lastShot, sample.data) > 0.45)) {
          waiting = false;
          lastShot = null;
          slipNo++;
        } else return setPhase({ kind: 'next' });
      }
      if (aim !== 'ready') {
        steadySince = null;
        setPhase({ kind: 'aiming', hint: aim });
        return;
      }
      setPhase({ kind: 'aiming', hint: 'steady' });
      if (moved > 0.04) {
        steadySince = null;
        sharpest = 0;
        return;
      }
      const sharp = sharpness(fine, page!);
      sharpest = Math.max(sharpest, sharp);
      steadySince ??= performance.now();
      if (performance.now() - steadySince >= STEADY_MS && sharp >= sharpest * 0.9) await capture.current();
    };

    capture.current = async () => {
      const v = video.current;
      if (!v || !stream || busy) return;
      busy = true;
      steadySince = null;
      sharpest = 0;
      try {
        // Cut to the page with room to spare above and below: a slip's title is a short line the
        // page finder may not count as print (nor the lines under it), and background doesn't hurt the reading.
        const f = found.current;
        const top = f ? Math.max(0, f.y - f.h * 0.25) : 0;
        const roomy = f && { ...f, y: top, h: Math.min(1 - top, f.y + f.h * 1.1 - top) };
        const canvas = cropToPage(await picture(stream, v, PAGE_RATIO), roomy);
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG failed'))), 'image/jpeg', 0.9));
        lastShot = last;
        waiting = true;
        shotsOf.set(slipNo, (shotsOf.get(slipNo) ?? 0) + 1);
        queue.push({ blob, canvas, slip: slipNo });
        setPending(queue.length + (working ? 1 : 0));
        navigator.vibrate?.(30);
        setNote({ text: t('slipscan.taken'), kind: 'ok' });
        void work();
      } catch {
        if (alive) setNote({ text: t('slipscan.failed'), kind: 'warn' });
      } finally {
        busy = false;
        last = null;
      }
    };

    /** Saves a slip's best reading, and says how it went in the list. */
    const save = async (no: number) => {
      const b = best.get(no);
      best.delete(no);
      if (!b) return;
      const outcome = await onSlipRef.current(b.slip, b.blob);
      const month = outcome.period ? fmt.month(outcome.period) : '';
      const item =
        outcome.status === 'duplicate'
          ? { text: t('slipscan.duplicate', { month }), kind: 'warn' as const }
          : outcome.status === 'none'
            ? { text: t('slipscan.failed'), kind: 'warn' as const }
            : outcome.check
              ? { text: t('slipscan.check', { month }), kind: 'warn' as const }
              : { text: t('slipscan.read', { month }), kind: 'ok' as const };
      if (outcome.status !== 'none') navigator.vibrate?.(outcome.check ? [40] : [80, 60, 80]);
      setList((l) => [...l, { key: no, ...item }]);
      setNote(item);
    };

    const work = async () => {
      if (working) return;
      working = true;
      const { readPaySlipFast } = await import('../ocr/browser.ts');
      while (queue.length && alive) {
        const shot = queue.shift()!;
        setPending(queue.length + 1);
        try {
          const slip = await readPaySlipFast(shot.canvas);
          if (!alive) break;
          const score = completeness(slip);
          const prev = best.get(shot.slip);
          if (slip.lines.length && (!prev || score > prev.score)) best.set(shot.slip, { slip, blob: shot.blob, score });
          const kept = best.get(shot.slip);
          const stillHere = shot.slip === slipNo && waiting;
          if (kept && kept.score >= COMPLETE) await save(shot.slip);
          else if (stillHere && (shotsOf.get(shot.slip) ?? 0) < MAX_SHOTS) {
            // Not complete, and the slip is still in view: one more picture of it.
            waiting = false;
            setNote({ text: t('slipscan.again'), kind: 'warn' });
          } else await save(shot.slip);
        } catch {
          if (alive) setNote({ text: t('slipscan.failed'), kind: 'warn' });
        }
      }
      working = false;
      setPending(queue.length);
      if (closingRef.current && !queue.length) {
        await flush.current();
        onCloseRef.current();
      }
    };
    // Slips whose best reading wasn't complete: saved as they are, to be checked.
    flush.current = async () => {
      for (const no of [...best.keys()]) await save(no);
    };

    return () => {
      alive = false;
      window.clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Done": what is still being read is read first; then everything read is saved and the scanner closes.
  const finish = () => {
    closingRef.current = true;
    setClosing(true);
    if (!pending) void flush.current().then(() => onCloseRef.current());
  };

  const status = closing
    ? t('tcscan.finishing', { n: pending })
    : phase.kind === 'next'
      ? t('slipscan.next')
      : phase.kind === 'aiming'
        ? `${ARROWS[phase.hint as Aim] ?? ''} ${phase.hint === 'find' ? t('slipscan.find') : t(`tcscan.hint.${phase.hint}`)}`.trim()
        : t('tcscan.starting');

  return (
    <div className="scanner" role="dialog" aria-modal="true" aria-label={t('slipscan.title')}>
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
        {list.length > 0 && (
          <ul className="tcscan-cards">
            {list.map((c) => (
              <li key={c.key} className={c.kind === 'ok' ? 'tcscan-card-done' : 'tcscan-card-open'}>
                {c.text}
              </li>
            ))}
          </ul>
        )}
        {error && (
          <div className="scanner-status tcscan-error">
            <p>{t('tcscan.noCamera')}</p>
            <button type="button" className="button" onClick={onCameraFailed}>
              {t('slipscan.photoInstead')}
            </button>
          </div>
        )}
        <div className="scanner-status">
          {note && <div className={`tcscan-note tcscan-note-${note.kind}`}>{note.text}</div>}
          {!list.length && !pending && !note && <div className="tcscan-do">{t('slipscan.do')}</div>}
          <div className="scanner-pill">
            {status}
            {pending > 0 && <div className="tcscan-count">{t('slipscan.queue', { n: pending })}</div>}
          </div>
        </div>
      </div>
      <div className="scanner-controls">
        <button type="button" className="button" onClick={finish} disabled={closing}>
          {list.length || pending ? t('tcscan.done') : t('common.close')}
        </button>
        <button type="button" className="scanner-shutter" aria-label={t('tcscan.capture')} disabled={closing} onClick={() => void capture.current()} />
        {torch ? (
          <button type="button" className={`button ${torch.on ? 'button-primary' : ''}`} aria-pressed={torch.on} onClick={() => torch.set(!torch.on)}>
            {t('slipscan.torch')}
          </button>
        ) : (
          <span className="tcscan-spacer" />
        )}
      </div>
    </div>
  );
}
