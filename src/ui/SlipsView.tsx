import { useLiveQuery } from 'dexie-react-hooks';
import { withPayDay } from '../domain/payday.ts';
import { useCallback, useRef, useState } from 'react';
import { useApp } from '../app-context.ts';
import { db, newId, type SlipRecord } from '../db.ts';
import { calculatePeriod } from '../domain/calc.ts';
import { comparePeriod } from '../domain/compare.ts';
import { hourlyRateOn } from '../domain/model.ts';
import { taxBasis, taxColumn } from '../domain/tax.ts';
import { todayLocal } from '../domain/time.ts';
import { readPaySlipPdf } from '../pdf/browser.ts';
import { useTaxData } from '../taxData.ts';
import { href, navigate } from '../router.ts';
import { Card, Fold, Icon, Notice, Page, Spinner } from './common.tsx';
import { applyOverrides, countFindings, slipPeriod, vacationBasisFor } from './slipComparison.ts';
import { VacationProgress } from './VacationProgress.tsx';
import { WageFromSlips } from './WageFromSlips.tsx';
import { IssuesLine } from './IssuesView.tsx';
import { needsCheck, readCompletely } from './SlipCheck.tsx';
import { completeness, SlipScanner, type SlipOutcome } from './SlipScanner.tsx';
import type { PaySlip } from '../domain/payslip.ts';
import { sameSlipData, slipDiff } from '../domain/sameData.ts';

/** A slip's key for knowing it again: the same period, pay day and amounts. */
const keyOf = (slip: SlipRecord['slip']) => `${slip.periodStart ?? ''}|${slip.payDate ?? ''}|${slip.lines.reduce((sum, l) => sum + (l.amount ?? 0), 0).toFixed(2)}`;

/**
 * A slip read (from a PDF, a photo or the scanner) saved, unless nothing could be read. A slip read
 * before (the same period and pay day) is compared with what is saved: the same data is a copy and
 * nothing changes; otherwise the new reading is kept beside it as a question – what to add of what
 * it has new, what to remove of what it lacks – and nothing changes until the user answers.
 * A pay day it lacks is the one in the settings.
 */
export async function storeSlip(read: PaySlip, file: Blob, fileName: string, payDay: number | null): Promise<SlipOutcome & { id?: string }> {
  if (read.lines.length === 0) return { status: 'none' };
  const slip = withPayDay(read, payDay);
  const all = await db.slips.toArray();
  const exact = all.find((r) => keyOf(r.slip) === keyOf(slip) && sameSlipData(slipDiff(r.slip, slip)));
  if (exact) return { status: 'duplicate', period: slip.periodStart, id: exact.id };
  const same = slip.periodStart && slip.payDate && slip.payDateFrom !== 'setting' ? all.filter((r) => sameSlip(r.slip, slip)) : [];
  if (same.length) {
    const saved = same[0];
    if (sameSlipData(slipDiff(saved.slip, slip))) return { status: 'duplicate', period: slip.periodStart, id: saved.id };
    await db.slips.update(saved.id, { candidate: { slip, fileName, readAt: Date.now() } });
    return { status: 'differs', period: slip.periodStart, id: saved.id };
  }
  const id = newId();
  await db.slips.put({ id, fileName, importedAt: Date.now(), periodStart: slip.periodStart ?? '', slip, pdf: file });
  return { status: 'saved', period: slip.periodStart, id, check: !readCompletely(slip) };
}

/** Two readings of the same slip: the same period and the same pay day (an extra payout has its own). */
const sameSlip = (a: PaySlip, b: PaySlip) => !!a.periodStart && a.periodStart === b.periodStart && !!a.payDate && a.payDate === b.payDate;

/** A photo of a slip read: with PaddleOCR, or with Tesseract where that can't run. */
async function readSlipPhoto(file: Blob, rate?: number): Promise<PaySlip> {
  const ocr = await import('../ocr/browser.ts');
  try {
    return await ocr.readPaySlipFast(file, rate);
  } catch {
    return ocr.readPaySlipImage(file, rate);
  }
}

