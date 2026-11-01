import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { useApp } from '../app-context.ts';
import { db, saveSettings } from '../db.ts';
import { wagePeriodOn } from '../domain/model.ts';
import { applyPaidSupplement, applyPaidWage, paidWageFrom, paidWages, wageChanges, type PaidWage, type SupplementBreakdown } from '../domain/raises.ts';
import { Card, Notice } from './common.tsx';
import { applyOverrides } from './slipComparison.ts';

// The wage as paid on the pay slips, period by period: a raise the settings
// don't have yet is suggested, to add with one tap; a wage below the
// agreement's minimum is pointed out instead (something to take up, not to
// copy into the settings).

export function WageFromSlips({ onlyChanges = false }: { onlyChanges?: boolean }) {
  const { t, fmt, settings } = useApp();
  const records = useLiveQuery(() => db.slips.toArray(), []);
  const [history, setHistory] = useState(false);
  const paid = useMemo(() => paidWages((records ?? []).map((r) => applyOverrides(r.slip, settings.codeOverrides))), [records, settings.codeOverrides]);
  const changes = useMemo(() => wageChanges(paid, settings), [paid, settings]);
  if (!paid.length || (onlyChanges && !changes.length)) return null;
  const amount = (p: { basis: 'hourly' | 'monthly'; amount: number } | null, n?: number | null) =>
    n === null || !p ? t('wageSlips.none') : t(p.basis === 'hourly' ? 'wageSlips.perHour' : 'wageSlips.perMonth', { amount: fmt.money(n ?? p.amount) });
  const span = (p: PaidWage) => `${fmt.date(p.from, 'numeric')}–${fmt.date(p.to, 'numeric')}`;
  return (
    <Card title={t('wageSlips.title')}>
      {changes.length === 0 && <p className="ok small">✓ {t('wageSlips.allFit')}</p>}
      {changes.map((c) =>
        c.kind === 'belowMinimum' ? (
          <Notice key={c.paid.from} kind="warn">
            {t('wageSlips.below', { date: fmt.date(c.paid.from, 'long'), paid: amount(c.paid), minimum: amount(c.paid, c.minimum) })}
          </Notice>
        ) : (
          <div key={c.paid.from} className="wage-change">
            <p>
              <strong>{t('wageSlips.from', { date: fmt.date(c.paid.from, 'long'), paid: amount(c.paid) })}</strong>{' '}
              {t('wageSlips.onSlips', { n: c.paid.slips.length, span: span(c.paid) })}
              <br />
              <span className="muted small">{t('wageSlips.settingsHave', { set: amount(c.paid, c.settings) })}</span>
            </p>
            {c.paid.retro && <p className="small warn-text">{t('wageSlips.retro')}</p>}
            {c.breakdown ? (
              <Breakdown b={c.breakdown} paid={c.paid} />
            ) : (
              <button type="button" className="button button-primary" onClick={() => void saveSettings({ wages: applyPaidWage(settings, c.paid).wages })}>
                {t('wageSlips.apply', { date: fmt.date(paidWageFrom(settings, c.paid), 'numeric') })}
              </button>
            )}
          </div>
        ),
      )}
      {changes.some((c) => c.kind === 'differs' && !c.breakdown) && <p className="muted small">{t('wageSlips.caution')}</p>}
      <label className="checkbox small">
        <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} />
        <span>{t('wageSlips.history')}</span>
      </label>
      {history && (
        <table className="table small">
          <tbody>
            {paid.map((p) => (
              <tr key={p.from + p.amount}>
                <td>{span(p)}</td>
                <td className="num">{amount(p)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

/**
 * A wage of "the minimum plus a supplement" against the slip: how much above
 * the minimum each pays, per hour and per normal month, the difference on the
 * hours paid – and either something to take up, or the supplement to change.
 */
function Breakdown({ b, paid }: { b: SupplementBreakdown; paid: PaidWage }) {
  const { t, fmt, settings } = useApp();
  const w = wagePeriodOn(settings, paid.from);
  // A supplement entered per month is shown as entered ("2 000 kr/mån"), not as its hourly share × 174.
  const setMonth = w?.supplementPer === 'month' && w.supplement ? w.supplement : b.setPerMonth;
  const less = b.perHour < 0;
  return (
    <div className="wage-breakdown">
      <table className="table small">
        <tbody>
          <tr>
            <td>{t('wageSlips.bd.slip')}</td>
            <td className="num">
              {t('wageSlips.bd.parts', { minimum: fmt.money(b.minimum), supplement: fmt.money(b.paidSupplement) })}
              <br />
              <span className="muted">{t('wageSlips.bd.month', { amount: fmt.money(Math.round(b.paidPerMonth)) })}</span>
            </td>
          </tr>
          <tr>
            <td>{t('wageSlips.bd.set')}</td>
            <td className="num">
              {t('wageSlips.bd.parts', { minimum: fmt.money(b.minimum), supplement: fmt.money(b.setSupplement) })}
              <br />
              <span className="muted">{t('wageSlips.bd.month', { amount: fmt.money(Math.round(setMonth)) })}</span>
            </td>
          </tr>
          <tr className="report-sum">
            <td>{t('wageSlips.bd.diff')}</td>
            <td className="num">
              {t('wageSlips.perHour', { amount: fmt.signedMoney(b.perHour) })}
              <br />
              {t('wageSlips.bd.month', { amount: fmt.signedMoney(Math.round(b.paidPerMonth - setMonth)) })}
            </td>
          </tr>
        </tbody>
      </table>
      {paid.hours > 0 && <p className="small">{t('wageSlips.bd.onHours', { hours: fmt.number(paid.hours, Number.isInteger(paid.hours) ? 0 : 2), amount: fmt.signedMoney(b.onHours) })}</p>}
      <Notice kind={less ? 'warn' : 'info'}>{t(less ? 'wageSlips.bd.less' : 'wageSlips.bd.more', { month: fmt.money(Math.round(setMonth)) })}</Notice>
      <button type="button" className="button" onClick={() => void saveSettings({ wages: applyPaidSupplement(settings, paid, b).wages })}>
        {t('wageSlips.bd.apply', { supplement: fmt.money(b.paidSupplement), date: fmt.date(paid.from, 'numeric') })}
      </button>
    </div>
  );
}
