import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState, type ReactNode } from 'react';
import { useApp } from '../app-context.ts';
import { db, saveSettings } from '../db.ts';
import { wagePeriodOn } from '../domain/model.ts';
import { applyPaidSupplement, applyPaidWage, paidWageFrom, paidWages, wageChanges, type PaidWage, type SupplementBreakdown, type WageChange } from '../domain/raises.ts';
import { href } from '../router.ts';
import { Fold, Notice } from './common.tsx';
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
  if (!paid.length) return null;
  // In the settings: only a line saying the slips pay otherwise, with the way to the details.
  if (onlyChanges) {
    if (!changes.length) return null;
    return (
      <Notice kind="info">
        {t('wageSlips.settingsNote', { n: changes.length })}{' '}
        <a href={`${href({ name: 'slips' })}`}>{t('wageSlips.settingsLink')}</a>
      </Notice>
    );
  }
  const amount = (p: { basis: 'hourly' | 'monthly'; amount: number } | null, n?: number | null) =>
    n === null || !p ? t('wageSlips.none') : t(p.basis === 'hourly' ? 'wageSlips.perHour' : 'wageSlips.perMonth', { amount: fmt.money(n ?? p.amount) });
  const span = (p: PaidWage) => `${fmt.date(p.from, 'numeric')}–${fmt.date(p.to, 'numeric')}`;
  const other = (c: WageChange) => (c.kind === 'belowMinimum' ? c.minimum : c.settings);
  return (
    <Fold
      title={t('wageSlips.title')}
      sub={changes.length ? t('wageSlips.summaryDiffers', { n: changes.length }) : t('wageSlips.summaryOk')}
      warn={changes.length > 0}
    >
      {changes.length === 0 ? <p className="ok small">✓ {t('wageSlips.allFit')}</p> : <p className="small">{t('wageSlips.explain')}</p>}
      {changes.length > 0 && (
        <table className="table small wage-table">
          <thead>
            <tr>
              <th>{t('wageSlips.col.period')}</th>
              <th className="num">{t('wageSlips.col.slip')}</th>
              <th className="num">{t('wageSlips.col.settings')}</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((c) => (
              <WageRow key={c.paid.from} change={c} span={span(c.paid)} paid={amount(c.paid)} other={c.kind === 'belowMinimum' ? t('wageSlips.belowShort', { minimum: amount(c.paid, c.minimum) }) : amount(c.paid, other(c))}>
                {c.kind === 'belowMinimum' ? (
                  <Notice kind="warn">{t('wageSlips.below', { date: fmt.date(c.paid.from, 'long'), paid: amount(c.paid), minimum: amount(c.paid, c.minimum) })}</Notice>
                ) : (
                  <div className="wage-change">
                    <p className="small">
                      {t('wageSlips.onSlips', { n: c.paid.slips.length, span: span(c.paid) })}
                    </p>
                    {c.paid.retro && <p className="small warn-text">{t('wageSlips.retro')}</p>}
                    {c.breakdown ? (
                      <Breakdown b={c.breakdown} paid={c.paid} />
                    ) : (
                      <>
                        <button type="button" className="button button-primary" onClick={() => void saveSettings({ wages: applyPaidWage(settings, c.paid).wages })}>
                          {t('wageSlips.apply', { date: fmt.date(paidWageFrom(settings, c.paid), 'numeric') })}
                        </button>
                        <p className="muted small">{t('wageSlips.caution')}</p>
                      </>
                    )}
                  </div>
                )}
              </WageRow>
            ))}
          </tbody>
        </table>
      )}
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
    </Fold>
  );
}

/** A period whose wage differs: one line, and what can be done about it when tapped. */
function WageRow({ change, span, paid, other, children }: { change: WageChange; span: string; paid: string; other: string; children: ReactNode }) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className={change.kind === 'belowMinimum' ? 'wage-below' : ''}>
        <td>{span}</td>
        <td className="num">{paid}</td>
        <td className="num">{other}</td>
      </tr>
      <tr className="wage-more">
        <td colSpan={3}>
          <button type="button" className="link-button small" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? t('wageSlips.hide') : t('wageSlips.details')}
          </button>
          {open && children}
        </td>
      </tr>
    </>
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