export function SlipsView() {
  const { t, settings } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const photo = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  /** What the scanner read this time (shown when it closes). */
  const scanned = useRef<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const slips = useLiveQuery(() => db.slips.orderBy('periodStart').reverse().toArray(), []);

  /** Each file picked, and how its import went (several can be picked at once). */
  const [results, setResults] = useState<Result[]>([]);

  const onFiles = async (list: FileList | null) => {
    const files = [...(list ?? [])];
    if (input.current) input.current.value = '';
    if (photo.current) photo.current.value = '';
    if (!files.length) return;
    setBusy(true);
    setError(undefined);
    setResults(files.map((f) => ({ name: f.name, status: 'reading' })));
    const update = (k: number, patch: Partial<(typeof results)[number]>) => setResults((r) => r.map((x, i) => (i === k ? { ...x, ...patch } : x)));
    let lastId: string | undefined;
    let imported = 0;
    for (const [k, file] of files.entries()) {
      try {
        // A PDF, or a photo of the slip (read with the same text recognition as the scanners).
        const rate = hourlyRateOn(settings, todayLocal()) ?? undefined;
        const read = /^image\//.test(file.type) ? await readSlipPhoto(file, rate) : await readPaySlipPdf(file, rate);
        // A slip imported before (or twice in this batch) is skipped: the same period, pay day and amounts.
        const outcome = await storeSlip(read, file, file.name, settings.payDay);
        if (outcome.status === 'none') {
          update(k, { status: 'none' });
          continue;
        }
        if (outcome.status === 'duplicate' || outcome.status === 'differs') {
          update(k, { status: outcome.status, period: outcome.period, id: outcome.id });
          // One file read again with something new or missing: straight to the question on its slip.
          if (outcome.status === 'differs') lastId = outcome.id;
          continue;
        }
        update(k, { status: outcome.status === 'replaced' ? 'replaced' : 'done', period: outcome.period, id: outcome.id, check: outcome.check });
        lastId = outcome.id;
        imported++;
      } catch (e) {
        update(k, { status: 'failed' });
        if (files.length === 1) setError(t('slips.failed', { error: e instanceof Error ? e.message : String(e) }));
      }
    }
    setBusy(false);
    // One slip: straight to its comparison, as before. Several: the list, with how each went.
    if (files.length === 1 && lastId) navigate({ name: 'slip', id: lastId });
  };

  /** A slip read by the scanner: saved at once (the scanner says how it went). */
  const onScanned = useCallback(
    async (slip: PaySlip, picture: Blob): Promise<SlipOutcome> => {
      const outcome = await storeSlip(slip, picture, `${t('slipscan.title')} ${new Date().toISOString().slice(0, 10)}.jpg`, settings.payDay);
      const status = outcome.status === 'saved' ? 'done' : outcome.status;
      scanned.current.push({ name: '', status, period: outcome.period, id: outcome.id, check: outcome.check });
      return outcome;
    },
    [settings.payDay, t],
  );
  const closeScanner = () => {
    setScanning(false);
    const read = scanned.current;
    scanned.current = [];
    // One slip scanned: straight to it; several: what was read, at the top of the page.
    const saved = read.filter((r) => r.id && r.status !== 'duplicate');
    if (read.length === 1 && saved.length === 1 && read[0] === saved[0]) navigate({ name: 'slip', id: saved[0].id! });
    else setResults(read);
  };

  return (
    <Page title={t('nav.slips')}>
      {scanning && (
        <SlipScanner
          onSlip={onScanned}
          onClose={closeScanner}
          onCameraFailed={() => {
            setScanning(false);
            photo.current?.click();
          }}
        />
      )}
      <div className="actions-stack">
        {/* The PDF from the employer first; a photo of a paper slip beside it. */}
        <div className="scan-row">
          <button type="button" className="button button-primary button-large" disabled={busy} onClick={() => input.current?.click()}>
            <Icon name="slips" /> {t('slips.import')}
          </button>
          <button type="button" className="button timecard-button" disabled={busy} onClick={() => setScanning(true)}>
            <Icon name="camera" />
            <span>{t('slips.photo')}</span>
          </button>
        </div>
        <input ref={photo} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onFiles(e.target.files)} />
        <input ref={input} type="file" accept="application/pdf,.pdf,image/*" multiple hidden onChange={(e) => void onFiles(e.target.files)} />
        <p className="muted small">{t('slips.importMany')}</p>
        <p className="slip-privacy small">
          <Icon name="lock" /> <span>{t('slips.privacy')}</span>
        </p>
        {busy && <Spinner label={results.length > 1 ? t('slips.importingMany', { done: results.filter((r) => r.status !== 'reading').length, n: results.length }) : t('slips.importing')} />}
        {error && <Notice kind="error">{error}</Notice>}
        <Results results={results} onClose={() => setResults([])} />
      </div>
      {slips && slips.length === 0 && <p className="muted">{t('slips.empty')}</p>}
      {slips && slips.length > 0 && (
        <>
          <IssuesLine />
          <ToCheck slips={slips} />
          <YearList slips={slips} />
          <WageFromSlips />
          <Fold title={t('vacation.title')}>
            <VacationProgress slips={slips} plain />
          </Fold>
        </>
      )}
    </Page>
  );
}

