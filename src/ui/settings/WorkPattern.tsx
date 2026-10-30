import { useMemo } from 'react';
import { useApp } from '../../app-context.ts';
import { saveSettings } from '../../db.ts';
import { suggestWorkPattern } from '../../domain/pattern.ts';
import { formatDuration, todayLocal, weekStart } from '../../domain/time.ts';

const range = (from: string, to: string) => (from === to ? from : `${from}–${to}`);
import { Card } from '../common.tsx';

// Suggests a schedule, or the rules without one, from the weeks the user has
// stamped: which weekdays they work and when they start. The end is left to
// the ordinary shift length, since it follows the production.

export function WorkPattern() {
  const { t, settings, days } = useApp();
  const pattern = useMemo(() => suggestWorkPattern(days, settings, todayLocal()), [days, settings]);

  if (!pattern) {
    return (
      <Card title={t('pattern.title')}>
        <p className="muted small">{t('pattern.needMore')}</p>
      </Card>
    );
  }

  const minutes = settings.ordinaryShiftMinutes;
  const length = minutes % 60 ? formatDuration(minutes) : String(minutes / 60);
  const asSchedule = { startMonday: weekStart(todayLocal()), weeks: [pattern.week] };
  const scheduleApplied =
    settings.scheduleMode === 'fixed' && settings.schedule.weeks.length === 1 && JSON.stringify(settings.schedule.weeks[0]) === JSON.stringify(pattern.week);
  const rulesApplied =
    settings.scheduleMode === 'none' && settings.ordinaryStart === pattern.ordinaryStart && settings.maxShiftsPerWeek === pattern.days.length;

  const useSchedule = () => {
    if (settings.scheduleMode === 'fixed' && !confirm(t('pattern.replaceSchedule'))) return;
    void saveSettings({ scheduleMode: 'fixed', schedule: asSchedule, ordinaryStart: pattern.ordinaryStart });
  };
  const useRules = () => void saveSettings({ scheduleMode: 'none', ordinaryStart: pattern.ordinaryStart, maxShiftsPerWeek: pattern.days.length });

  return (
    <Card title={t('pattern.title')}>
      <p className="muted small">{t('pattern.from', { shifts: pattern.shifts, weeks: pattern.weeks })}</p>
      <ul className="pattern-days">
        {pattern.days.map((d) => (
          <li key={d.weekday}>
            <strong>{t(`weekday.${d.weekday as 1 | 2 | 3 | 4 | 5 | 6 | 7}`)}</strong>{' '}
            {t('pattern.day', { start: d.start, stamped: range(d.startFrom, d.startTo), ends: range(d.endFrom, d.endTo) })}
            {d.breakMinutes > 0 && ` · ${t('pattern.break', { minutes: d.breakMinutes })}`}
          </li>
        ))}
      </ul>
      {pattern.endsVary && <p className="small">{t('pattern.endsVary', { length })}</p>}
      {!pattern.steadyStart && <p className="small">{t('pattern.startVaries')}</p>}

      {pattern.steadyStart && (
        <div className="pattern-option">
          <p className="small">{t('pattern.scheduleExplain', { length, n: pattern.days.length })}</p>
          {scheduleApplied ? (
            <p className="small ok">{t('pattern.applied')}</p>
          ) : (
            <button type="button" className="button button-primary button-small" onClick={useSchedule}>
              {t('pattern.useSchedule')}
            </button>
          )}
        </div>
      )}
      <div className="pattern-option">
        <p className="small">{t('pattern.rulesExplain', { length, next: pattern.days.length + 1, start: pattern.ordinaryStart })}</p>
        {rulesApplied ? (
          <p className="small ok">{t('pattern.applied')}</p>
        ) : (
          <button type="button" className="button button-small" onClick={useRules}>
            {t('pattern.useRules')}
          </button>
        )}
      </div>
    </Card>
  );
}
