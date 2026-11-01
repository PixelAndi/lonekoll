import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { useApp } from '../app-context.ts';
import { db, saveSettings, type SlipRecord } from '../db.ts';
import { checkAgainstAgreement } from '../domain/agreementCheck.ts';
import { periodBasis } from '../domain/basis.ts';
import { calculatePeriod } from '../domain/calc.ts';
import { comparePeriod } from '../domain/compare.ts';
import { owedEstimate, rejectionKey, type Correction, type MonthComparison, type Owed, type OwedItem, type Resolution } from '../domain/owed.ts';
import { todayLocal } from '../domain/time.ts';
import { stepsNotInSettings, wageHistory, wagePatterns } from '../domain/wageHistory.ts';
import { href } from '../router.ts';
import { FindingItem, monthRanges } from './AgreementFindings.tsx';
import type { Settings } from '../domain/model.ts';
import { needsCheck } from './SlipCheck.tsx';
import { applyOverrides, slipPeriod, vacationBasisFor } from './slipComparison.ts';

// A rough estimate of what may be owed, on the Ärenden page: what the slips
// pay below the agreement, and apart from it, months where the slip pays less
// than the log adds up to. Each item can be linked to a later line that put
// it right (suggested by the app), marked as settled, or said to be no error
// (the app got it wrong) – and each answer can be undone.

export type OwedWithIds = Owed & { ids: Map<string, string> };

export function useOwedComputed(): OwedWithIds | null {
  const { days, settings } = useApp();
  const records = useLiveQuery(() => db.slips.toArray(), []);
  return useMemo(() => {
    if (!records?.length) return null;
    try {
      return compute(records);
    } catch {
      // A slip the estimate can't make sense of must not take the app down with it.
      return null;
    }
  }, [records, days, settings]);

  function compute(records: SlipRecord[]): OwedWithIds {
    const today = todayLocal();
    const slips = records.map((r) => applyOverrides(r.slip, settings.codeOverrides));
    const findings = checkAgainstAgreement(slips, settings);
    // Months where the settings' wage isn't the one the slips pay: the comparison would measure the settings.
    const steps = wageHistory(slips, settings);
    // A wage the user says the slips have wrong (the settings hold the deal) is compared all the same.
    const disputed = wagePatterns(steps, settings).filter((p) => settings.wageAnswers?.[p.key] === 'disputed');
    const offSteps = stepsNotInSettings(steps, settings).filter((s) => !disputed.some((p) => p.steps.includes(s)));
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
      ...owedEstimate(
        findings,
        comparisons,
        slips,
        { resolutions: settings.owedResolutions ?? {}, rejected: settings.rejectedCorrections ?? [], settled: settings.settledOwed },
        today,
      ),
      ids,
    };
  }
}


/** Saves what the user said about an item (none: undone, asked again). */
export function resolveItem(settings: Settings, key: string, r: Resolution | undefined) {
  const resolutions = { ...settings.owedResolutions };
  if (r) resolutions[key] = r;
  else delete resolutions[key];
  void saveSettings({ owedResolutions: resolutions, settledOwed: (settings.settledOwed ?? []).filter((k) => k !== key) });
}

const rejectSuggestion = (settings: Settings, key: string, c: Correction) =>
  void saveSettings({ rejectedCorrections: [...(settings.rejectedCorrections ?? []), rejectionKey(key, c)] });

/** The items still open, in two parts, with their totals; each with what can be done about it. */
export function OwedSection({ owed }: { owed: OwedWithIds }) {
  const { t, fmt } = useApp();
  const amounts = (gross: number, net: number | null) => (net === null ? t('owed.gross', { gross: fmt.money(gross) }) : t('owed.grossNet', { gross: fmt.money(gross), net: fmt.money(net) }));
  return (
    <>
      {owed.likely.length > 0 && (
        <section className="owed-part">
          <h3>{t('owed.likely')}</h3>
          <p className="owed-amount">≈ {amounts(owed.likelyTotal, owed.likelyNet)}</p>
          <p className="small muted">{t('owed.likelyWhy')}</p>
          <ul className="findings">
            {owed.likely.map((i) => (
              <OwedItemView key={i.key} item={i} ids={owed.ids} />
            ))}
          </ul>
        </section>
      )}
      {owed.investigate.length > 0 && (
        <section className="owed-part">
          <h3>{t('owed.investigate')}</h3>
          <p className="owed-amount">≈ {amounts(owed.investigateTotal, owed.investigateNet)}</p>
          <p className="small muted">{t('owed.investigateWhy')}</p>
          <ul className="findings">
            {owed.investigate.map((i) => (
              <OwedItemView key={i.key} item={i} ids={owed.ids} />
            ))}
          </ul>
        </section>
      )}
      {owed.old > 0 && <p className="small warn-text">{t('owed.old', { amount: fmt.money(owed.old) })}</p>}
      <ArchiveOld owed={owed} />
      <p className="small">{t('owed.vacation')}</p>
      <p className="small muted">{t('owed.disclaimer')}</p>
    </>
  );
}

