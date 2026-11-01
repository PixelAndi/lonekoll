import { useCallback, useMemo, useRef, useState } from 'react';
import { useApp } from '../app-context.ts';
import { saveDay } from '../db.ts';
import type { AbsenceType, DayRecord, StampPair } from '../domain/model.ts';
import { loadPhoto, type TimecardDayReading, type TimecardReading } from '../ocr/browser.ts';
import { combineReadings } from '../ocr/timecard.ts';
import { goBack, href } from '../router.ts';
import { Card, Icon, Notice, Page, Spinner } from './common.tsx';
import { StampRowsEditor } from './StampRowsEditor.tsx';
import { stampText } from './stamps.ts';
import { TimecardScanner, type ScannedPage } from './TimecardScanner.tsx';

// Printed timecards (tidkort) from the employer: photos or PDFs, one or more
// months. Each day is read and checked against the card's own Arb Tid; days
// that don't add up, differ from what the app has, or have a note in the
// Frånvaro box are put to the user before anything is saved.

interface FileState {
  name: string;
  status: 'reading' | 'done' | 'none' | 'failed';
  days?: number;
  month?: string;
  /** The pages as read, to save (pictures from the scanner). */
  images?: string[];
}

/** What the user decided for a day. */
interface Decision {
  pairs: StampPair[];
  /** For a day the app already has with other stamps: take the timecard's. */
  useCard: boolean;
  absence?: AbsenceType | 'none';
}

const NOTE_CHOICES: (AbsenceType | 'none')[] = ['sick', 'vacation', 'unpaid', 'none'];

/** A guess from a printed or read note: "Sjuk", "Semester", "VAB". */
function guessAbsence(note?: string): AbsenceType | undefined {
  if (!note) return undefined;
  if (/sjuk/i.test(note)) return 'sick';
  if (/semest/i.test(note)) return 'vacation';
  if (/vab|ledig|tjl/i.test(note)) return 'unpaid';
  return undefined;
}

