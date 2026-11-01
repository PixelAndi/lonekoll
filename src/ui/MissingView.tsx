import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { useApp } from '../app-context.ts';
import { db, saveSettings } from '../db.ts';
import { checkMonths, type MonthCheck } from '../domain/missing.ts';
import { monthEnd, todayLocal } from '../domain/time.ts';
import { href } from '../router.ts';
import { Card, Field, Notice, Page } from './common.tsx';

// What is missing between the start of the employment and today, on a page
// of its own: months with no days, planned days with nothing on them, pay
// slips not imported, dates without a wage. Each with a link to put it right.

/** The checks, from the start of the employment (or the first day logged) to today. */
export function useMissing(): { start?: string; fromSettings: boolean; months: MonthCheck[] } {
  const { days, settings } = useApp();
  const slips = useLiveQuery(() => db.slips.toArray(), []);
  return useMemo(() => {
    const first = [...days.map((d) => d.date), ...(slips ?? []).map((s) => s.periodStart)].sort()[0];
    const start = settings.employedSince ?? first;
    const periods = (slips ?? []).map((s) => ({ from: s.periodStart, to: s.slip.periodEnd ?? monthEnd(s.periodStart) }));
    return { start, fromSettings: !!settings.employedSince, months: start ? checkMonths(start, todayLocal(), days, periods, settings) : [] };
  }, [days, slips, settings]);
}

/** How many things are missing (for the link to the page). */
export function missingCount(months: MonthCheck[]): number {
  return months.reduce((n, m) => n + m.missing.length, 0);
}

export function MissingView() {
  const { t, fmt, lang } = useApp();
  const { start, fromSettings, months } = useMissing();
  const [all, setAll] = useState(false);
  const inText = (m: string) => (lang === 'sv' || lang === 'pl' ? fmt.month(`${m}-01`).toLocaleLowerCase(lang) : fmt.month(`${m}-01`));
  const noDays = months.filter((m) => m.missing.includes('noDays'));
  const planned = months.reduce((n, m) => n + m.planned.length, 0);
  const noSlip = months.filter((m) => m.missing.includes('noSlip'));
  const noWage = months.filter((m) => m.missing.includes('noWage'));
  const shown = (all ? months : months.filter((m) => m.missing.length)).slice().reverse();

  return (
    <Page title={t('missing.title')}>
      <p className="muted">{t('missing.intro')}</p>
      <Card>
        <Field label={t('settings.employedSince')}>
          <input type="date" value={fromSettings ? start : ''} onChange={(e) => void saveSettings({ employedSince: e.target.value || undefined })} />
        </Field>
        {!fromSettings && start && <p className="small warn-text">{t('missing.noStart', { date: fmt.date(start) })}</p>}
        {!start && <p className="small">{t('missing.nothing')}</p>}
      </Card>

      {start && (
        <Card title={t('missing.summary', { from: inText(start.slice(0, 7)), to: inText(todayLocal().slice(0, 7)) })}>
          {noDays.length + planned + noSlip.length + noWage.length === 0 ? (
            <Notice kind="ok">{t('missing.allThere')}</Notice>
          ) : (
            <ul className="missing-summary">
              {noDays.length > 0 && <li>{t('missing.sum.noDays', { n: noDays.length })}</li>}
              {planned > 0 && <li>{t('missing.sum.planned', { n: planned })}</li>}
              {noSlip.length > 0 && <li>{t('missing.sum.noSlip', { n: noSlip.length })}</li>}
              {noWage.length > 0 && <li>{t('missing.sum.noWage', { n: noWage.length })}</li>}
            </ul>
          )}
          <label className="checkbox small">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            <span>{t('missing.showAll')}</span>
          </label>
        </Card>
      )}

      {shown.map((m) => (
        <Card key={m.month} title={fmt.month(`${m.month}-01`)} className={m.missing.length ? 'missing-month' : 'missing-month missing-month-ok'}>
          <p className="small muted">
            {t('missing.days', { n: m.days })}
            {m.slip ? ` · ${t('missing.hasSlip')}` : ''}
            {m.current ? ` · ${t('missing.current')}` : ''}
          </p>
          {m.missing.length === 0 && <p className="ok small">✓ {t('missing.ok')}</p>}
          <ul className="missing-list">
            {m.missing.includes('noDays') && (
              <li>
                {t('missing.noDays')} <a href={href({ name: 'timecard' })}>{t('missing.scan')}</a> ·{' '}
                <a href={href({ name: 'days', month: m.month })}>{t('missing.open')}</a>
              </li>
            )}
            {m.missing.includes('planned') && (
              <li>
                {t('missing.planned', { n: m.planned.length })}{' '}
                <span className="missing-dates">
                  {m.planned.map((d, i) => (
                    <span key={d}>
                      {i > 0 && ', '}
                      <a href={href({ name: 'day', date: d })}>{fmt.date(d)}</a>
                    </span>
                  ))}
                </span>
              </li>
            )}
            {m.missing.includes('noSlip') && (
              <li>
                {t('missing.noSlip')} <a href={href({ name: 'slips' })}>{t('missing.addSlip')}</a>
              </li>
            )}
            {m.missing.includes('noWage') && (
              <li>
                {t('missing.noWage', { date: fmt.date(m.noWageFrom!) })} <a href={href({ name: 'settings' })}>{t('missing.setWage')}</a>
              </li>
            )}
          </ul>
        </Card>
      ))}
    </Page>
  );
}
