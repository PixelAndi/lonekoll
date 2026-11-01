import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app-context.ts';
import { saveSettings } from '../db.ts';
import type { TimecardReading } from '../ocr/browser.ts';
import { aimAt, findPage, type Aim, type FoundPage } from '../ocr/pageFind.ts';
import { addsUpToTotal, combineReadings, type CheckedDay } from '../ocr/timecard.ts';
import { chime, cropToPage, difference, frameShare, onScreen, picture, prepareChime, sharpness, shrinkBy3, videoSample } from './camera.ts';

// A live scanner for printed timecards. Hold the whole card in the frame:
// pictures are taken from the camera's live picture (no separate photo – the
// camera would refocus and change its colours each time) the moment it is
// steady and sharp, three of each card, each a little different; they are
// read in a queue while the next are taken, so there is no holding still
// while a picture is read. Every reading of a day is put to the vote (see
// combineReadings); a card whose readings leave days uncertain, or don't add
// up to its own total Arb Tid, asks for another picture if it is still in
// view. A row of cards shows how each stands, a map the days of the latest.
// A card scanned again is known by its period, and its readings join the
// vote. "Done" reads what is still queued, then closes.

const PAGE_RATIO = 297 / 210;
/** How long the picture must be steady before it is taken (ms): the picture is taken at once, read later. */
const STEADY_MS = 350;
/** Pictures of each card taken in a row (each a little different): most cards are certain from these. */
const SHOTS_PER_CARD = 3;
/** At most this many pictures of a card; days still not certain then are left to the review. */
const MAX_READS = 4;
/**
 * The smallest printed row (pixels in the picture) read reliably: smaller,
 * and digits are misread in ways that can still add up (tried on real cards:
 * 16 px read every day right, 13 px read some days wrong without noticing).
 */
const MIN_ROW_PIXELS = 15;

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

/** A picture taken, waiting to be read. */
interface Shot {
  blob: Blob;
  sheet: FoundPage | null;
  n: number;
}

