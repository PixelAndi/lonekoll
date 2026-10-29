import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { useApp } from '../app-context.ts';
import { deleteEverything, downloadBlob, exportBackup, importBackup } from '../backup.ts';
import { isPersisted, requestPersistence, saveSettings } from '../db.ts';
import type { Settings, WagePeriod } from '../domain/model.ts';
import { formatDuration, todayLocal, toMinutes } from '../domain/time.ts';
import { Card, Field, Notice, Page } from './common.tsx';

/** Text/number input that saves when it loses focus (not on every keystroke). */
function LazyInput({ value, onCommit, ...rest }: { value: string; onCommit: (v: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <input {...rest} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== value && onCommit(draft)} />;
}

const numberOrUndefined = (v: string) => {
  const n = Number(v.replace(',', '.'));
  return v.trim() === '' || !Number.isFinite(n) ? undefined : n;
};

export function SettingsView() {
  const { t, settings } = useApp();
  const save = (patch: Partial<Settings>) => void saveSettings(patch);
  const importInput = useRef<HTMLInputElement>(null);
  const [persisted, setPersisted] = useState<boolean>();
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string }>();

  useEffect(() => {
    void isPersisted().then(setPersisted);
  }, []);

  const setWages = (wages: WagePeriod[]) => save({ wages: [...wages].sort((a, b) => a.from.localeCompare(b.from)) });

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
      <Card title={t('settings.wages')}>
        <p className="muted small">{t('settings.wagesHint')}</p>
        {settings.wages.map((w, i) => (
          <div className="field-row" key={`${w.from}-${i}`}>
            <Field label={t('settings.wageFrom')}>
              <input
                type="date"
                value={w.from}
                onChange={(e) => e.target.value && setWages(settings.wages.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))}
              />
            </Field>
            <Field label={t('settings.wageHourly')}>
              <LazyInput
                type="text"
                inputMode="decimal"
                value={String(w.hourly).replace('.', settings.language === 'sv' ? ',' : '.')}
                onCommit={(v) => {
                  const n = numberOrUndefined(v);
                  if (n !== undefined) setWages(settings.wages.map((x, j) => (j === i ? { ...x, hourly: n } : x)));
                }}
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
          onClick={() => setWages([...settings.wages, { from: todayLocal(), hourly: settings.wages.at(-1)?.hourly ?? 0 }])}
        >
          + {t('settings.addWage')}
        </button>
      </Card>

      <Card title={t('settings.you')}>
        <Field label={t('settings.language')}>
          <select value={settings.language} onChange={(e) => save({ language: e.target.value as Settings['language'] })}>
            <option value="sv">Svenska</option>
            <option value="en">English</option>
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
        <Field label={t('settings.ordinaryStart')} hint={t('settings.ordinaryStartHint')}>
          <input type="time" value={settings.ordinaryStart} onChange={(e) => e.target.value && save({ ordinaryStart: e.target.value })} />
        </Field>
        <Field label={t('settings.timeBankRate')} hint={t('settings.timeBankHint')}>
          <LazyInput
            type="text"
            inputMode="decimal"
            value={settings.timeBankRate !== undefined ? String(settings.timeBankRate).replace('.', settings.language === 'sv' ? ',' : '.') : ''}
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
