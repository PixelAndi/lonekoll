import { useApp } from '../../app-context.ts';
import { saveSettings } from '../../db.ts';
import type { Schedule, ScheduledShift } from '../../domain/model.ts';
import { weekStart } from '../../domain/time.ts';
import { Card, Field } from '../common.tsx';
import { TimeField } from '../StampRowsEditor.tsx';
import { LazyInput, numberOrUndefined } from './inputs.tsx';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export function ScheduleSettings() {
  const { t, settings } = useApp();
  const schedule = settings.schedule;
  const setSchedule = (s: Schedule) => void saveSettings({ schedule: s });

  const setWeeks = (n: number) => {
    const weeks = Array.from({ length: n }, (_, i) => schedule.weeks[i] ?? [...(schedule.weeks.at(-1) ?? Array(7).fill(null))]);
    setSchedule({ ...schedule, weeks });
  };
  const setDay = (w: number, d: number, shift: ScheduledShift | null) =>
    setSchedule({ ...schedule, weeks: schedule.weeks.map((week, i) => (i === w ? week.map((x, j) => (j === d ? shift : x)) : week)) });
  /** A day is a shift once both times are set; clearing either makes it a day off. */
  const editDay = (w: number, d: number, patch: Partial<ScheduledShift>) => {
    const current = schedule.weeks[w][d] ?? { start: '', end: '', breakMinutes: 0 };
    const next = { ...current, ...patch };
    setDay(w, d, next.start && next.end ? next : next.start || next.end ? (next as ScheduledShift) : null);
  };

  return (
    <Card title={t('settings.schedule')}>
      <div className="radio-group" role="radiogroup">
        {(['none', 'fixed'] as const).map((mode) => (
          <label key={mode} className="radio">
            <input type="radio" name="scheduleMode" checked={settings.scheduleMode === mode} onChange={() => void saveSettings({ scheduleMode: mode })} />
            {t(mode === 'none' ? 'settings.scheduleNone' : 'settings.scheduleFixed')}
          </label>
        ))}
      </div>
      <p className="muted small">{t('settings.scheduleHint')}</p>
      {settings.scheduleMode === 'fixed' && (
        <>
          <div className="field-row">
            <Field label={t('settings.rotation')}>
              <select value={schedule.weeks.length} onChange={(e) => setWeeks(Number(e.target.value))}>
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
            {schedule.weeks.length > 1 && (
              <Field label={t('settings.rotationStart')}>
                <input type="date" value={schedule.startMonday} onChange={(e) => e.target.value && setSchedule({ ...schedule, startMonday: weekStart(e.target.value) })} />
              </Field>
            )}
          </div>
          {schedule.weeks.map((week, w) => (
            <div key={w} className="schedule-week">
              {schedule.weeks.length > 1 && <h3>{t('settings.week', { n: w + 1 })}</h3>}
              {WEEKDAYS.map((wd, d) => {
                const shift = week[d];
                return (
                  <div key={wd} className="schedule-day">
                    <span className="schedule-day-name">{t(`weekday.${wd}`)}</span>
                    <TimeField label={t('day.in')} value={shift?.start || null} onChange={(v) => editDay(w, d, { start: v ?? '' })} />
                    <TimeField label={t('day.out')} value={shift?.end || null} onChange={(v) => editDay(w, d, { end: v ?? '' })} />
                    <label>
                      <span className="field-label">{t('day.break')}</span>
                      <LazyInput
                        type="number"
                        min="0"
                        max="240"
                        inputMode="numeric"
                        disabled={!shift}
                        value={shift ? String(shift.breakMinutes) : ''}
                        onCommit={(v) => editDay(w, d, { breakMinutes: Math.max(0, Math.round(numberOrUndefined(v) ?? 0)) })}
                      />
                    </label>
                  </div>
                );
              })}
            </div>
          ))}
        </>
      )}
    </Card>
  );
}
