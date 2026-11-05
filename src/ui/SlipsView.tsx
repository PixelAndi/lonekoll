import { useLiveQuery } from 'dexie-react-hooks';
import { withPayDay } from '../domain/payday.ts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { wageHistory } from '../domain/wageHistory.ts';
import { earningYearForVacationOn, vacationBasis } from '../domain/vacation.ts';
import { useIssues } from './issues-context.tsx';
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
import { onSlipScan, takeSlipScan } from './actions.ts';
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
async function storeSlip(read: PaySlip, file: Blob, fileName: string, payDay: number | null): Promise<SlipOutcome & { id?: string }> {
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
  // The + button's "Lönebesked": the scanner opens here.
  useEffect(() => {
    if (takeSlipScan()) setScanning(true);
    return onSlipScan(() => setScanning(true));
  }, []);

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
    <Page title={t('nav.pay')}>
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
      {slips && slips.length > 0 && <LatestSlip record={latestOf(slips)} all={slips} />}
      {slips && slips.length > 0 && <SlipYear slips={slips} />}
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
          <WageSteps slips={slips} />
          <WageFromSlips />
          <Fold title={t('vacation.title')} sub={<VacationSub slips={slips} />}>
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
      <button type="button" className="link-button on-light small" onClick={onClose}>
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
      {order.map((year) => {
        const list = years.get(year)!;
        const unsure = list.filter(needsCheck).length;
        return (
          <Fold
            key={year || 'none'}
            open={false}
            title={t('pay.allSlips', { year: year || t('slips.noPeriod') })}
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
  const { t, fmt } = useApp();
  const { slip, start, label, kind } = useSlipStatus(record, all);
  const photo = /^image\//.test(record.pdf.type);
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

/**
 * How a slip stands against the log: its reading to be checked, nothing logged in its period, the
 * number of rows that differ, or a match.
 */
export function useSlipStatus(record: SlipRecord, all: SlipRecord[]) {
  const { t, days, settings } = useApp();
  const slip = applyOverrides(record.slip, settings.codeOverrides);
  const { start, end } = slipPeriod(slip, record.importedAt);
  const taxYear = Number((slip.payDate ?? end).slice(0, 4));
  const taxData = useTaxData(taxYear);
  return useMemo(() => {
    const tax = { basis: taxBasis(settings.tax, taxData.rates), tables: taxData.tables, column: taxColumn(settings.birthDate, taxYear) };
    const vacation = vacationBasisFor(slip, all, settings);
    // Without days logged in its period the comparison has nothing to go on: said as such, not as differences.
    const logged = days.some((d) => d.date >= start && d.date <= end && (d.rows.length > 0 || !!d.absence));
    const findings = logged ? countFindings(comparePeriod(calculatePeriod(days, settings, start, end), slip, days, settings, tax, vacation)) : 0;
    const check = needsCheck(record);
    const [label, kind]: [string, 'warn' | 'muted' | 'diff' | 'ok'] = check
      ? [t('slipCheck.badge'), 'warn']
      : !logged
        ? [t('slips.noDays'), 'muted']
        : findings
          ? [t('slips.differences', { n: findings }), 'diff']
          : [t('slips.matches'), 'ok'];
    return { slip, start, end, logged, findings, check, label, kind };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record, all, days, settings, taxData, taxYear, t]);
}

/** The newest slip (by period, then pay day). */
const latestOf = (slips: SlipRecord[]) =>
  [...slips].sort((a, b) => (b.periodStart || '').localeCompare(a.periodStart || '') || (b.slip.payDate ?? '').localeCompare(a.slip.payDate ?? ''))[0];

const sumOf = (slip: PaySlip, prefix: string) => slip.lines.filter((l) => l.category.startsWith(prefix)).reduce((s, l) => s + (l.amount ?? 0), 0);

/** The latest slip, highlighted like the Kalender's month: how it stands, and its figures. */
function LatestSlip({ record, all }: { record: SlipRecord; all: SlipRecord[] }) {
  const { t, fmt } = useApp();
  const { slip, start, label, kind } = useSlipStatus(record, all);
  const taxShare = slip.gross && slip.tax ? (slip.tax / slip.gross) * 100 : undefined;
  const extra = sumOf(slip, 'ob') + sumOf(slip, 'ot');
  return (
    <section className="card cal-focus">
      <div className="cal-focus-head">
        <strong>{t('pay.latest', { month: fmt.month(start) })}</strong>
        <a href={href({ name: 'slip', id: record.id })}>{t('pay.open')}</a>
      </div>
      <div className="cal-chips">
        <a className={`cal-chip ${kind === 'ok' ? 'cal-chip-ok' : kind === 'muted' ? '' : 'cal-chip-warn'}`} href={href({ name: 'slip', id: record.id })}>
          {kind === 'ok' ? `✓ ${t('pay.chip.matches')}` : label}
        </a>
        {slip.payDate && <span className="cal-chip">{t('pay.chip.paid', { date: fmt.date(slip.payDate) })}</span>}
      </div>
      <div className="cal-numbers">
        <div>
          <strong>{fmt.money(slip.gross)}</strong>
          <span className="small muted">{t('pay.num.gross')}</span>
        </div>
        <div>
          <strong>{fmt.money(slip.net)}</strong>
          <span className="small muted">{t('pay.num.net')}</span>
        </div>
        <div>
          <strong>{taxShare !== undefined ? `${fmt.number(taxShare, 1)} %` : '–'}</strong>
          <span className="small muted">{slip.taxTable ? t('pay.num.taxTable', { table: slip.taxTable }) : t('pay.num.tax')}</span>
        </div>
        <div>
          <strong>{fmt.money(extra)}</strong>
          <span className="small muted">{t('pay.num.extra')}</span>
        </div>
      </div>
    </section>
  );
}

/** One square of the year: a month and how its slip stands. */
function MonthSquare({ month, records, all, now, owedKind, first }: { month: string; records: SlipRecord[]; all: SlipRecord[]; now: string; owedKind?: 'bad' | 'warn'; first: string }) {
  const { fmt } = useApp();
  const name = fmt.monthShort(`${month}-01`);
  if (!records.length) {
    // Before the employment (or the first slip) a month has nothing to miss.
    const kind = month > now || month < first ? 'pay-sq-later' : month === now ? 'pay-sq-now' : 'pay-sq-none';
    return (
      <span className={`pay-sq ${kind}`}>
        <strong>{name}</strong>
        <span>{month === now ? '…' : ''}</span>
      </span>
    );
  }
  return <MonthSquareSlip name={name} record={records[0]} all={all} owedKind={owedKind} />;
}

function MonthSquareSlip({ name, record, all, owedKind }: { name: string; record: SlipRecord; all: SlipRecord[]; owedKind?: 'bad' | 'warn' }) {
  const { kind } = useSlipStatus(record, all);
  const cls = owedKind === 'bad' ? 'pay-sq-bad' : owedKind === 'warn' || kind === 'warn' || kind === 'diff' ? 'pay-sq-warn' : kind === 'ok' ? 'pay-sq-ok' : 'pay-sq-read';
  return (
    <a className={`pay-sq ${cls}`} href={href({ name: 'slip', id: record.id })}>
      <strong>{name}</strong>
      <span>{cls === 'pay-sq-ok' ? '✓' : cls === 'pay-sq-read' ? '·' : '!'}</span>
    </a>
  );
}

/** The year's slips as twelve squares, like the Kalender's year: what each month's slip says. */
function SlipYear({ slips }: { slips: SlipRecord[] }) {
  const { t, fmt, settings } = useApp();
  const now = todayLocal().slice(0, 7);
  const first = [settings.employedSince?.slice(0, 7), ...slips.map((r) => r.periodStart.slice(0, 7)).filter(Boolean)].filter(Boolean).sort()[0] ?? now;
  const years = [...new Set(slips.map((r) => r.periodStart.slice(0, 4)).filter(Boolean))].sort();
  const [year, setYear] = useState(() => latestOf(slips).periodStart.slice(0, 4) || now.slice(0, 4));
  const { owed } = useIssues();
  const owedKind = (m: string): 'bad' | 'warn' | undefined =>
    owed?.likely.some((i) => i.months.includes(`${m}-01`)) ? 'bad' : owed?.investigate.some((i) => i.months.includes(`${m}-01`)) ? 'warn' : undefined;
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const inYear = slips.filter((r) => r.periodStart.startsWith(year));
  const gross = inYear.reduce((s, r) => s + (r.slip.gross ?? 0), 0);
  const net = inYear.reduce((s, r) => s + (r.slip.net ?? 0), 0);
  const i = years.indexOf(year);
  return (
    <section className="card pay-year">
      <div className="cal-focus-head">
        <strong>{t('pay.year')}</strong>
        <span className="cal-year-nav">
          <button type="button" className="link-inline" disabled={i <= 0} onClick={() => setYear(years[i - 1])} aria-label={t('common.previous')}>
            ‹
          </button>
          <strong>{year}</strong>
          <button type="button" className="link-inline" disabled={i < 0 || i >= years.length - 1} onClick={() => setYear(years[i + 1])} aria-label={t('common.next')}>
            ›
          </button>
        </span>
      </div>
      <div className="pay-squares">
        {months.map((m) => (
          <MonthSquare key={m} month={m} records={slips.filter((r) => r.periodStart.startsWith(m))} all={slips} now={now} owedKind={owedKind(m)} first={first} />
        ))}
      </div>
      <p className="cal-legend small">
        <span>✓ {t('pay.key.ok')}</span>
        <span>
          <i className="cal-key cal-missing" /> {t('pay.key.check')}
        </span>
        <span>
          <i className="cal-key cal-sick" /> {t('pay.key.bad')}
        </span>
        <span>▢ {t('pay.key.none')}</span>
      </p>
      {inYear.length > 0 && <p className="small muted">{t('pay.yearTotal', { n: inYear.length, gross: fmt.money(Math.round(gross)), net: fmt.money(Math.round(net)) })}</p>}
    </section>
  );
}

/** The hourly (or monthly) wage on the slips as steps, the latest on the right. */
function WageSteps({ slips }: { slips: SlipRecord[] }) {
  const { t, fmt, settings } = useApp();
  const steps = useMemo(() => wageHistory(slips.map((r) => applyOverrides(r.slip, settings.codeOverrides)), settings), [slips, settings]);
  const shown = steps.slice(-6);
  if (shown.length < 1) return null;
  const amounts = shown.map((s) => s.amount);
  const low = Math.min(...amounts);
  const high = Math.max(...amounts);
  const span = (s: (typeof shown)[number]) => Math.max(1, (Date.parse(s.to) - Date.parse(s.from)) / 864e5);
  const per = shown[0].basis === 'monthly' ? 'wageSlips.perMonth' : 'wageSlips.perHour';
  const last = shown[shown.length - 1];
  return (
    <section className="card pay-wage">
      <div className="cal-focus-head">
        <strong>{t('pay.wageTitle')}</strong>
        <span className="small">{t(per, { amount: fmt.money(last.amount) })}</span>
      </div>
      <div className="pay-wage-bars" aria-hidden="true">
        {shown.map((s, i) => (
          <i key={s.from} style={{ flexGrow: span(s), height: `${high === low ? 100 : 45 + (55 * (s.amount - low)) / (high - low)}%` }} className={i === shown.length - 1 ? 'pay-wage-now' : ''} />
        ))}
      </div>
      <ul className="pay-wage-steps small">
        {shown.map((s) => (
          <li key={s.from}>
            <span>{fmt.date(s.from, 'inText')}</span>
            <span>{t(per, { amount: fmt.money(s.amount) })}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "4 av 12 lönebesked": how far the vacation pay's earning year is. */
function VacationSub({ slips }: { slips: SlipRecord[] }) {
  const { t, settings } = useApp();
  const n = useMemo(() => {
    const b = vacationBasis(slips.map((r) => applyOverrides(r.slip, settings.codeOverrides)), settings, earningYearForVacationOn(todayLocal(), settings));
    return { done: b.months.filter((m) => m.covered).length, total: b.months.length };
  }, [slips, settings]);
  return <>{t('vacation.progress', { n: n.done, total: n.total, left: n.total - n.done })}</>;
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
