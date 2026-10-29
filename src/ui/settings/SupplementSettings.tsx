import { useApp } from '../../app-context.ts';
import { saveSettings } from '../../db.ts';
import type { ShiftForm, Supplements } from '../../domain/model.ts';
import { Card, Field } from '../common.tsx';
import { LazyInput, numberOrUndefined } from './inputs.tsx';

const KEYS: (keyof Supplements)[] = ['ob', 'overtime', 'shiftedTime', 'holidayPay'];

export function SupplementSettings() {
  const { t, settings } = useApp();
  const toggle = (key: keyof Supplements, on: boolean) => void saveSettings({ supplements: { ...settings.supplements, [key]: on } });
  return (
    <Card title={t('settings.supplements')}>
      <p className="muted small">{t('settings.supplementsHint')}</p>
      {KEYS.map((key) => (
        <label key={key} className="checkbox">
          <input
            type="checkbox"
            checked={settings.supplements[key]}
            disabled={key === 'shiftedTime' && settings.scheduleMode !== 'fixed'}
            onChange={(e) => toggle(key, e.target.checked)}
          />
          {t(`settings.supp.${key}`)}
        </label>
      ))}
      <Field label={t('settings.shiftForm')}>
        <select value={settings.shiftForm} onChange={(e) => void saveSettings({ shiftForm: e.target.value as ShiftForm })}>
          {(['none', 'two-shift', 'continuous'] as const).map((f) => (
            <option key={f} value={f}>
              {t(`shiftForm.${f}`)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('settings.minOvertime')} hint={t('settings.minOvertimeHint')}>
        <LazyInput
          type="number"
          min="0"
          max="120"
          inputMode="numeric"
          value={String(settings.minOvertimeMinutes)}
          onCommit={(v) => void saveSettings({ minOvertimeMinutes: Math.max(0, Math.round(numberOrUndefined(v) ?? 0)) })}
        />
      </Field>
    </Card>
  );
}
