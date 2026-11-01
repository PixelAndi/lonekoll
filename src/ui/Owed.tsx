import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { useApp } from '../app-context.ts';
import { db, saveSettings } from '../db.ts';
import { checkAgainstAgreement } from '../domain/agreementCheck.ts';
import { periodBasis } from '../domain/basis.ts';
import { calculatePeriod } from '../domain/calc.ts';
import { comparePeriod } from '../domain/compare.ts';
import { owedEstimate, type MonthComparison, type Owed, type OwedItem } from '../domain/owed.ts';
import { todayLocal } from '../domain/time.ts';
import { stepsNotInSettings, wageHistory } from '../domain/wageHistory.ts';
import { href } from '../router.ts';
import { FindingItem, monthRanges } from './AgreementFindings.tsx';
import { Card, Fold } from './common.tsx';
import { needsCheck } from './SlipCheck.tsx';
import { applyOverrides, slipPeriod, vacationBasisFor } from './slipComparison.ts';

// A rough estimate of what may be owed, at the top of the pay slip page and
// as one line on the days page: what the slips pay below the agreement, and
// apart from it, months where the slip pays less than the log adds up to.
// Only shown when there is something; each amount can be marked as settled.

export function useOwed(): (Owed & { ids: Map<string, string> }) | null {
  const { days, settings } = useApp();
  const records = useLiveQuery(() => db.slips.toArray(), []);
  return useMemo(() => {
    if (!records?.length) return null;
    const today = todayLocal();
    const slips = records.map((r) => applyOverrides(r.slip, settings.codeOverrides));
    const findings = checkAgainstAgreement(slips, settings);
    // Months where the settings' wage isn't the one the slips pay: the comparison would measure the settings.
    const steps = wageHistory(slips, settings);
    const offSteps = stepsNotInSettings(steps, settings);
    const comparisons: MonthComparison[] = [];
    const ids = new Map<string, string>();
    records.forEach((r, i) => {
      const slip = slips[i];
      if (!slip.periodStart) return;
      ids.set(slip.periodStart, r.id);
      const { start, end } = slipPeriod(slip, r.importedAt);
      // Only a slip read to be trusted, with a wage read, that the settings pay the same.
      if (needsCheck(r) || !steps.some((s) => s.from <= end && s.to >= start)) return;
      if (offSteps.some((s) => s.from <= end && s.to >= start)) return;
      const period = calculatePeriod(days, settings, start, end);
      if (periodBasis(slip, days, settings, start, end, today, period.totals.wage?.hours).state !== 'full') return;
      const c = comparePeriod(period, slip, days, settings, undefined, vacationBasisFor(slip, records, settings));
      // Absences on the slip the log doesn't have (vacation days, sick pay): the log is missing them.
      const absencesMissing = c.rows.some(
        (row) => (row.key === 'vacationDays' && row.status === 'diff') || ((row.key === 'sickPay' || row.key === 'karens') && row.status === 'extra'),
      );
      if (c.totalDifference !== undefined && !absencesMissing)
        comparisons.push({
          month: slip.periodStart,
          difference: c.totalDifference,
        });
    });
    return {
      ...owedEstimate(findings, comparisons, slips, settings.settledOwed ?? [], today),
      ids,
    };
  }, [records, days, settings]);
}

const settle = (keys: string[], key: string, on: boolean) =>
  void saveSettings({
    settledOwed: on ? [...new Set([...keys, key])] : keys.filter((k) => k !== key),
  });

/** The card on the pay slip page. */
export function OwedCard() {
  const { t, fmt, settings } = useApp();
  const owed = useOwed();
  if (!owed) return null;
  const settled = settings.settledOwed ?? [];
  const something = owed.likely.length > 0 || owed.investigate.length > 0;
  if (!something && !owed.settled.length) return null;
  const amounts = (gross: number, net: number | null) =>
    net === null ? t('owed.gross', { gross: fmt.money(gross) }) : t('owed.grossNet', { gross: fmt.money(gross), net: fmt.money(net) });
  const settleButton = (i: OwedItem, on: boolean) => (
    <button type="button" className="owed-settle small" onClick={() => settle(settled, i.key, on)}>
      {on ? t('owed.settle') : t('owed.unsettle')}
    </button>
  );
  const settledList = owed.settled.length > 0 && (
    <Fold title={t('owed.settledTitle', { n: owed.settled.length })}>
      <ul className="owed-items">
        {owed.settled.map((i) => (
          <li key={i.key}>
            <span>
              {i.finding
                ? t(`agr.rule.${i.finding.rule === 'minimum' ? `minimum.${i.finding.cause}` : i.finding.rule}` as 'agr.rule.ob', {
                    level: i.finding.level ?? '',
                  })
                : t('owed.cmpItem')}
            </span>{' '}
            <span className="muted">
              {monthRanges(i.months, fmt)} · {fmt.money(i.amount)}
            </span>{' '}
            {settleButton(i, false)}
          </li>
        ))}
      </ul>
    </Fold>
  );
  if (!something) return <>{settledList}</>;
  return (
    <Card title={t('owed.title')} className="owed-card">
      {owed.likely.length > 0 && (
        <section className="owed-part">
          <h3>{t('owed.likely')}</h3>
          <p className="owed-amount">≈ {amounts(owed.likelyTotal, owed.likelyNet)}</p>
          <p className="small muted">{t('owed.likelyWhy')}</p>
          <ul className="findings">
            {owed.likely.map((i) => (
              <FindingItem key={i.key} f={i.finding!} settings={settings} t={t} fmt={fmt}>
                {settleButton(i, true)}
              </FindingItem>
            ))}
          </ul>
        </section>
      )}
      {owed.investigate.length > 0 && (
        <section className="owed-part">
          <h3>{t('owed.investigate')}</h3>
          <p className="owed-amount">≈ {amounts(owed.investigateTotal, owed.investigateNet)}</p>
          <p className="small muted">{t('owed.investigateWhy')}</p>
          <ul className="owed-items">
            {owed.investigate.map((i) => (
              <li key={i.key}>
                <a
                  href={href({
                    name: 'slip',
                    id: owed.ids.get(i.months[0]) ?? '',
                  })}
                >
                  {fmt.month(i.months[0])}
                </a>
                : {t('owed.cmpLess', { amount: fmt.money(i.amount) })} {settleButton(i, true)}
              </li>
            ))}
          </ul>
        </section>
      )}
      {owed.old > 0 && <p className="small warn-text">{t('owed.old', { amount: fmt.money(owed.old) })}</p>}
      <p className="small">{t('owed.vacation')}</p>
      <p className="small muted">{t('owed.disclaimer')}</p>
      {settledList}
    </Card>
  );
}

/** One line on the days page, only when there is something. */
export function OwedLine() {
  const { t, fmt } = useApp();
  const owed = useOwed();
  if (!owed || (!owed.likely.length && !owed.investigate.length)) return null;
  return (
    <p className="small owed-line">
      <a href={href({ name: 'slips' })}>
        {owed.likely.length > 0
          ? t('owed.line', { amount: fmt.money(owed.likelyTotal) })
          : t('owed.lineInvestigate', {
              amount: fmt.money(owed.investigateTotal),
            })}
      </a>
    </p>
  );
}
