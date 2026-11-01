import { useMemo } from 'react';
import { useApp } from '../app-context.ts';
import { saveSettings } from '../db.ts';
import { monthlyPayOn } from '../domain/model.ts';
import { nightWork } from '../domain/night.ts';
import { todayLocal } from '../domain/time.ts';
import { href } from '../router.ts';
import { Card } from './common.tsx';

// Permanent night work found in the stamps, asked about once: the agreement
// gives it a 38-hour week, paid as skiftformstillägg 5.3 % per hour on an
// hourly wage (a monthly salary stays whole). Yes switches the supplement on
// from the first night of the stretch; no is remembered.

export function NightWorkQuestion() {
  const { t, fmt, days, settings } = useApp();
  const asking = settings.shiftForm === 'none' && !settings.nightAsked;
  const found = useMemo(() => (asking ? nightWork(days) : null), [asking, days]);
  if (!found) return null;
  const monthly = monthlyPayOn(settings, todayLocal()) !== null;
  const values = { from: fmt.date(found.from, 'inText'), nights: found.nights, shifts: found.shifts };
  return (
    <Card title={t('night.title')} className="card-highlight">
      <p>{t('night.found', values)}</p>
      <p className="small">{t(monthly ? 'night.monthly' : 'night.hourly')}</p>
      <p className="small">
        <a href={href({ name: 'help', section: 'night' })}>{t('night.more')}</a>
      </p>
      {monthly ? (
        <div className="button-column">
          <button type="button" className="button" onClick={() => void saveSettings({ nightAsked: true })}>
            {t('night.ok')}
          </button>
        </div>
      ) : (
        <div className="button-column">
          <button type="button" className="button button-primary" onClick={() => void saveSettings({ shiftForm: 'two-shift', shiftFormFrom: found.from, nightAsked: true })}>
            {t('night.yes', values)}
          </button>
          <button type="button" className="button" onClick={() => void saveSettings({ nightAsked: true })}>
            {t('night.no')}
          </button>
        </div>
      )}
    </Card>
  );
}
