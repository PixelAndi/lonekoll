import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app-context.ts';
import { deleteEverything, downloadBlob, exportBackup, importBackup } from '../backup.ts';
import { isPersisted, requestPersistence, saveSettings } from '../db.ts';
import type { Settings } from '../domain/model.ts';
import { formatDuration, todayLocal, toMinutes } from '../domain/time.ts';
import { LANGUAGE_NAMES } from '../i18n.ts';
import { Card, Field, Notice, Page } from './common.tsx';
import { decimalText, LazyInput, numberOrUndefined } from './settings/inputs.tsx';
import { TimeField } from './StampRowsEditor.tsx';
import { ScheduleSettings } from './settings/ScheduleSettings.tsx';
import { SupplementSettings } from './settings/SupplementSettings.tsx';
import { TaxSettings } from './settings/TaxSettings.tsx';
import { WageSettings } from './settings/WageSettings.tsx';

export function SettingsView() {
  const { t, settings } = useApp();
  const save = (patch: Partial<Settings>) => void saveSettings(patch);
  const importInput = useRef<HTMLInputElement>(null);
  const [persisted, setPersisted] = useState<boolean>();
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string }>();

  useEffect(() => {
    void isPersisted().then(setPersisted);
  }, []);

  const onImport = async (file: File | undefined) => {
    if (importInput.current) importInput.current.value = '';
    if (!file || !confirm(t('settings.importConfirm'))) return;
    try {
      await importBackup(file);
      setMessage({ kind: 'ok', text: t('settings.imported') });
    } catch (e) {
      setMessage({ kind: 'error', text: t('settings.importFailed', { error: e instanceof Error ? e.message : String(e) }) });
    }
  };

  const onDeleteAll = async () => {
    if (!confirm(t('settings.deleteAllConfirm'))) return;
    await deleteEverything();
    location.hash = '#/days';
  };

  return (
    <Page title={t('nav.settings')}>
      <WageSettings />
      <ScheduleSettings />
      <SupplementSettings />
      <TaxSettings />

      <Card title={t('settings.you')}>
        <Field label={t('settings.language')}>
          <select value={settings.language} onChange={(e) => save({ language: e.target.value as Settings['language'] })}>
            {Object.entries(LANGUAGE_NAMES).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('settings.name')}>
          <LazyInput type="text" autoComplete="name" value={settings.name} onCommit={(v) => save({ name: v.trim() })} />
        </Field>
        <Field label={t('settings.employer')}>
          <LazyInput type="text" value={settings.employer} onCommit={(v) => save({ employer: v.trim() })} />
        </Field>
        <div className="field-row">
          <Field label={t('settings.employedSince')}>
            <input type="date" value={settings.employedSince ?? ''} onChange={(e) => save({ employedSince: e.target.value || undefined })} />
          </Field>
          <Field label={t('settings.birthDate')}>
            <input type="date" value={settings.birthDate ?? ''} onChange={(e) => save({ birthDate: e.target.value || undefined })} />
          </Field>
        </div>
        <div className="field-row">
          <Field label={t('settings.trainee')}>
            <select value={settings.traineeYear} onChange={(e) => save({ traineeYear: Number(e.target.value) as Settings['traineeYear'] })}>
              {[0, 1, 2, 3].map((y) => (
                <option key={y} value={y}>
                  {t(`trainee.${y}` as 'trainee.0')}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('settings.employmentPercent')}>
            <LazyInput
              type="number"
              min="1"
              max="100"
              value={String(settings.employmentPercent)}
              onCommit={(v) => {
                const n = numberOrUndefined(v);
                if (n !== undefined && n > 0 && n <= 100) save({ employmentPercent: n });
              }}
            />
          </Field>
        </div>
      </Card>

      <Card title={t('settings.rules')}>
        {/* With a schedule, overtime follows the schedule instead of these limits. */}
        {settings.scheduleMode !== 'fixed' && (
          <div className="field-row">
            <Field label={t('settings.ordinaryShift')} hint={t('settings.ordinaryShiftHint')}>
              <LazyInput
                type="text"
                inputMode="numeric"
                pattern="\d{1,2}:\d{2}"
                value={formatDuration(settings.ordinaryShiftMinutes)}
                onCommit={(v) => /^\d{1,2}:\d{2}$/.test(v) && save({ ordinaryShiftMinutes: toMinutes(v) })}
              />
            </Field>
            <Field label={t('settings.maxShifts')}>
              <LazyInput
                type="number"
                min="0"
                max="7"
                value={String(settings.maxShiftsPerWeek)}
                onCommit={(v) => {
                  const n = numberOrUndefined(v);
                  if (n !== undefined && n >= 0) save({ maxShiftsPerWeek: Math.round(n) });
                }}
              />
            </Field>
          </div>
        )}
        <div className="field">
          <TimeField label={t('settings.ordinaryStart')} value={settings.ordinaryStart} onChange={(v) => v && save({ ordinaryStart: v })} />
          <span className="field-hint">{t('settings.ordinaryStartHint')}</span>
        </div>
        <Field label={t('settings.timeBankRate')} hint={t('settings.timeBankHint')}>
          <LazyInput
            type="text"
            inputMode="decimal"
            value={decimalText(settings.timeBankRate, settings.language)}
            onCommit={(v) => save({ timeBankRate: numberOrUndefined(v) })}
          />
        </Field>
        <Field label={t('settings.localDeals')}>
          <LazyInput type="text" placeholder={t('settings.localDealsPlaceholder')} value={settings.localDeals} onCommit={(v) => save({ localDeals: v.trim() })} />
        </Field>
      </Card>

      <Card title={t('settings.data')}>
        <p className="muted small">{t('settings.exportHint')}</p>
        {persisted !== undefined && <Notice kind={persisted ? 'ok' : 'warn'}>{t(persisted ? 'settings.persisted' : 'settings.notPersisted')}</Notice>}
        {message && <Notice kind={message.kind}>{message.text}</Notice>}
        <div className="button-row">
          <button
            type="button"
            className="button button-primary"
            onClick={async () => {
              downloadBlob(await exportBackup(), `lonekoll-${todayLocal()}.zip`);
              setPersisted(await requestPersistence());
            }}
          >
            {t('settings.export')}
          </button>
          <button type="button" className="button" onClick={() => importInput.current?.click()}>
            {t('settings.import')}
          </button>
          <input ref={importInput} type="file" accept=".zip,application/zip" hidden onChange={(e) => onImport(e.target.files?.[0])} />
        </div>
        <button type="button" className="button button-danger button-small" onClick={onDeleteAll}>
          {t('settings.deleteAll')}
        </button>
      </Card>

      <Card title={t('settings.about')}>
        <p>{t('settings.aboutText')}</p>
        <p className="muted small">{t('settings.notCovered')}</p>
        <p className="muted small">{t('settings.source')}</p>
        <p className="muted small">{t('privacy.short')}</p>
        <p className="muted small">Version {__APP_VERSION__}</p>
      </Card>
    </Page>
  );
}
