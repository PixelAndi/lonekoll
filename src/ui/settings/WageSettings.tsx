import { useApp } from '../../app-context.ts';
import { saveSettings } from '../../db.ts';
import { AGREEMENT_PERIODS } from '../../domain/agreement.ts';
import { minimumWageOn, type Settings, type WagePeriod } from '../../domain/model.ts';
import { addDays, todayLocal, type LocalDate } from '../../domain/time.ts';
import { Card, Field } from '../common.tsx';
import { decimalText, LazyInput, numberOrUndefined } from './inputs.tsx';

interface WageStep {
  from: LocalDate;
  minimum: number;
  known: boolean;
}

/** When a minimum-based wage changes, from `from` to the day before `until` (or just past the last known agreement). */
function minimumSteps(settings: Settings, from: LocalDate, until: LocalDate | undefined): WageStep[] {
  const last = addDays(AGREEMENT_PERIODS[AGREEMENT_PERIODS.length - 1].to, 1);
  const first = AGREEMENT_PERIODS[0].from;
  const end = until && until <= last ? addDays(until, -1) : last;
  const steps: WageStep[] = [];
  for (let date = from > first ? from : first; date <= end; date = addDays(date, 1)) {
    const m = minimumWageOn(settings, date);
    const prev = steps[steps.length - 1];
    if (m && (!prev || prev.minimum !== m.minimum || prev.known !== m.known)) steps.push({ from: date, minimum: m.minimum, known: m.known });
  }
  return steps;
}

export function WageSettings() {
  const { t, fmt, settings, lang } = useApp();
  const setWages = (wages: WagePeriod[]) => void saveSettings({ wages: [...wages].sort((a, b) => a.from.localeCompare(b.from)) });
  const patch = (i: number, p: Partial<WagePeriod>) => setWages(settings.wages.map((w, j) => (j === i ? { ...w, ...p } : w)));
  const anyMinimum = settings.wages.some((w) => w.basis === 'minimum');
  return (
    <Card title={t('settings.wages')}>
      <p className="muted small">{t('settings.wagesHint')}</p>
      {settings.wages.map((w, i) => {
        const minimum = w.basis === 'minimum';
        const supplement = w.supplement ?? 0;
        return (
          <div className="wage-period" key={`${w.from}-${i}`}>
            <div className="wage-row">
              <Field label={t('settings.wageFrom')}>
                <input type="date" value={w.from} onChange={(e) => e.target.value && patch(i, { from: e.target.value })} />
              </Field>
              <button type="button" className="icon-button" aria-label={t('common.delete')} onClick={() => setWages(settings.wages.filter((_, j) => j !== i))}>
                ×
              </button>
            </div>
            <Field label={t('settings.wageBasis')}>
              <select value={w.basis ?? 'fixed'} onChange={(e) => patch(i, { basis: e.target.value as WagePeriod['basis'] })}>
                <option value="fixed">{t('wageBasis.fixed')}</option>
                <option value="minimum">{t('wageBasis.minimum')}</option>
              </select>
            </Field>
            <div className="field-row">
              {!minimum && (
                <Field label={t('settings.wageHourly')}>
                  <LazyInput
                    type="text"
                    inputMode="decimal"
                    value={decimalText(w.hourly, lang)}
                    onCommit={(v) => {
                      const n = numberOrUndefined(v);
                      if (n !== undefined) patch(i, { hourly: n });
                    }}
                  />
                </Field>
              )}
              <Field label={t(minimum ? 'settings.wageAbove' : 'settings.wageSupplement')}>
                <LazyInput
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  value={decimalText(w.supplement || undefined, lang)}
                  onCommit={(v) => patch(i, { supplement: numberOrUndefined(v) })}
                />
              </Field>
            </div>
            {minimum && (
              <ul className="wage-steps muted small">
                {minimumSteps(settings, w.from, settings.wages[i + 1]?.from).map((s) => {
                  const values = {
                    date: fmt.date(s.from, 'numeric'),
                    hourly: fmt.number(s.minimum + supplement),
                    minimum: fmt.number(s.minimum),
                    supplement: fmt.number(supplement),
                  };
                  return <li key={s.from}>{t(s.known ? 'settings.wageStep' : 'settings.wageStepUnknown', values)}</li>;
                })}
              </ul>
            )}
          </div>
        );
      })}
      {anyMinimum && !settings.employedSince && <p className="note">{t('settings.wageNeedsEmployedSince')}</p>}
      <button
        type="button"
        className="button button-small"
        onClick={() => {
          const last = settings.wages.at(-1);
          setWages([...settings.wages, { from: todayLocal(), basis: last?.basis, hourly: last?.hourly ?? 0, supplement: last?.supplement }]);
        }}
      >
        + {t('settings.addWage')}
      </button>
    </Card>
  );
}