/** One item: what it is, the lines that may have put it right (yes / no), and settled / no error. */
function OwedItemView({ item: i, ids }: { item: OwedItem; ids: Map<string, string> }) {
  const { t, fmt, settings } = useApp();
  const today = todayLocal();
  const rejected = (settings.rejectedCorrections ?? []).filter((k) => k.startsWith(`${i.key}>`));
  const body = (
    <>
      {i.covered > 0 && i.resolution?.kind === 'linked' && (
        <p className="small ok">
          {t('owed.partly', { text: i.resolution.line.text, covered: fmt.money(i.covered), month: fmt.month(i.resolution.line.month), left: fmt.money(i.amount) })}{' '}
          <button type="button" className="owed-settle" onClick={() => resolveItem(settings, i.key, undefined)}>
            {t('owed.unsettle')}
          </button>
        </p>
      )}
      {i.suggestions.map((c) => (
        <div key={`${c.month}${c.text}${c.amount}`} className="owed-suggestion">
          <p className="small">{t('owed.maybe', { text: c.text, amount: fmt.money(c.amount), month: fmt.month(c.month) })}</p>
          <div className="button-row">
            <button type="button" className="button button-small button-primary" onClick={() => resolveItem(settings, i.key, { kind: 'linked', date: today, line: c })}>
              {t('owed.link')}
            </button>
            <button type="button" className="button button-small" onClick={() => rejectSuggestion(settings, i.key, c)}>
              {t('owed.notIt')}
            </button>
          </div>
        </div>
      ))}
      <div className="button-row owed-actions">
        <button type="button" className="button button-small" onClick={() => resolveItem(settings, i.key, { kind: 'settled', date: today })}>
          {t('owed.settle')}
        </button>
        <button type="button" className="button button-small" onClick={() => resolveItem(settings, i.key, { kind: 'notError', date: today })}>
          {t('owed.notError')}
        </button>
        <button type="button" className="button button-small" onClick={() => resolveItem(settings, i.key, { kind: 'archived', date: today })}>
          {t('owed.archive')}
        </button>
      </div>
      {allOld(i) && <p className="small muted">{t('owed.allOld')}</p>}
      {rejected.length > 0 && (
        <button type="button" className="owed-settle small" onClick={() => void saveSettings({ rejectedCorrections: (settings.rejectedCorrections ?? []).filter((k) => !rejected.includes(k)) })}>
          {t('owed.showRejected', { n: rejected.length })}
        </button>
      )}
    </>
  );
  if (i.finding)
    return (
      <FindingItem f={{ ...i.finding, corrections: undefined }} settings={settings} t={t} fmt={fmt}>
        {body}
      </FindingItem>
    );
  return (
    <li className="finding">
      <strong>
        <a href={href({ name: 'slip', id: ids.get(i.months[0]) ?? '' })}>{fmt.month(i.months[0])}</a>
      </strong>
      <p>{t('owed.cmpLess', { amount: fmt.money(i.whole) })}</p>
      {body}
    </li>
  );
}

/** What has been answered: how each item was put right (or that it was none), with the way to undo it. */
export function SettledList({ owed, archived = false }: { owed: Owed; archived?: boolean }) {
  const { t, fmt, settings } = useApp();
  const list = archived ? owed.archived : owed.settled;
  if (!list.length) return null;
  const title = (i: OwedItem) =>
    i.finding
      ? t(`agr.rule.${i.finding.rule === 'minimum' ? `minimum.${i.finding.cause}` : i.finding.rule}` as 'agr.rule.ob', { level: i.finding.level ?? '' })
      : t('owed.cmpItem');
  const how = (i: OwedItem) => {
    const r = i.resolution!;
    if (r.kind === 'linked') return t('owed.how.linked', { text: r.line.text, amount: fmt.money(r.line.amount), month: fmt.month(r.line.month) });
    return t(r.kind === 'notError' ? 'owed.how.notError' : r.kind === 'archived' ? 'owed.how.archived' : 'owed.how.settled', { date: fmt.date(r.date, 'numeric') });
  };
  return (
    <ul className="owed-items">
      {list.map((i) => (
        <li key={i.key}>
          <strong>{title(i)}</strong> <span className="muted">· {monthRanges(i.months, fmt)} · {fmt.money(i.whole)}</span>
          <br />
          <span className="small">{how(i)}</span>{' '}
          <button type="button" className="owed-settle small" onClick={() => resolveItem(settings, i.key, undefined)}>
            {archived ? t('owed.restore') : t('owed.unsettle')}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Everything of an item was paid out more than two years ago. */
const allOld = (i: OwedItem) => i.amount > 0 && i.old >= i.amount - 0.5;

/** Items paid out more than two years ago, put away with one tap (each can be brought back). */
function ArchiveOld({ owed }: { owed: Owed }) {
  const { t, settings } = useApp();
  const old = [...owed.likely, ...owed.investigate].filter(allOld);
  if (!old.length) return null;
  const archive = () => {
    if (!window.confirm(t('owed.archiveOldConfirm', { n: old.length }))) return;
    const date = todayLocal();
    const resolutions = { ...settings.owedResolutions };
    for (const i of old) resolutions[i.key] = { kind: 'archived', date };
    void saveSettings({ owedResolutions: resolutions });
  };
  return (
    <button type="button" className="button button-small" onClick={archive}>
      {t('owed.archiveOld', { n: old.length })}
    </button>
  );
}
