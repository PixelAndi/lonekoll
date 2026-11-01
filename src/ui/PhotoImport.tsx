import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../app-context.ts';
import { db, learnDigits, newId, saveDay } from '../db.ts';
import type { DayRecord, StampPair } from '../domain/model.ts';
import { forgottenStamps } from '../domain/shifts.ts';
import { todayLocal } from '../domain/time.ts';
import { href, navigate } from '../router.ts';
import { loadPhoto, readPhoto, tableCrop } from '../ocr/browser.ts';
import type { ClockReading } from '../ocr/pipeline.ts';
import { Icon, Modal, Notice, Spinner } from './common.tsx';
import { Scanner, type Scan } from './Scanner.tsx';
import { flushFocusedField, StampRowsEditor } from './StampRowsEditor.tsx';
import { mergeStamps, sameStamps, stampDiff, type StampDiff } from '../domain/sameData.ts';
import { StampMerge } from './SameData.tsx';

interface Pending {
  previewUrl: string;
  cropUrl?: string;
  jpeg?: Blob;
  reading?: ClockReading;
  error?: string;
}

interface QueuedPhoto {
  file: File;
  /** Already read by the scanner. */
  reading?: ClockReading;
}

/** Scan the clock with the camera, or pick saved photos, and walk through them. */
export function PhotoImportButton() {
  const { t } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<QueuedPhoto[]>([]);
  const [total, setTotal] = useState(0);
  const [scanning, setScanning] = useState(false);

  const onFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setQueue([...files].map((file) => ({ file })));
    setTotal(files.length);
    if (input.current) input.current.value = '';
  };
  const onScanned = useCallback((scans: Scan[]) => {
    setScanning(false);
    // Earliest day first, so a shift over midnight is checked in order.
    setQueue([...scans].sort((a, b) => (a.reading.date ?? '').localeCompare(b.reading.date ?? '')));
    setTotal(scans.length);
  }, []);

  return (
    <>
      {/* The daily scan first; printed timecards, needed now and then, beside it. */}
      <div className="scan-row">
        <button type="button" className="button button-primary button-large" onClick={() => setScanning(true)}>
          <Icon name="camera" /> {t('scan.open')}
        </button>
        <a className="button timecard-button" href={href({ name: 'timecard' })}>
          <Icon name="slips" />
          <span>{t('timecard.button')}</span>
        </a>
      </div>
      <button type="button" className="button" onClick={() => input.current?.click()}>
        {t('scan.pickPhotos')}
      </button>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />
      {scanning && (
        <Scanner
          onScanned={onScanned}
          onClose={() => setScanning(false)}
          onPickFiles={() => {
            setScanning(false);
            input.current?.click();
          }}
          onManual={() => {
            setScanning(false);
            navigate({ name: 'day', date: todayLocal() });
          }}
        />
      )}
      {queue.length > 0 && (
        <PhotoReview
          key={`${total}-${queue.length}`}
          file={queue[0].file}
          preread={queue[0].reading}
          position={total - queue.length + 1}
          total={total}
          onDone={() => setQueue((q) => q.slice(1))}
          onCancelAll={() => setQueue([])}
        />
      )}
    </>
  );
}

