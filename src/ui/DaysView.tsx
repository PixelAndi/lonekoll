import { useMemo } from 'react';
import { useApp } from '../app-context.ts';
import { calculatePeriod, calculateShifts } from '../domain/calc.ts';
import { specialDay } from '../domain/holidays.ts';
import { datesInRange, monthEnd, todayLocal } from '../domain/time.ts';
import { href, navigate } from '../router.ts';
import { Card, Icon, Notice, Page } from './common.tsx';
import { PhotoImportButton } from './PhotoImport.tsx';
import { hasManual, stampText } from './stamps.ts';

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export function MonthNav({ month, route }: { month: string; route: 'days' | 'month' }) {
  const { fmt, t } = useApp();
  return (
    <nav className="month-nav">
      <a className="icon-button" href={href({ name: route, month: shiftMonth(month, -1) })} aria-label={t('common.previous')}>
        <Icon name="chevronLeft" />
      </a>
      <span className="month-nav-label">{fmt.month(`${month}-01`)}</span>
      <a className="icon-button" href={href({ name: route, month: shiftMonth(month, 1) })} aria-label={t('common.next')}>
        <Icon name="chevronRight" />
      </a>
    </nav>
  );
}

export function DaysView({ month }: { month?: string }) {
  const { t, fmt, days, settings } = useApp();
  const today = todayLocal();
  const monthKey = month ?? today.slice(0, 7);
  const start = `${monthKey}-01`;
  const end = monthEnd(start);

  const { results, issues } = useMemo(() => calculateShifts(days, settings), [days, settings]);
  const period = useMemo(() => calculatePeriod(days, settings, start, end), [days, settings, start, end]);
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);

  // Empty days before the first logged day are just noise for a new user.
  const firstLogged = days.reduce<string | null>((min, d) => (min === null || d.date < min ? d.date : min), null);
  const last = end < today ? end : today;
  const dates = start <= last ? datesInRange(start, last).filter((d) => byDate.has(d) || (firstLogged !== null && d >= firstLogged)).reverse() : [];
  const obMinutes = period.buckets.filter((b) => b.category.startsWith('ob')).reduce((s, b) => s + b.minutes, 0);
  const otMinutes = period.buckets.filter((b) => b.category.startsWith('ot')).reduce((s, b) => s + b.minutes, 0);
  const missing = dates.filter((d) => !byDate.has(d)).length;

  return (
    <Page title={t('nav.days')}>
      {settings.wages.length === 0 && (
        <Card title={t('setup.title')} className="card-highlight">
          <p>{t('setup.text')}</p>
          <a className="button button-primary" href={href({ name: 'settings' })}>
            {t('setup.button')}
          </a>
        </Card>
      )}
      <div className="actions-stack">
        <PhotoImportButton />
        <p className="muted small">{t('days.photoHint')}</p>
        <button type="button" className="button" onClick={() => navigate({ name: 'day', date: today })}>
          <Icon name="plus" /> {t('days.manual')}
        </button>
      </div>

      <MonthNav month={monthKey} route="days" />
      <p className="month-summary">
        {t('days.summary', {
          shifts: period.shifts.length,
          hours: fmt.duration(period.workedMinutes),
          ob: fmt.duration(obMinutes),
          ot: fmt.duration(otMinutes),
        })}
      </p>
      {missing > 0 && <p className="muted small">{t('days.missingDays', { count: missing })}</p>}

      <ul className="day-list">
        {dates.map((date) => {
          const record = byDate.get(date);
          const starting = results.filter((r) => r.shift.date === date);
          const continued = results.some((r) => r.shift.date !== date && r.shift.dates.includes(date));
          const continues = starting.some((r) => r.shift.dates.length > 1);
          const dayIssues = issues.filter((i) => i.date === date);
          const warnings = [...new Set(starting.flatMap((r) => r.warnings))];
          const special = specialDay(date);
          const worked = starting.reduce((s, r) => s + r.shift.workedMinutes, 0);
          return (
            <li key={date}>
              <a className={`day-item ${record ? '' : 'day-item-empty'}`} href={href({ name: 'day', date })}>
                <span className="day-date">
                  {fmt.date(date)}
                  {special && <span className={`tag tag-${special.kind}`}>{t(special.name as never)}</span>}
                </span>
                <span className="day-main">
                  {record?.rows.length ? stampText(record.rows) : record?.absence ? '' : t('days.empty')}
                  {record?.absence && <span className="tag">{t(`absence.${record.absence.type}`)}</span>}
                </span>
                <span className="day-worked">{worked > 0 ? fmt.duration(worked) : ''}</span>
                <span className="day-flags">
                  {continued && <span className="flag">↩ {t('days.continued')}</span>}
                  {continues && <span className="flag">↪ {t('days.continues')}</span>}
                  {record && hasManual(record.rows) && <span className="flag">✎ {t('days.manualBadge')}</span>}
                  {dayIssues.map((i) => (
                    <span key={i.code + i.time} className="flag flag-error">
                      {t(`issue.${i.code}`, { time: i.time })}
                    </span>
                  ))}
                  {warnings.map((w) => (
                    <span key={w} className="flag flag-warn">
                      {t(`warn.${w}`)}
                    </span>
                  ))}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
      {dates.length === 0 && <p className="muted">{t('days.nothingThisMonth')}</p>}
      <Notice>{t('privacy.short')}</Notice>
    </Page>
  );
}