export function TimecardImport() {
  const { t } = useApp();
  const photoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<FileState[]>([]);
  // Every reading of each day (pages, close-ups, the same card scanned again), put to the vote below.
  const [readings, setReadings] = useState<Map<string, Map<string, TimecardDayReading[]>>>(new Map());
  const months = useMemo(
    () => new Map([...readings].map(([month, byDate]) => [month, [...byDate.values()].map((r) => combineReadings(r)).sort((a, b) => a.date.localeCompare(b.date))])),
    [readings],
  );
  const [scanning, setScanning] = useState(false);
  // Test mode (for troubleshooting the scanner): it saves what it saw to the phone.
  const [test, setTest] = useState(() => {
    try {
      return localStorage.getItem('tcscan-test') === '1';
    } catch {
      return false;
    }
  });
  const toggleTest = (on: boolean) => {
    setTest(on);
    try {
      localStorage.setItem('tcscan-test', on ? '1' : '0');
    } catch {
      // Remembered only for now.
    }
  };

  /** Pages read (from a file or the scanner) added to their months; returns the month and days read. */
  const addReadings = useCallback((readings: TimecardReading[]) => {
    const days = readings.flatMap((r) => r.days);
    const month = (readings.find((r) => r.from)?.from ?? days[0]?.date)?.slice(0, 7);
    if (!month || !days.length) return null;
    setReadings((m) => {
      const next = new Map(m);
      // Pages of the same month add up; a day read again is checked against its earlier readings.
      const byDate = new Map(next.get(month) ?? []);
      for (const d of days) byDate.set(d.date, [...(byDate.get(d.date) ?? []), d]);
      next.set(month, byDate);
      return next;
    });
    return { month, days: days.filter((d) => d.status !== 'empty').length };
  }, []);
  const onScanned = useCallback(
    (page: ScannedPage) => {
      const read = addReadings([page.reading]);
      const dates = page.reading.days.map((d) => d.date).sort();
      const day = (d: string | undefined) => (d ? String(Number(d.slice(8))) : '');
      setFiles((f) => [
        ...f,
        {
          name:
            page.step === 'page'
              ? t('timecard.scannedPage', { n: f.filter((x) => x.images).length + 1 })
              : t('timecard.closeUp', { from: day(dates[0]), to: day(dates[dates.length - 1]) }),
          status: read ? 'done' : 'none',
          ...read,
          images: page.reading.pageImage ? [page.reading.pageImage] : [],
        },
      ]);
    },
    [addReadings, t],
  );

  const add = async (list: FileList | null) => {
    if (!list?.length) return;
    const picked = [...list];
    for (const input of [photoInput.current, fileInput.current]) if (input) input.value = '';
    setFiles((f) => [...f, ...picked.map((file) => ({ name: file.name, status: 'reading' as const }))]);
    const { readTimecardImage } = await import('../ocr/browser.ts');
    for (const file of picked) {
      const update = (patch: Partial<FileState>) => setFiles((f) => f.map((x) => (x.name === file.name && x.status === 'reading' ? { ...x, ...patch } : x)));
      try {
        // A PDF: each page drawn and read; a photo: read as it is.
        const canvases = /pdf/i.test(file.type) || /\.pdf$/i.test(file.name) ? await (await import('../pdf/browser.ts')).renderPdfPages(file) : [(await loadPhoto(file)).canvas];
        const readings: TimecardReading[] = [];
        for (const canvas of canvases) readings.push(await readTimecardImage(canvas));
        const read = addReadings(readings);
        update(read ? { status: 'done', ...read } : { status: 'none' });
      } catch {
        update({ status: 'failed' });
      }
    }
  };

  return (
    <Page title={t('timecard.title')}>
      <a className="help-back" href={href({ name: 'days' })} onClick={(e) => (e.preventDefault(), goBack({ name: 'days' }))}>
        <Icon name="chevronLeft" /> {t('nav.days')}
      </a>
      <Card>
        <p>{t('timecard.intro')}</p>
        <div className="button-row">
          <button type="button" className="button button-primary" onClick={() => setScanning(true)}>
            <Icon name="camera" /> {t('timecard.scan')}
          </button>
          <button type="button" className="button" onClick={() => photoInput.current?.click()}>
            {t('timecard.photo')}
          </button>
          <button type="button" className="button" onClick={() => fileInput.current?.click()}>
            {t('timecard.files')}
          </button>
        </div>
        <input ref={photoInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void add(e.target.files)} />
        <input ref={fileInput} type="file" accept="image/*,application/pdf,.pdf" multiple hidden onChange={(e) => void add(e.target.files)} />
        <p className="muted small">{t('timecard.privacy')}</p>
        <label className="checkbox small">
          <input type="checkbox" checked={test} onChange={(e) => toggleTest(e.target.checked)} />
          <span>
            {t('timecard.testMode')} <span className="muted">{t('timecard.testModeHelp')}</span>
          </span>
        </label>
        {files.length > 0 && (
          <ul className="timecard-files">
            {files.map((f, i) => (
              <li key={i}>
                <span>{f.name}</span>
                {f.status === 'reading' && <Spinner label={t('timecard.reading')} />}
                {f.status === 'done' && <span className="ok">✓ {t('timecard.read', { n: f.days ?? 0 })}</span>}
                {f.status === 'none' && <span className="warn-text">{t('timecard.noTable')}</span>}
                {f.status === 'failed' && <span className="warn-text">{t('timecard.failed')}</span>}
                {f.images?.map((src, j) => (
                  <a key={j} className="small" href={src} download={`tidkort-${f.month ?? 'sida'}-${j + 1}.jpg`}>
                    {t('timecard.saveImage')}
                  </a>
                ))}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {scanning && <TimecardScanner test={test} onPage={onScanned} onClose={() => setScanning(false)} />}
      {[...months.entries()].map(([month, days]) => (
        <MonthReview key={month} month={month} days={days} />
      ))}
    </Page>
  );
}

function MonthReview({ month, days }: { month: string; days: TimecardDayReading[] }) {
  const { t, fmt, days: logged } = useApp();
  const existing = new Map(logged.map((d) => [d.date, d]));
  const shown = days.filter((d) => d.status !== 'empty' || d.noteImage || d.note);
  const [chosen, setDecisions] = useState<Map<string, Decision>>(new Map());
  // A day not yet decided on (also one from a page scanned after the review opened) starts from what was read.
  const initial = (d: TimecardDayReading): Decision => ({
    pairs: d.pairs.map((p) => ({ in: p.in, out: p.out })),
    useCard: true,
    absence: d.noteImage || d.note ? guessAbsence(d.note) : undefined,
  });
  const decisions = { get: (date: string) => chosen.get(date) ?? initial(shown.find((d) => d.date === date)!) };
  const [saved, setSaved] = useState<number | null>(null);
  const decide = (date: string, patch: Partial<Decision>) => setDecisions((m) => new Map(m).set(date, { ...decisions.get(date), ...patch }));

  const ok = shown.filter((d) => d.status === 'ok' || d.status === 'fixed').length;
  const toCheck = shown.filter((d) => d.status === 'check').length;
  const notes = shown.filter((d) => d.noteImage || d.note).length;

  const save = async () => {
    let n = 0;
    for (const d of shown) {
      const choice = decisions.get(d.date);
      const before = existing.get(d.date);
      const rows = choice.pairs.filter((p) => p.in || p.out);
      const differs = before && before.rows.length > 0 && stampText(before.rows) !== stampText(rows);
      const keepRows = differs && !choice.useCard;
      const absence = choice.absence && choice.absence !== 'none' ? { type: choice.absence } : before?.absence;
      if (!rows.length && !absence) continue;
      const day: DayRecord = {
        ...(before ?? { date: d.date, rows: [], photoIds: [] }),
        rows: keepRows ? before!.rows : rows.length ? rows : (before?.rows ?? []),
        absence,
        updatedAt: Date.now(),
      };
      await saveDay(day);
      n++;
    }
    setSaved(n);
  };

  const monthName = fmt.month(`${month}-01`);
  return (
    <Card title={t('timecard.monthTitle', { month: monthName })}>
      <p className="small">
        <span className="ok">{t('timecard.summaryOk', { n: ok })}</span>
        {toCheck > 0 && <span className="warn-text"> {t('timecard.summaryCheck', { n: toCheck })}</span>}
        {notes > 0 && <span className="warn-text"> {t('timecard.summaryNotes', { n: notes })}</span>}
      </p>
      <ul className="timecard-days">
        {shown.map((d) => {
          const choice = decisions.get(d.date);
          const before = existing.get(d.date);
          const rows = choice.pairs.filter((p) => p.in || p.out);
          const differs = !!before && before.rows.length > 0 && rows.length > 0 && stampText(before.rows) !== stampText(rows);
          const same = !!before && before.rows.length > 0 && stampText(before.rows) === stampText(rows);
          return (
            <li key={d.date} className={`timecard-day timecard-${d.status}`}>
              <div className="timecard-day-head">
                <strong>{fmt.date(d.date)}</strong>
                <span>{rows.length ? stampText(rows) : t('timecard.noStamps')}</span>
                <span className="timecard-status">
                  {d.status === 'ok' && <span className="ok">✓</span>}
                  {d.status === 'fixed' && <span className="ok">✓</span>}
                  {d.status === 'check' && <span className="warn-text">!</span>}
                </span>
              </div>
              {d.rowImage && <img className="timecard-row" src={d.rowImage} alt="" />}
              {d.worked !== undefined && <div className="muted small">{t('timecard.worked', { hours: fmt.number(d.worked) })}</div>}
              {(d.reads ?? 0) > 1 && <div className="muted small">{t('timecard.reads', { reads: d.reads ?? 0, agree: d.agree ?? 0 })}</div>}
              {d.status === 'fixed' && d.corrected.length > 0 && <div className="muted small">{t('timecard.fixed')}</div>}
              {d.status === 'check' && (
                <>
                  <p className="small warn-text">{t(d.worked !== undefined ? 'timecard.checkWorked' : 'timecard.checkUnknown', { hours: fmt.number(d.worked ?? 0) })}</p>
                  <StampRowsEditor rows={choice.pairs} onChange={(next) => decide(d.date, { pairs: typeof next === 'function' ? next(choice.pairs) : next })} />
                </>
              )}
              {same && <div className="muted small">{t('timecard.same')}</div>}
              {differs && (
                <div className="small">
                  {t('timecard.conflict', { app: stampText(before!.rows), card: stampText(rows) })}
                  <div className="chips">
                    <button type="button" className={`chip ${choice.useCard ? 'on' : ''}`} onClick={() => decide(d.date, { useCard: true })}>
                      {t('timecard.useCard')}
                    </button>
                    <button type="button" className={`chip ${!choice.useCard ? 'on' : ''}`} onClick={() => decide(d.date, { useCard: false })}>
                      {t('timecard.keepApp')}
                    </button>
                  </div>
                </div>
              )}
              {(d.noteImage || d.note) && (
                <div className="small">
                  {t('timecard.note')}
                  {d.noteImage && <img className="timecard-note" src={d.noteImage} alt={d.note ?? ''} />}
                  <div className="chips">
                    {NOTE_CHOICES.map((c) => (
                      <button key={c} type="button" className={`chip ${choice.absence === c ? 'on' : ''}`} onClick={() => decide(d.date, { absence: c })}>
                        {c === 'none' ? t('timecard.noNote') : t(`absence.${c}`)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {saved === null ? (
        <button type="button" className="button button-primary" onClick={() => void save()}>
          {t('timecard.save', { month: monthName })}
        </button>
      ) : (
        <Notice kind="ok">{t('timecard.saved', { n: saved })}</Notice>
      )}
    </Card>
  );
}
