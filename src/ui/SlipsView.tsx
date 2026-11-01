import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
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

export function SlipsView() {
  const { t, fmt, settings } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const photo = useRef<HTMLInputElement>(null);
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
    // A slip imported before (or twice in this batch) is skipped: the same period, pay day and amounts.
    const keyOf = (slip: SlipRecord['slip']) => `${slip.periodStart ?? ''}|${slip.payDate ?? ''}|${slip.lines.reduce((sum, l) => sum + (l.amount ?? 0), 0).toFixed(2)}`;
    const known = new Set((await db.slips.toArray()).map((r) => keyOf(r.slip)));
    const update = (k: number, patch: Partial<(typeof results)[number]>) => setResults((r) => r.map((x, i) => (i === k ? { ...x, ...patch } : x)));
    let lastId: string | undefined;
    let imported = 0;
    for (const [k, file] of files.entries()) {
      try {
        // A PDF, or a photo of the slip (read with the same text recognition as the scanners).
        const rate = hourlyRateOn(settings, todayLocal()) ?? undefined;
        const slip = /^image\//.test(file.type) ? await (await import('../ocr/browser.ts')).readPaySlipImage(file, rate) : await readPaySlipPdf(file, rate);
        if (slip.lines.length === 0) {
          update(k, { status: 'none' });
          continue;
        }
        const key = keyOf(slip);
        if (known.has(key)) {
          update(k, { status: 'duplicate', period: slip.periodStart });
          continue;
        }
        known.add(key);
        const id = newId();
        await db.slips.put({ id, fileName: file.name, importedAt: Date.now(), periodStart: slip.periodStart ?? '', slip, pdf: file });
        update(k, { status: 'done', period: slip.periodStart, id });
        lastId = id;
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

  return (
    <Page title={t('nav.slips')}>
      <div className="actions-stack">
        {/* The PDF from the employer first; a photo of a paper slip beside it. */}
        <div className="scan-row">
          <button type="button" className="button button-primary button-large" disabled={busy} onClick={() => input.current?.click()}>
            <Icon name="slips" /> {t('slips.import')}
          </button>
          <button type="button" className="button timecard-button" disabled={busy} onClick={() => {
              // The text recognition gets ready while the photo is taken.
              void import('../ocr/browser.ts').then((m) => m.warmUpSlipReading());
              photo.current?.click();
            }}>
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
        <span className={`badge ${findings ? 'badge-diff' : 'badge-ok'}`}>
          {findings ? t('slips.differences', { n: findings }) : t('slips.matches')}
        </span>
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