function PhotoReview({
  file,
  preread,
  position,
  total,
  onDone,
  onCancelAll,
}: {
  file: File;
  preread?: ClockReading;
  position: number;
  total: number;
  onDone: () => void;
  onCancelAll: () => void;
}) {
  const { t, days } = useApp();
  const [state, setState] = useState<Pending>(() => ({ previewUrl: URL.createObjectURL(file) }));
  const [date, setDate] = useState('');
  const [rows, setRows] = useState<StampPair[]>([]);
  /** For a day already saved: new stamps not to add, and saved ones the photo lacks to remove. */
  const [skipAdd, setSkipAdd] = useState<Set<string>>(new Set());
  const [doRemove, setDoRemove] = useState<Set<string>>(new Set());
  const addSet = (d: StampDiff) => new Set(d.added.map((s) => s.key).filter((k) => !skipAdd.has(k)));
  const [slowHint, setSlowHint] = useState(false);
  const latestRows = useRef(rows);
  latestRows.current = rows;

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => setSlowHint(true), 1500);
    (async () => {
      try {
        const photo = await loadPhoto(file);
        const reading = preread ?? (await readPhoto(photo.image));
        const crop = reading.table ? URL.createObjectURL(await tableCrop(photo, reading.table)) : undefined;
        if (!alive) {
          if (crop) URL.revokeObjectURL(crop);
          return;
        }
        setState((s) => ({ ...s, jpeg: photo.jpeg, reading, cropUrl: crop }));
        setDate(reading.date ?? todayLocal());
        setRows(reading.rows.map((r) => ({ in: r.in, out: r.out })));
      } catch (e) {
        if (!alive) return;
        setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) }));
        setDate(todayLocal());
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [file, preread]);

  useEffect(
    () => () => {
      URL.revokeObjectURL(state.previewUrl);
      if (state.cropUrl) URL.revokeObjectURL(state.cropUrl);
    },
    [state.previewUrl, state.cropUrl],
  );

  const save = async () => {
    await flushFocusedField();
    // Times the scanner was unsure of and that were saved unchanged are remembered as such.
    const rowsToSave = latestRows.current
      .map((r, i) => ({
        ...r,
        inDoubt: (uncertain[i]?.in && r.in && !r.inManual) || undefined,
        outDoubt: (uncertain[i]?.out && r.out && !r.outManual) || undefined,
      }))
      .filter((r) => r.in || r.out);
    const existing = days.find((d) => d.date === date);
    // A day already saved: the same stamps change nothing (a copy); otherwise what the user chose is added and removed.
    const before = existing && existing.rows.length > 0 ? existing.rows : null;
    const diff = before ? stampDiff(before, rowsToSave) : null;
    if (diff && sameStamps(diff)) {
      onDone();
      return;
    }
    const photoId = newId();
    await db.photos.put({ id: photoId, date, blob: state.jpeg ?? file, createdAt: Date.now() });
    const day: DayRecord = {
      date,
      // Rows keep the "typed by hand" marks the editor sets on changed times.
      rows: before && diff ? mergeStamps(before, diff, addSet(diff), doRemove) : rowsToSave,
      absence: existing?.absence,
      note: existing?.note,
      photoIds: [...(existing?.photoIds ?? []), photoId],
      ocrConfidence: state.reading?.confidence,
      updatedAt: Date.now(),
    };
    await saveDay(day);
    // The scanner learns the clock's digits from the times as saved (corrections included).
    const material = state.reading?.learn;
    if (material) await learnDigits(material, latestRows.current).catch(() => undefined);
    onDone();
  };

  const savedDay = days.find((d) => d.date === date);
  const savedRows = savedDay && savedDay.rows.length > 0 ? savedDay.rows : null;
  const liveDiff = savedRows ? stampDiff(savedRows, rows.filter((r) => r.in || r.out)) : null;
  const copy = !!liveDiff && sameStamps(liveDiff);
  const title = total > 1 ? `${t('photo.title')} (${position}/${total})` : t('photo.title');
  const reading = state.reading;
  // Stamps that look forgotten (not a shift over midnight) are pointed out too.
  const forgotten = date ? forgottenStamps(date, rows, days) : [];
  const uncertain = rows.map((_, i) => ({
    in: reading?.rows[i]?.inUncertain || forgotten.some((f) => f.row === i && f.field === 'in'),
    out: reading?.rows[i]?.outUncertain || forgotten.some((f) => f.row === i && f.field === 'out'),
  }));
  const anyUncertain = uncertain.some((u) => u.in || u.out);
  return (
    <Modal
      title={title}
      onClose={onCancelAll}
      footer={
        <>
          <button type="button" className="button" onClick={total > 1 ? onDone : onCancelAll}>
            {total > 1 ? t('photo.skip') : t('common.cancel')}
          </button>
          <button type="button" className="button button-primary" disabled={(!reading && !state.error) || !date} onClick={save}>
            {copy ? t('same.done') : t('common.save')}
          </button>
        </>
      }
    >
      {state.cropUrl ? (
        <img className="review-crop" src={state.cropUrl} alt="" />
      ) : (
        <img className="review-photo" src={state.previewUrl} alt="" />
      )}
      {!reading && !state.error && (
        <>
          <Spinner label={t('photo.reading')} />
          {slowHint && <p className="muted small">{t('photo.loadingOcr')}</p>}
        </>
      )}
      {state.error && <Notice kind="error">{t('photo.failed', { error: state.error })}</Notice>}
      {(reading || state.error) && (
        <>
          {reading?.issues
            .filter((i) => i !== 'no-rows')
            .map((i) => (
              <Notice key={i} kind="warn">
                {t(`photo.${i}`)}
              </Notice>
            ))}
          {forgotten.map((f) => (
            <Notice key={`${f.row}${f.field}`} kind="warn">
              {t(f.field === 'in' ? 'scan.forgotIn' : 'scan.forgotOut', { other: f.other ?? '' })} {t('photo.forgotHint')}
            </Notice>
          ))}
          {anyUncertain && !forgotten.length && <Notice kind="warn">{t('photo.uncertain')}</Notice>}
          {date > todayLocal() && <Notice kind="warn">{t('photo.futureDate')}</Notice>}
          <p className="muted small">{t('photo.checkHint')}</p>
          <label className="field">
            <span className="field-label">{t('photo.date')}</span>
            <input type="date" value={date} className={reading?.dateUncertain ? 'uncertain' : ''} onChange={(e) => setDate(e.target.value)} required />
          </label>
          {rows.length === 0 && reading?.issues.includes('no-rows') && <p className="muted">{t('photo.no-rows')}</p>}
          <StampRowsEditor rows={rows} onChange={setRows} uncertain={uncertain} />
          {savedRows && liveDiff && (
            <StampMerge
              saved={savedRows}
              diff={liveDiff}
              add={addSet(liveDiff)}
              remove={doRemove}
              onChange={(add, remove) => {
                setSkipAdd(new Set(liveDiff.added.map((s) => s.key).filter((k) => !add.has(k))));
                setDoRemove(remove);
              }}
            />
          )}
          {state.cropUrl && (
            <details className="review-full">
              <summary>{t('photo.showWhole')}</summary>
              <img className="review-photo" src={state.previewUrl} alt="" />
            </details>
          )}
        </>
      )}
    </Modal>
  );
}