/** A file read, or a slip the scanner read: how it went. */
interface Result {
  name: string;
  status: 'reading' | 'done' | 'replaced' | 'duplicate' | 'differs' | 'none' | 'failed';
  period?: string;
  id?: string;
  check?: boolean;
}

/** What was just read (several files, or a round of scanning), each with the way to it. */
function Results({ results, onClose }: { results: Result[]; onClose: () => void }) {
  const { t, fmt } = useApp();
  if (!results.length) return null;
  const month = (r: Result) => (r.period ? fmt.month(r.period) : r.name || t('slips.noPeriod'));
  return (
    <Card title={t('slips.justRead')} className="slip-results">
      <ul className="slip-rows">
        {results.map((r, i) => (
          <li key={i}>
            {r.id ? (
              <a className="slip-row" href={href({ name: 'slip', id: r.id })}>
                <span className="slip-row-month">{month(r)}</span>
                <span className={`chip-status ${r.check || r.status === 'differs' ? 'warn' : r.status === 'duplicate' ? 'muted' : 'ok'}`}>
                  {r.status === 'differs'
                    ? t('slips.result.differs')
                    : r.status === 'duplicate'
                      ? t('slips.result.duplicateShort')
                      : r.check
                        ? t('slips.result.check')
                        : r.status === 'replaced'
                          ? t('slips.result.replaced')
                          : t('slips.result.done')}
                </span>
              </a>
            ) : (
              <span className="slip-row">
                <span className="slip-row-month">{month(r)}</span>
                <span className={`chip-status ${r.status === 'reading' ? 'muted' : r.status === 'duplicate' ? 'muted' : 'warn'}`}>
                  {r.status === 'reading'
                    ? '…'
                    : r.status === 'duplicate'
                      ? t('slips.result.duplicateShort')
                      : r.status === 'none'
                        ? t('slips.result.noLines')
                        : t('slips.result.failed')}
                </span>
              </span>
            )}
          </li>
        ))}
      </ul>
      <button type="button" className="link-button small" onClick={onClose}>
        {t('common.close')}
      </button>
    </Card>
  );
}

/**
 * The slips to look at: a reading that wasn't complete or whose period is
 * uncertain, and a slip saved more than once (keep the best reading).
 */
