import { useApp } from '../app-context.ts';
import { db, saveSettings } from '../db.ts';
import type { Comparison, CoverageNote } from '../domain/compare.ts';
import type { SlipCategory } from '../domain/payslip.ts';
import type { Formatter } from '../format.ts';
import type { Translate } from '../i18n.ts';
import { goBack, href } from '../router.ts';
import { Card, Notice, Page, Spinner, StatusBadge } from './common.tsx';
import { PeriodWarnings } from './MonthView.tsx';
import { SlipNotFound } from './SlipsView.tsx';
import { diffText, noteText, rowLabel, rowReference, sideText, useSlipComparison } from './slipComparison.ts';

const SLIP_CATEGORIES: SlipCategory[] = [
  'wage',
  'ob1',
  'ob2',
  'ob3',
  'ob4',
  'obUnknown',
  'ot50',
  'ot100',
  'otUnknown',
  'sickPay',
  'sickHours',
  'karens',
  'holidayPay',
  'permission',
  'vacationDays',
  'vacationPay',
  'timebankHours',
  'timebankPay',
  'shiftedTime',
  'other',
];

export function coverageText(note: CoverageNote, t: Translate, fmt: Formatter): string {
  return note.code === 'no-log' ? t('compare.no-log') : t('compare.log-starts-late', { date: fmt.date(note.date) });
}

export function totalText(c: Comparison, t: Translate, fmt: Formatter): { text: string; kind: 'ok' | 'warn' } {
  if (c.coverage.some((n) => n.code === 'no-log')) return { text: t('compare.nothingToCompare'), kind: 'warn' };
  if (c.totalDifference === undefined) return { text: t('compare.noGross'), kind: 'warn' };
  if (Math.abs(c.totalDifference) <= 1) return { text: t('compare.match'), kind: 'ok' };
  const amount = fmt.money(Math.abs(c.totalDifference));
  return { text: t(c.totalDifference < 0 ? 'compare.underpaid' : 'compare.overpaid', { amount }), kind: 'warn' };
}

export function CompareView({ id }: { id: string }) {
  const { t, fmt, settings } = useApp();
  const data = useSlipComparison(id);
  if (data === undefined) return <Spinner />;
  if (data === null) return <SlipNotFound />;
  const { slip, comparison, period, start, end } = data;
  const total = totalText(comparison, t, fmt);

  const setCategory = (code: string, category: string) =>
    saveSettings({ codeOverrides: { ...settings.codeOverrides, [code]: category } });
  const remove = async () => {
    if (!confirm(t('slips.deleteConfirm', { period: fmt.month(start) }))) return;
    await db.slips.delete(id);
    goBack({ name: 'slips' });
  };

  return (
    <Page title={`${t('compare.slip')} ${fmt.month(start)}`}>
      <p className="muted">
        {t('compare.period', { start, end })}
        {slip.payDate && `, ${t('compare.paid', { date: slip.payDate })}`}
      </p>
      {comparison.coverage.map((c) => (
        <Notice key={c.code} kind="warn">
          {coverageText(c, t, fmt)}
        </Notice>
      ))}
      <Notice kind={total.kind}>
        <strong>{total.text}</strong>
      </Notice>

      <div className="compare-rows">
        {comparison.rows.map((row) => (
          <Card key={row.key} className={`compare-row compare-${row.status}`}>
            <div className="compare-head">
              <h3>{rowLabel(row, t)}</h3>
              <StatusBadge status={row.status} />
            </div>
            <dl className="kv">
              <div className="kv-pair">
                <dt>{t('compare.expected')}</dt>
                <dd>{sideText(row.expected, row.key, fmt)}</dd>
              </div>
              <div className="kv-pair">
                <dt>{t('compare.slip')}</dt>
                <dd>{sideText(row.slip, row.key, fmt)}</dd>
              </div>
              {diffText(row, fmt) && (
                <div className="kv-pair">
                  <dt>{t('compare.diff')}</dt>
                  <dd className={row.diff.amount && row.diff.amount < 0 ? 'negative' : ''}>{diffText(row, fmt)}</dd>
                </div>
              )}
            </dl>
            {row.notes.map((n, i) => (
              <p key={i} className="note">
                {noteText(n, t, fmt)}
              </p>
            ))}
            <p className="muted small">{rowReference(row, t, settings, end)}</p>
          </Card>
        ))}
      </div>

      <PeriodWarnings period={period} />

      {slip.balances.timeBankHours ? <Notice>{t('compare.timeBankBalance', { hours: fmt.number(slip.balances.timeBankHours) })}</Notice> : null}

      <Card title={t('compare.lines')}>
        <ul className="slip-lines">
          {slip.lines.map((l, i) => (
            <li key={i}>
              <div className="slip-line-head">
                <span>
                  <span className="muted small">{l.code}</span> {l.text}
                </span>
                <span className="num">{l.amount !== undefined ? fmt.money(l.amount) : ''}</span>
              </div>
              <div className="muted small">
                {l.from && `${l.from}${l.to && l.to !== l.from ? ` – ${l.to}` : ''} · `}
                {l.quantity !== undefined && `${fmt.number(l.quantity)} ${l.unit ?? ''}`}
                {l.unitPrice !== undefined && ` × ${fmt.number(l.unitPrice)}`}
              </div>
              <label className="inline-field small">
                {t('compare.lineCategory')}
                <select value={l.category} onChange={(e) => setCategory(l.code, e.target.value)}>
                  {SLIP_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`cat.${c}`)}
                    </option>
                  ))}
                </select>
              </label>
            </li>
          ))}
        </ul>
      </Card>

      <div className="form-actions">
        <button type="button" className="button button-danger" onClick={remove}>
          {t('common.delete')}
        </button>
        <span className="spacer" />
        <a className="button button-primary" href={href({ name: 'report', id })}>
          {t('compare.report')}
        </a>
      </div>
    </Page>
  );
}
