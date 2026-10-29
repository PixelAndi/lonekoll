import { useApp } from '../../app-context.ts';
import { saveSettings } from '../../db.ts';
import type { TaxSettings as Tax } from '../../domain/model.ts';
import { taxBasis } from '../../domain/tax.ts';
import { todayLocal } from '../../domain/time.ts';
import { RATE_YEARS, useTaxData } from '../../taxData.ts';
import { Card, Field, Notice } from '../common.tsx';
import { decimalText, LazyInput, numberOrUndefined } from './inputs.tsx';

export function TaxSettings() {
  const { t, fmt, settings, lang } = useApp();
  const tax = settings.tax;
  const year = Number(todayLocal().slice(0, 4));
  // Municipal rates for this year, or the newest year bundled.
  const ratesYear = RATE_YEARS.includes(year) ? year : (RATE_YEARS[0] ?? year);
  const { rates } = useTaxData(ratesYear);
  const save = (patch: Partial<Tax>) => void saveSettings({ tax: { ...tax, ...patch } });
  const municipality = rates?.municipalities.find((m) => m.name === tax.municipality);
  const basis = taxBasis(tax, rates);

  return (
    <Card title={t('settings.tax')}>
      <Field label={t('settings.taxMode')}>
        <select value={tax.mode} onChange={(e) => save({ mode: e.target.value as Tax['mode'] })}>
          {(['municipality', 'table', 'percent'] as const).map((m) => (
            <option key={m} value={m}>
              {t(`taxMode.${m}`)}
            </option>
          ))}
        </select>
      </Field>
      {tax.mode === 'municipality' && (
        <>
          <Field label={t('settings.municipality')}>
            <select value={tax.municipality ?? ''} onChange={(e) => save({ municipality: e.target.value || undefined, parish: undefined })}>
              <option value="">{t('settings.chooseMunicipality')}</option>
              {rates?.municipalities.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <label className="checkbox">
            <input type="checkbox" checked={tax.churchMember} onChange={(e) => save({ churchMember: e.target.checked })} />
            {t('settings.churchMember')}
          </label>
          {tax.churchMember && municipality && municipality.parishes.length > 1 && (
            <Field label={t('settings.parish')}>
              <select value={tax.parish ?? ''} onChange={(e) => save({ parish: e.target.value || undefined })}>
                <option value="">{t('settings.parishUnknown')}</option>
                {municipality.parishes.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name} ({fmt.number(p.fee)} %)
                  </option>
                ))}
              </select>
            </Field>
          )}
        </>
      )}
      {tax.mode === 'table' && (
        <Field label={t('settings.taxTable')}>
          <LazyInput
            type="number"
            min="29"
            max="42"
            inputMode="numeric"
            value={tax.table ? String(tax.table) : ''}
            onCommit={(v) => save({ table: numberOrUndefined(v) })}
          />
        </Field>
      )}
      {tax.mode === 'percent' && (
        <Field label={t('settings.taxPercent')}>
          <LazyInput type="text" inputMode="decimal" value={decimalText(tax.percent, lang)} onCommit={(v) => save({ percent: numberOrUndefined(v) })} />
        </Field>
      )}
      {basis.kind === 'table' && basis.rate !== undefined && (
        <Notice kind="ok">{t('settings.taxResult', { rate: fmt.number(basis.rate, 3), table: basis.table, year: ratesYear })}</Notice>
      )}
      {!RATE_YEARS.includes(year) && <p className="muted small">{t('settings.taxNoData', { year })}</p>}
      <p className="muted small">{t('settings.taxHint')}</p>
    </Card>
  );
}
