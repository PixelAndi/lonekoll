import { useMemo } from 'react';
import { useApp } from '../app-context.ts';
import { calculatePeriod } from '../domain/calc.ts';
import { payDateFor } from '../domain/payday.ts';
import { addDays, isoWeekday, monthEnd, monthStart, todayLocal } from '../domain/time.ts';
import { href, navigate } from '../router.ts';
import { openClock } from './actions.ts';
import { Card, Icon, Page } from './common.tsx';
import { IssuesLine } from './IssuesView.tsx';
import { stampText } from './stamps.ts';

// Idag: where the app opens. Today's stamps and the ways to log them, this
// week's hours and the next pay day, what is open in Ärenden, and the last
// few days – the daily log first; everything else is a tab away.

export function TodayView() {
  const { t, fmt, days, settings } = useApp();
  const today = todayLocal();
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const record = byDate.get(today);

  // This week, Monday to Sunday.
  const monday = addDays(today, 1 - isoWeekday(today));
  const week = useMemo(() => calculatePeriod(days, settings, monday, addDays(monday, 6)), [days, settings, monday]);

  // The next pay day, and the month it pays for (worked out from the log).
  const next = useMemo(() => {
    const thisMonth = today.slice(0, 7);
    const lastMonth = monthStart(addDays(monthStart(today), -1)).slice(0, 7);
    const day = settings.payDay ?? 25;
    const month = payDateFor(lastMonth, day) >= today ? lastMonth : thisMonth;
    const start = `${month}-01`;
    return { date: payDateFor(month, day), month: start, gross: calculatePeriod(days, settings, start, monthEnd(start)).expectedGross };
  }, [days, settings, today]);

  const recent = useMemo(
    () =>
      days
        .filter((d) => d.date < today && (d.rows.length > 0 || d.absence))
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 3),
    [days, today],
  );

  return (
    <Page title={t('nav.today')}>
      <p className="muted today-date">{fmt.date(today, 'long')}</p>
      {settings.wages.length === 0 && (
        <Card title={t('setup.title')} className="card-highlight">
          <p>{t('setup.text')}</p>
          <div className="button-row">
            <a className="button button-primary" href={href({ name: 'settings' })}>
              {t('setup.button')}
            </a>
            <a className="button" href={href({ name: 'slips' })}>
              {t('setup.slipButton')}
            </a>
          </div>
        </Card>
      )}

      <Card title={t('today.shift')} className="today-shift">
        <a className="today-stamps" href={href({ name: 'day', date: today })}>
          {record?.rows.length ? stampText(record.rows) : record?.absence ? t(`absence.${record.absence.type}`) : t('today.nothing')}
        </a>
        <button type="button" className="button button-primary button-large" onClick={() => openClock('scan')}>
          <Icon name="camera" /> {t('scan.open')}
        </button>
        <div className="today-more">
          <a className="button" href={href({ name: 'timecard' })}>
            {t('timecard.button')}
          </a>
          <button type="button" className="button" onClick={() => navigate({ name: 'day', date: today })}>
            {t('today.type')}
          </button>
          <button type="button" className="button" onClick={() => openClock('pick')}>
            {t('today.photos')}
          </button>
        </div>
        <p className="small muted">
          {t('days.forgotTip')} <a href={href({ name: 'help', section: 'forgot' })}>{t('days.forgotHow')}</a>
        </p>
      </Card>

      <div className="today-stats">
        <a className="card today-stat" href={href({ name: 'days' })}>
          <span className="small muted">{t('today.week')}</span>
          <strong>{fmt.duration(week.workedMinutes)}</strong>
          <span className="small muted">{t('today.weekShifts', { n: week.shifts.length })}</span>
        </a>
        <a className="card today-stat" href={href({ name: 'month', month: next.month.slice(0, 7) })}>
          <span className="small muted">{t('today.payDay')}</span>
          <strong>{fmt.date(next.date)}</strong>
          <span className="small muted">{next.gross > 0 ? t('today.payGross', { amount: fmt.money(Math.round(next.gross)) }) : fmt.month(next.month)}</span>
        </a>
      </div>

      <IssuesLine />

      {recent.length > 0 && (
        <section className="today-recent">
          <div className="today-recent-head">
            <span className="small muted">{t('today.recent')}</span>
            <a className="small" href={href({ name: 'days' })}>
              {t('today.allDays')}
            </a>
          </div>
          <ul className="day-list">
            {recent.map((d) => (
              <li key={d.date}>
                <a className="day-item" href={href({ name: 'day', date: d.date })}>
                  <span className="day-date">{fmt.date(d.date)}</span>
                  <span className="day-main">{d.rows.length ? stampText(d.rows) : d.absence ? t(`absence.${d.absence.type}`) : ''}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Page>
  );
}