function ToCheck({ slips }: { slips: SlipRecord[] }) {
  const { t, fmt } = useApp();
  const unsure = slips.filter(needsCheck);
  const groups = new Map<string, SlipRecord[]>();
  for (const r of slips) {
    if (!r.slip.periodStart || !r.slip.payDate) continue;
    const key = `${r.slip.periodStart}|${r.slip.payDate}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const doubles = [...groups.values()].filter((g) => g.length > 1);
  if (!unsure.length && !doubles.length) return null;
  /** The best of a slip's readings: checked by the user, else the most complete, else the newest. */
  const best = (g: SlipRecord[]) => [...g].sort((a, b) => Number(!!b.slip.checked) - Number(!!a.slip.checked) || completeness(b.slip) - completeness(a.slip) || b.importedAt - a.importedAt)[0];
  return (
    <Card title={t('slips.toCheck.title', { n: unsure.length + doubles.length })} className="slip-tocheck">
      <ul className="slip-rows">
        {doubles.map((g) => (
          <li key={g[0].id} className="slip-row slip-row-double">
            <span className="slip-row-month">{t('slips.toCheck.double', { month: fmt.month(g[0].slip.periodStart!), n: g.length })}</span>
            <button
              type="button"
              className="button button-small"
              onClick={() => {
                const keep = best(g);
                void db.slips.bulkDelete(g.filter((r) => r !== keep).map((r) => r.id));
              }}
            >
              {t('slips.toCheck.keepBest')}
            </button>
          </li>
        ))}
        {unsure.map((r) => (
          <li key={r.id}>
            <a className="slip-row" href={href({ name: 'slip', id: r.id })}>
              <span className="slip-row-month">{r.slip.periodStart ? fmt.month(r.slip.periodStart) : t('slips.noPeriod')}</span>
              <span className="chip-status warn">{r.slip.periodDoubt ? t('slips.toCheck.period') : t('slips.toCheck.incomplete')}</span>
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Every slip, a section per year (the latest open), a line each. */
function YearList({ slips }: { slips: SlipRecord[] }) {
  const { t } = useApp();
  const years = new Map<string, SlipRecord[]>();
  for (const r of slips) {
    const year = r.periodStart ? r.periodStart.slice(0, 4) : '';
    years.set(year, [...(years.get(year) ?? []), r]);
  }
  const order = [...years.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : b.localeCompare(a)));
  return (
    <>
      {order.map((year, i) => {
        const list = years.get(year)!;
        const unsure = list.filter(needsCheck).length;
        return (
          <Fold
            key={year || 'none'}
            open={i === 0}
            title={year || t('slips.noPeriod')}
            sub={`${t('slips.count', { n: list.length })}${unsure ? ` · ${t('slips.toCheckCount', { n: unsure })}` : ''}`}
            warn={unsure > 0}
          >
            <ul className="slip-rows">
              {list.map((s) => (
                <SlipItem key={s.id} record={s} all={slips} />
              ))}
            </ul>
          </Fold>
        );
      })}
    </>
  );
}

/** A slip on one line: its month and pay day, what was paid out, and how it stands. */
function SlipItem({ record, all }: { record: SlipRecord; all: SlipRecord[] }) {
  const { t, fmt, days, settings } = useApp();
  const slip = applyOverrides(record.slip, settings.codeOverrides);
  const { start, end } = slipPeriod(slip, record.importedAt);
  const taxYear = Number((slip.payDate ?? end).slice(0, 4));
  const taxData = useTaxData(taxYear);
  const tax = { basis: taxBasis(settings.tax, taxData.rates), tables: taxData.tables, column: taxColumn(settings.birthDate, taxYear) };
  const vacation = vacationBasisFor(slip, all, settings);
  // Without days logged in its period the comparison has nothing to go on: said as such, not as differences.
  const logged = days.some((d) => d.date >= start && d.date <= end && (d.rows.length > 0 || !!d.absence));
  const findings = logged ? countFindings(comparePeriod(calculatePeriod(days, settings, start, end), slip, days, settings, tax, vacation)) : 0;
  const photo = /^image\//.test(record.pdf.type);
  const [label, kind] = needsCheck(record)
    ? [t('slipCheck.badge'), 'warn']
    : !logged
      ? [t('slips.noDays'), 'muted']
      : findings
        ? [t('slips.differences', { n: findings }), 'diff']
        : [t('slips.matches'), 'ok'];
  return (
    <li>
      <a className="slip-row" href={href({ name: 'slip', id: record.id })}>
        <span className="slip-row-month">
          {fmt.month(start)}
          {photo && <Icon name="camera" />}
        </span>
        <span className="slip-row-net">{slip.net !== undefined ? fmt.money(slip.net) : '–'}</span>
        <span className="slip-row-paid muted small">{slip.payDate ? t('compare.paid', { date: fmt.date(slip.payDate) }) : ''}</span>
        <span className={`chip-status ${kind}`}>{label}</span>
      </a>
    </li>
  );
}

export function SlipNotFound() {
  const { t } = useApp();
  return (
    <Page title={t('nav.slips')}>
      <Card>
        <a href={href({ name: 'slips' })}>{t('common.back')}</a>
      </Card>
    </Page>
  );
}
