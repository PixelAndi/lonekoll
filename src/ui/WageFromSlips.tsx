import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { useApp } from '../app-context.ts';
import { db, saveSettings } from '../db.ts';
import { applyPaidWage, paidWageFrom, paidWages, wageChanges, type PaidWage } from '../domain/raises.ts';
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
            <button type="button" className="button button-primary" onClick={() => void saveSettings({ wages: applyPaidWage(settings, c.paid).wages })}>
              {t('wageSlips.apply', { date: fmt.date(paidWageFrom(settings, c.paid), 'numeric') })}
            </button>
          </div>
        ),
      )}
      {changes.some((c) => c.kind === 'differs') && <p className="muted small">{t('wageSlips.caution')}</p>}
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
