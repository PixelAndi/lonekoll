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
import { Card, Icon, Notice, Page, Spinner } from './common.tsx';
import { applyOverrides, countFindings, slipPeriod, vacationBasisFor } from './slipComparison.ts';
import { VacationProgress } from './VacationProgress.tsx';
import { WageFromSlips } from './WageFromSlips.tsx';
import { needsCheck } from './SlipCheck.tsx';
import { completeness, SlipScanner, type SlipOutcome } from './SlipScanner.tsx';
import type { PaySlip } from '../domain/payslip.ts';

/** A slip's key for knowing it again: the same period, pay day and amounts. */
const keyOf = (slip: SlipRecord['slip']) => `${slip.periodStart ?? ''}|${slip.payDate ?? ''}|${slip.lines.reduce((sum, l) => sum + (l.amount ?? 0), 0).toFixed(2)}`;

/**
 * A slip read (from a PDF, a photo or the scanner) saved, unless it was
 * imported before or nothing could be read; a pay day it lacks is the one in
 * the settings.
 */
async function storeSlip(read: PaySlip, file: Blob, fileName: string, payDay: number | null): Promise<SlipOutcome & { id?: string }> {
  if (read.lines.length === 0) return { status: 'none' };
  const slip = withPayDay(read, payDay);
  const known = new Set((await db.slips.toArray()).map((r) => keyOf(r.slip)));
  if (known.has(keyOf(slip))) return { status: 'duplicate', period: slip.periodStart };
  const id = newId();
  await db.slips.put({ id, fileName, importedAt: Date.now(), periodStart: slip.periodStart ?? '', slip, pdf: file });
  return { status: 'saved', period: slip.periodStart, id, check: completeness(slip) < 7 };
}

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
  const { t, fmt, settings } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const photo = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const slips = useLiveQuery(() => db.slips.orderBy('periodStart').reverse().toArray(), []);

  /** Each file picked, and how its import went (several can be picked at once). */
  const [results, setResults] = useState<{ name: string; status: 'reading' | 'done' | 'duplicate' | 'none' | 'failed'; period?: string; id?: string }[]>([]);

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
        if (outcome.status === 'duplicate') {
          update(k, { status: 'duplicate', period: outcome.period });
          continue;
        }
        update(k, { status: 'done', period: outcome.period, id: outcome.id });
        lastId = outcome.id;
        imported++;
      } catch (e) {
        update(k, { status: 'failed' });
        if (files.length === 1) setError(t('slips.failed', { error: e instanceof Error ? e.message : String(e) }));
      }
    }
    setBusy(false);
    // One slip: straight to its comparison, as before. Several: the list, with how each went.
    if (files.length === 1 && imported === 1 && lastId) navigate({ name: 'slip', id: lastId });
    if (files.length === 1 && imported === 0) setResults([]);
  };

  /** A slip read by the scanner: saved at once (the scanner says how it went). */
  const onScanned = useCallback(
    async (slip: PaySlip, picture: Blob): Promise<SlipOutcome> => {
      const outcome = await storeSlip(slip, picture, `${t('slipscan.title')} ${new Date().toISOString().slice(0, 10)}.jpg`, settings.payDay);
      if (outcome.id) setScanned((ids) => [...ids, outcome.id!]);
      return outcome;
    },
    [settings.payDay, t],
  );
  const closeScanner = () => {
    setScanning(false);
    // One slip scanned: straight to it (its check card); several: the list.
    if (scanned.length === 1) navigate({ name: 'slip', id: scanned[0] });
    setScanned([]);
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
        {results.length > 1 && (
          <ul className="timecard-files">
            {results.map((r, i) => (
              <li key={i}>
                <span>{r.name}</span>
                {r.status === 'reading' && <span className="muted">…</span>}
                {r.status === 'done' && (
                  <a className="ok" href={href({ name: 'slip', id: r.id! })}>
                    ✓ {r.period ? fmt.month(r.period) : t('slips.result.done')}
                  </a>
                )}
                {r.status === 'duplicate' && <span className="muted">{t('slips.result.duplicate', { month: r.period ? fmt.month(r.period) : '' })}</span>}
                {r.status === 'none' && <span className="warn-text">{t('slips.noLines')}</span>}
                {r.status === 'failed' && <span className="warn-text">{t('slips.result.failed')}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {slips && slips.length === 0 && <p className="muted">{t('slips.empty')}</p>}
      <WageFromSlips />
      <ul className="slip-list">
        {slips?.map((s) => (
          <SlipItem key={s.id} record={s} all={slips} />
        ))}
      </ul>
      {slips && <VacationProgress slips={slips} />}
    </Page>
  );
}

function SlipItem({ record, all }: { record: SlipRecord; all: SlipRecord[] }) {
  const { t, fmt, days, settings } = useApp();
  const slip = applyOverrides(record.slip, settings.codeOverrides);
  const { start, end } = slipPeriod(slip, record.importedAt);
  const taxYear = Number((slip.payDate ?? end).slice(0, 4));
  const taxData = useTaxData(taxYear);
  const tax = { basis: taxBasis(settings.tax, taxData.rates), tables: taxData.tables, column: taxColumn(settings.birthDate, taxYear) };
  const vacation = vacationBasisFor(slip, all, settings);
  const findings = countFindings(comparePeriod(calculatePeriod(days, settings, start, end), slip, days, settings, tax, vacation));
  return (
    <li>
      <a className="slip-item" href={href({ name: 'slip', id: record.id })}>
        <span className="slip-period">{fmt.month(start)}</span>
        <span className="muted small">
          {slip.payDate ? t('compare.paid', { date: fmt.date(slip.payDate) }) : record.fileName}
        </span>
        <span className="slip-amounts">
          {t('slips.gross')} {fmt.money(slip.gross)} · {t('slips.net')} {fmt.money(slip.net)}
        </span>
        {needsCheck(record) ? (
          <span className="badge badge-diff">{t('slipCheck.badge')}</span>
        ) : (
          <span className={`badge ${findings ? 'badge-diff' : 'badge-ok'}`}>
            {findings ? t('slips.differences', { n: findings }) : t('slips.matches')}
          </span>
        )}
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