export function TimecardScanner({ onPage, onClose }: { onPage: (page: ScannedPage) => void; onClose: () => void }) {
  const { t, fmt, settings } = useApp();
  const video = useRef<HTMLVideoElement>(null);
  const sound = useRef(settings.scanSound);
  sound.current = settings.scanSound;
  const ding = (kind: Parameters<typeof chime>[0]) => sound.current && chime(kind);
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' });
  const [error, setError] = useState(false);
  const [card, setCardState] = useState<Card | null>(null);
  /** Every card read so far, as it stands (for the row of cards at the top). */
  const [list, setList] = useState<{ key: string; month: string; done: boolean; unsure: number }[]>([]);
  /** What the last picture gave (the card done, days still to confirm …). */
  const [note, setNote] = useState<{ text: string; kind: 'ok' | 'warn' } | null>(null);
  /** Pictures waiting to be read (they are read one after another while the next are taken). */
  const [pending, setPending] = useState(0);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const cardRef = useRef<Card | null>(null);
  const cards = useRef(new Map<string, Card>());
  const setCard = (c: Card | null) => {
    cardRef.current = c;
    setCardState(c ? { ...c, readings: [...c.readings] } : null);
  };
  /** Enough pictures of the card in view: wait until it is taken away (or another is put there). */
  const waiting = useRef(false);
  /** Pictures taken of the card in view (since the view last changed a lot). */
  const shotsHere = useRef(0);
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
  /** Looks in a row without the card in the picture. */
  const missing = useRef(0);
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
    const queue: Shot[] = [];
    let working = false;
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
        timer = window.setInterval(() => void tick(), 150);
        // Start the recognition now, so the first picture isn't kept waiting for it.
        void import('../ocr/browser.ts').then((m) => m.warmUp());
        if (sound.current) prepareChime();
      } catch {
        setError(true);
      }
    })();

    /** Find the print, say how to move; in place, steady and at its sharpest: take the picture. */
    const tick = async () => {
      const v = video.current;
      if (!v || busy.current || v.videoWidth === 0 || closingRef.current) return;
      // The print's rows only show at a finer size (at 160 px across they blur into grey); the small
      // copy, to see movement and the paper, is made from it (one copy read from the camera, not two).
      const fine = videoSample(v, 480);
      const sample = shrinkBy3(fine);
      const moved = last.current ? difference(last.current, sample.data) : 1;
      last.current = sample.data;
      const page = findPage(sample, fine);
      found.current = page;
      const frame = frameShare(v, PAGE_RATIO);
      setFrameOnScreen(onScreen(v, frame));
      const aim = aimAt(page, frame);
      setOutline(page ? { ...onScreen(v, page), ready: aim === 'ready' } : null);
      missing.current = page ? 0 : missing.current + 1;
      if (waiting.current || shotsHere.current > 0) {
        // The card was taken away for a moment, or the picture is quite another now: a new card.
        // (Moving the phone a little between pictures of the same card is not.)
        if (missing.current >= 3 || (lastShot.current && difference(lastShot.current, sample.data) > 0.45)) {
          waiting.current = false;
          shotsHere.current = 0;
          lastShot.current = null;
        } else if (waiting.current) return setPhase({ kind: 'next' });
      }
      if (aim !== 'ready') {
        steadySince.current = null;
        setPhase({ kind: 'aiming', hint: aim });
        return;
      }
      if (lastShot.current && difference(lastShot.current, sample.data) < 0.02) {
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

    /** Take the picture at once and queue it for reading: the next can be taken while it is read. */
    capture.current = async () => {
      const v = video.current;
      if (!v || !stream || busy.current) return;
      busy.current = true;
      steadySince.current = null;
      sharpest.current = 0;
      try {
        const canvas = await picture(stream, v, PAGE_RATIO);
        const sheet = found.current;
        const crop = cropToPage(canvas, sheet);
        const blob = await new Promise<Blob>((resolve, reject) => crop.toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG failed'))), 'image/jpeg', 0.92));
        lastShot.current = last.current;
        shots++;
        queue.push({ blob, sheet, n: shots });
        setPending(queue.length + (working ? 1 : 0));
        navigator.vibrate?.(30);
        ding('shot');
        shotsHere.current++;
        if (shotsHere.current >= SHOTS_PER_CARD) {
          // Enough of this card for now (more are taken only if its readings ask for it).
          waiting.current = true;
          setNote({ text: t('tcscan.taken'), kind: 'ok' });
        }
        void work();
      } catch {
        if (alive) setPhase({ kind: 'failed' });
      } finally {
        busy.current = false;
        last.current = null;
      }
    };

    /** Read the pictures in the queue, one after another, and put each card's readings to the vote. */
    const work = async () => {
      if (working) return;
      working = true;
      const { readTimecardImage } = await import('../ocr/browser.ts');
      while (queue.length && alive) {
        const shot = queue.shift()!;
        setPending(queue.length + 1);
        try {
          const bitmap = await createImageBitmap(shot.blob);
          const crop = document.createElement('canvas');
          crop.width = bitmap.width;
          crop.height = bitmap.height;
          crop.getContext('2d')!.drawImage(bitmap, 0, 0);
          bitmap.close();
          const reading = await readTimecardImage(crop);
          if (!alive) break;
          const read = reading.days.filter((d) => d.status !== 'empty').length;
          if (reading.rowPixels !== undefined && reading.rowPixels < MIN_ROW_PIXELS) {
            setNote({ text: t('tcscan.small'), kind: 'warn' });
            continue;
          }
          if (!read) {
            setNote({ text: t('tcscan.failed'), kind: 'warn' });
            continue;
          }
          const dates = reading.days.map((d) => d.date).sort();
          const from = reading.from ?? dates[0];
          const to = reading.to ?? dates[dates.length - 1];
          // Which card: its period (the time it was printed is often too small to read).
          const key = `${from}|${to}`;
          const current: Card = cards.current.get(key) ?? { key, dates: datesBetween(from, to), readings: [] };
          current.readings.push(reading);
          cards.current.set(key, current);
          setCard(current);
          onPage({ reading });
          const now = standing(current);
          const month = fmt.month(`${from.slice(0, 7)}-01`);
          setList((l) => [...l.filter((c) => c.key !== key), { key, month, done: now.done, unsure: now.unsure }].sort((a, b) => a.key.localeCompare(b.key)));
          if (now.done) {
            navigator.vibrate?.([80, 60, 80]);
            ding('ok');
            setNote({ text: t('tcscan.cardDone', { month, ok: now.sure }), kind: 'ok' });
            // The card is still in view: no more pictures of it are needed.
            if (shotsHere.current > 0) waiting.current = true;
          } else if (current.readings.length >= MAX_READS) {
            setNote({ text: t('tcscan.cardLeft', { month, check: now.unsure }), kind: 'warn' });
            if (shotsHere.current > 0) waiting.current = true;
          } else if (waiting.current && shotsHere.current >= SHOTS_PER_CARD && queue.length === 0) {
            // All its pictures read and still not certain: one more, if the card is still there.
            waiting.current = false;
            shotsHere.current = SHOTS_PER_CARD - 1;
            setNote({ text: now.unsure ? t('tcscan.keep', { n: now.unsure }) : t('tcscan.totalOff'), kind: 'warn' });
          }
        } catch {
          if (alive) setNote({ text: t('tcscan.failed'), kind: 'warn' });
        }
      }
      working = false;
      setPending(queue.length);
      if (closingRef.current && !queue.length) onClose();
    };

    return () => {
      alive = false;
      window.clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onPage]);

  // "Done" with pictures still being read: read them first, then close.
  const finish = () => {
    if (!pending) return onClose();
    closingRef.current = true;
    setClosing(true);
  };

  const status = closing
    ? t('tcscan.finishing', { n: pending })
    : phase.kind === 'failed'
      ? t('tcscan.failed')
      : phase.kind === 'small'
        ? t('tcscan.small')
        : phase.kind === 'next'
          ? t('tcscan.next')
          : phase.kind === 'aiming'
            ? `${ARROWS[phase.hint as Aim] ?? ''} ${t(`tcscan.hint.${phase.hint}`)}`.trim()
            : phase.kind === 'reading'
              ? t('tcscan.reading')
              : t('tcscan.starting');

  return (
    <div className="scanner" role="dialog" aria-modal="true" aria-label={t('tcscan.title')}>
      <div className="scanner-view">
        <video ref={video} className="scanner-video scanner-video-cover" playsInline muted />
        {frameOnScreen && <div className="tcscan-frame" style={frameOnScreen} aria-hidden="true" />}
        {outline && (
          <div
            className={`tcscan-page ${outline.ready ? 'tcscan-page-ready' : ''}`}
            style={{ left: outline.left, top: outline.top, width: outline.width, height: outline.height }}
            aria-hidden="true"
          />
        )}
        <button
          type="button"
          className="scanner-sound"
          aria-pressed={settings.scanSound}
          aria-label={t('scan.sound')}
          onClick={() => {
            if (!settings.scanSound) prepareChime();
            void saveSettings({ scanSound: !settings.scanSound });
          }}
        >
          {settings.scanSound ? '🔊' : '🔇'}
        </button>
        {list.length > 0 && (
          <ul className="tcscan-cards">
            {list.map((c) => (
              <li key={c.key} className={c.done ? 'tcscan-card-done' : 'tcscan-card-open'}>
                {c.done ? '✓' : '…'} {c.month}
                {!c.done && c.unsure > 0 && <small> {t('tcscan.unsure', { n: c.unsure })}</small>}
              </li>
            ))}
          </ul>
        )}
        <CardMap card={card} t={t} />
        {error && <p className="scanner-status tcscan-error">{t('tcscan.noCamera')}</p>}
        <div className="scanner-status">
          {note && <div className={`tcscan-note tcscan-note-${note.kind}`}>{note.text}</div>}
          {!card && !pending && <div className="tcscan-do">{t('tcscan.do.page')}</div>}
          <div className={`scanner-pill ${phase.kind === 'failed' || phase.kind === 'small' ? 'scanner-pill-warn' : ''}`}>
            {status}
            {pending > 0 && <div className="tcscan-count">{t('tcscan.queue', { n: pending })}</div>}
          </div>
        </div>
      </div>
      <div className="scanner-controls">
        <button type="button" className="button" onClick={finish} disabled={closing}>
          {card || pending ? t('tcscan.done') : t('common.close')}
        </button>
        <button type="button" className="scanner-shutter" aria-label={t('tcscan.capture')} disabled={closing} onClick={() => void capture.current()} />
        <span className="tcscan-spacer" />
      </div>
    </div>
  );
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

