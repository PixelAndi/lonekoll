import { useMemo } from 'react';
import { useApp } from '../app-context.ts';
import { calculatePeriod, type CategoryTotal, type PayCategory, type PeriodResult } from '../domain/calc.ts';
import { formatDuration, monthEnd, todayLocal } from '../domain/time.ts';
import { href } from '../router.ts';
import { Card, Notice, Page } from './common.tsx';
import { MonthNav } from './DaysView.tsx';

export const CATEGORY_ORDER: PayCategory[] = [
  'wage',
  'ob1',
  'ob2',
  'ob3',
  'ob4',
  'ot50',
  'ot100',
  'sickPay',
  'karens',
  'holidayPay',
  'permission',
  'timebankPay',
];

export function MonthView({ month }: { month?: string }) {
  const { t, fmt, days, settings } = useApp();
  const monthKey = month ?? todayLocal().slice(0, 7);
  const start = `${monthKey}-01`;
  const end = monthEnd(start);
  const period = useMemo(() => calculatePeriod(days, settings, start, end), [days, settings, start, end]);

  return (
    <Page title={t('month.title')}>
      <MonthNav month={monthKey} route="month" />
      <PeriodTotals period={period} />
      <p className="muted small">{t('month.excludesVacation')} {t('month.paidNextMonth')}</p>
      <PeriodWarnings period={period} />
      <Card title={t('month.shifts')}>
        {period.shifts.length === 0 ? (
          <p className="muted">{t('month.noData')}</p>
        ) : (
          <table className="table">
            <tbody>
              {period.shifts.map((r) => {
                const ob = r.obMinutes[1] + r.obMinutes[2] + r.obMinutes[3] + r.obMinutes[4];
                const ot = r.overtime50 + r.overtime100;
                return (
                  <tr key={r.shift.start}>
                    <td>
                      <a href={href({ name: 'day', date: r.shift.date })}>{fmt.date(r.shift.date)}</a>
                    </td>
                    <td>
                      {r.startTime}–{r.endTime}
                    </td>
                    <td className="num">{formatDuration(r.shift.workedMinutes)}</td>
                    <td className="num muted">{ob ? `${t('month.obShort')} ${formatDuration(ob)}` : ''}</td>
                    <td className="num muted">{ot ? `${t('month.otShort')} ${formatDuration(ot)}` : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}

export function PeriodTotals({ period }: { period: PeriodResult }) {
  const { t, fmt } = useApp();
  const rows = CATEGORY_ORDER.map((c) => [c, period.totals[c]] as const).filter((x): x is [PayCategory, CategoryTotal] => !!x[1]);
  return (
    <Card>
      <dl className="kv kv-large">
        <div className="kv-pair">
          <dt>{t('month.worked')}</dt>
          <dd>{formatDuration(period.workedMinutes)}</dd>
        </div>
      </dl>
      <table className="table">
        <tbody>
          {rows.map(([category, total]) => (
            <tr key={category}>
              <td>{t(`cat.${category}`)}</td>
              <td className="num">{total.hours ? fmt.hours(total.hours) : ''}</td>
              <td className="num">{fmt.money(total.amount)}</td>
            </tr>
          ))}
          {period.vacationDays > 0 && (
            <tr>
              <td>{t('month.vacationDays')}</td>
              <td className="num">{period.vacationDays}</td>
              <td />
            </tr>
          )}
          {period.timebankHours > 0 && !period.totals.timebankPay && (
            <tr>
              <td>{t('month.timebankHours')}</td>
              <td className="num">{fmt.hours(period.timebankHours)}</td>
              <td />
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <th>{t('month.expectedGross')}</th>
            <td />
            <th className="num">{fmt.money(period.expectedGross)}</th>
          </tr>
        </tfoot>
      </table>
      {period.sick && period.sick.weeksUsed > 0 && <p className="muted small">{t('month.sickBasis', { weeks: period.sick.weeksUsed })}</p>}
    </Card>
  );
}

export function PeriodWarnings({ period }: { period: PeriodResult }) {
  const { t, fmt } = useApp();
  const shiftWarnings = period.shifts.flatMap((r) => r.warnings.map((w) => ({ date: r.shift.date, w })));
  if (period.warnings.length + period.issues.length + shiftWarnings.length === 0) return null;
  return (
    <Card title={t('month.warnings')}>
      {period.warnings.map((w, i) => (
        <Notice key={`p${i}`} kind="warn">
          {t(`warn.${w.code}`, {
            ...w.values,
            ...(typeof w.values?.rate === 'number' ? { rate: fmt.number(w.values.rate) } : {}),
            ...(typeof w.values?.minimum === 'number' ? { minimum: fmt.number(w.values.minimum) } : {}),
            date: w.date ? fmt.date(w.date) : '',
          })}
        </Notice>
      ))}
      <ul className="warning-list">
        {period.issues.map((i) => (
          <li key={`${i.date}${i.code}${i.time}`}>
            <a href={href({ name: 'day', date: i.date })}>{fmt.date(i.date)}</a>: {t(`issue.${i.code}`, { time: i.time })}
          </li>
        ))}
        {shiftWarnings.map(({ date, w }) => (
          <li key={`${date}${w}`}>
            <a href={href({ name: 'day', date })}>{fmt.date(date)}</a>: {t(`warn.${w}`)}
          </li>
        ))}
      </ul>
    </Card>
  );
}
