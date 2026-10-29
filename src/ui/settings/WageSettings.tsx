import { useApp } from '../../app-context.ts';
import { saveSettings } from '../../db.ts';
import type { WagePeriod } from '../../domain/model.ts';
import { todayLocal } from '../../domain/time.ts';
import { Card, Field } from '../common.tsx';
import { decimalText, LazyInput, numberOrUndefined } from './inputs.tsx';

export function WageSettings() {
  const { t, settings, lang } = useApp();
  const setWages = (wages: WagePeriod[]) => void saveSettings({ wages: [...wages].sort((a, b) => a.from.localeCompare(b.from)) });
  const patch = (i: number, p: Partial<WagePeriod>) => setWages(settings.wages.map((w, j) => (j === i ? { ...w, ...p } : w)));
  return (
    <Card title={t('settings.wages')}>
      <p className="muted small">{t('settings.wagesHint')}</p>
      {settings.wages.map((w, i) => (
        <div className="wage-row" key={`${w.from}-${i}`}>
          <Field label={t('settings.wageFrom')}>
            <input type="date" value={w.from} onChange={(e) => e.target.value && patch(i, { from: e.target.value })} />
          </Field>
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
          <Field label={t('settings.wageSupplement')}>
            <LazyInput
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={decimalText(w.supplement || undefined, lang)}
              onCommit={(v) => patch(i, { supplement: numberOrUndefined(v) })}
            />
          </Field>
          <button type="button" className="icon-button" aria-label={t('common.delete')} onClick={() => setWages(settings.wages.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="button button-small"
        onClick={() => {
          const last = settings.wages.at(-1);
          setWages([...settings.wages, { from: todayLocal(), hourly: last?.hourly ?? 0, supplement: last?.supplement }]);
        }}
      >
        + {t('settings.addWage')}
      </button>
    </Card>
  );
}
