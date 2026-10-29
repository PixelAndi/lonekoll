import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { useApp } from '../app-context.ts';
import { db, newId, type SlipRecord } from '../db.ts';
import { calculatePeriod } from '../domain/calc.ts';
import { comparePeriod } from '../domain/compare.ts';
import { hourlyRateOn } from '../domain/model.ts';
import { todayLocal } from '../domain/time.ts';
import { readPaySlipPdf } from '../pdf/browser.ts';
import { href, navigate } from '../router.ts';
import { Card, Icon, Notice, Page, Spinner } from './common.tsx';
import { applyOverrides, countFindings, slipPeriod } from './slipComparison.ts';

export function SlipsView() {
  const { t, settings } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const slips = useLiveQuery(() => db.slips.orderBy('periodStart').reverse().toArray(), []);

  const onFile = async (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    setBusy(true);
    setError(undefined);
    try {
      const slip = await readPaySlipPdf(file, hourlyRateOn(settings, todayLocal()) ?? undefined);
      if (slip.lines.length === 0) {
        setError(t('slips.noLines'));
        return;
      }
      const id = newId();
      await db.slips.put({ id, fileName: file.name, importedAt: Date.now(), periodStart: slip.periodStart ?? '', slip, pdf: file });
      navigate({ name: 'slip', id });
    } catch (e) {
      setError(t('slips.failed', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title={t('nav.slips')}>
      <div className="actions-stack">
        <button type="button" className="button button-primary button-large" disabled={busy} onClick={() => input.current?.click()}>
          <Icon name="slips" /> {t('slips.import')}
        </button>
        <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        {busy && <Spinner label={t('slips.importing')} />}
        {error && <Notice kind="error">{error}</Notice>}
      </div>
      {slips && slips.length === 0 && <p className="muted">{t('slips.empty')}</p>}
      <ul className="slip-list">
        {slips?.map((s) => (
          <SlipItem key={s.id} record={s} />
        ))}
      </ul>
    </Page>
  );
}

function SlipItem({ record }: { record: SlipRecord }) {
  const { t, fmt, days, settings } = useApp();
  const slip = applyOverrides(record.slip, settings.codeOverrides);
  const { start, end } = slipPeriod(slip, record.importedAt);
  const findings = countFindings(comparePeriod(calculatePeriod(days, settings, start, end), slip, days, settings));
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
