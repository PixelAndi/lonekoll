import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { useApp } from '../app-context.ts';
import { db, saveSettings } from '../db.ts';
import type { WagePeriod } from '../domain/model.ts';
import { stepsNotInSettings, wageHistory, wagesFromHistory, type WageStep } from '../domain/wageHistory.ts';
import type { TextKey } from '../i18n.ts';
import { href } from '../router.ts';
import { Fold, Notice } from './common.tsx';
import { applyOverrides } from './slipComparison.ts';

// The wage as paid on the pay slips, step by step: each wage taken apart into
// the agreement's minimum and the personal supplement above it, each change
// named for what it was (the agreement's raise, the step after a year, a
// personal raise, a wage put right, a cut). Where the settings say something
// else, one tap sets them as the slips pay: the minimum plus the supplement,
// so the wage follows every new minimum. A wage below the minimum is set as
// the minimum – that is what was due – and the difference stays to take up.

export function WageFromSlips({ onlyChanges = false }: { onlyChanges?: boolean }) {
  const { t, fmt, settings } = useApp();
  const records = useLiveQuery(() => db.slips.toArray(), []);
  const steps = useMemo(
    () =>
      wageHistory(
        (records ?? []).map((r) => applyOverrides(r.slip, settings.codeOverrides)),
        settings,
      ),
    [records, settings],
  );
  const off = useMemo(() => stepsNotInSettings(steps, settings), [steps, settings]);
  if (!steps.length) return null;
  // In the settings: only a line saying the slips pay otherwise, with the way to the details.
  if (onlyChanges) {
    if (!off.length) return null;
    return (
      <Notice kind="info">
        {t('wageSlips.settingsNote', { n: off.length })} <a href={`${href({ name: 'slips' })}`}>{t('wageSlips.settingsLink')}</a>
      </Notice>
    );
  }
  const proposal = wagesFromHistory(steps, settings);
  const per = (s: { basis: WageStep['basis'] }, amount: number) =>
    t(s.basis === 'hourly' ? 'wageSlips.perHour' : 'wageSlips.perMonth', {
      amount: fmt.money(amount),
    });
  const rowText = (w: WagePeriod) =>
    w.basis === 'monthly'
      ? t('wageHist.row.monthly', { amount: fmt.money(w.monthly ?? 0) })
      : w.basis === 'fixed'
        ? t('wageHist.row.fixed', { amount: fmt.money(w.hourly) })
        : w.supplement
          ? t('wageHist.row.minimumPlus', {
              supplement: fmt.money(w.supplement),
            })
          : t('wageHist.row.minimum');
  const apply = () => {
    if (window.confirm(t('wageHist.confirm'))) void saveSettings({ wages: proposal });
  };
  const below = steps.some((s) => s.belowMinimum);
  return (
    <Fold
      title={t('wageSlips.title')}
      sub={off.length ? t('wageSlips.summaryDiffers', { n: off.length }) : t('wageSlips.summaryOk')}
      warn={off.length > 0}
      id="wage"
    >
      <p className="small">{t('wageHist.intro')}</p>
      <ul className="wage-history">
        {[...steps].reverse().map((s) => (
          <li key={s.from + s.amount} className={s.belowMinimum ? 'wage-below' : ''}>
            <div className="wage-step-head">
              <span>
                {fmt.date(s.from, 'numeric')}–{fmt.date(s.to, 'numeric')}
              </span>
              <strong>{per(s, s.amount)}</strong>
            </div>
            {s.known && (
              <p className="small muted">
                {s.above === 0
                  ? t('wageHist.atMinimum', { minimum: per(s, s.minimum) })
                  : s.above > 0
                    ? t('wageHist.parts', {
                        minimum: per(s, s.minimum),
                        above: per(s, s.above),
                      })
                    : t('wageHist.belowParts', {
                        minimum: per(s, s.minimum),
                        below: per(s, -s.above),
                      })}
              </p>
            )}
            {(s.change || s.belowMinimum) && (
              <p className="wage-kinds">
                {changeKinds(s).map(([key, amount]) => (
                  <span key={key} className={`tag wage-kind wage-kind-${key.split('.').pop()}`}>
                    {t(key, { amount: per(s, Math.abs(amount)) })}
                  </span>
                ))}
              </p>
            )}
            {s.retro && <p className="small muted">{t('wageSlips.retro')}</p>}
          </li>
        ))}
      </ul>
      {off.length === 0 ? (
        <p className="ok small">✓ {t('wageSlips.allFit')}</p>
      ) : (
        <div className="wage-apply">
          <Notice kind="info">{t('wageHist.differs', { n: off.length })}</Notice>
          <ul className="small">
            {proposal.map((w) => (
              <li key={w.from}>
                {t('wageHist.row.from', { date: fmt.date(w.from, 'numeric') })} {rowText(w)}
              </li>
            ))}
          </ul>
          <button type="button" className="button button-primary" onClick={apply}>
            {t('wageHist.apply')}
          </button>
          <p className="small muted">{t(below ? 'wageHist.applyBelow' : 'wageHist.applyNote')}</p>
        </div>
      )}
    </Fold>
  );
}

/** What a step's change was made of, as labels with their amounts. */
function changeKinds(s: WageStep): [TextKey, number][] {
  const out: [TextKey, number][] = [];
  const c = s.change;
  if (c) {
    if (c.agreement > 0.005)
      out.push([c.revision && c.oneYear ? 'wageHist.kind.revisionOneYear' : c.oneYear ? 'wageHist.kind.oneYear' : 'wageHist.kind.revision', c.agreement]);
    if (c.corrected > 0.005) out.push(['wageHist.kind.corrected', c.corrected]);
    if (c.personal > 0.005) out.push(['wageHist.kind.personal', c.personal]);
    if (c.personal < -0.005) out.push(['wageHist.kind.lower', c.personal]);
    if (c.amount < -0.005) out.push(['wageHist.kind.cut', c.amount]);
  }
  if (s.belowMinimum) out.push(['wageHist.kind.below', s.minimum - s.amount]);
  return out;
}
