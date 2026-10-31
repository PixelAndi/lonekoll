import { useApp } from '../app-context.ts';
import type { SlipRecord } from '../db.ts';
import { earningYearForVacationOn, earningYearOf, vacationBasis, vacationPayPerDay, type VacationBasis } from '../domain/vacation.ts';
import { addDays, addYears, todayLocal } from '../domain/time.ts';
import { Card } from './common.tsx';
import { Cited } from './Cited.tsx';
import { applyOverrides } from './slipComparison.ts';

// How close the imported pay slips are to a whole earning year, which is what
// it takes to work out the vacation pay (13.2 % of the year's pay).

export function VacationProgress({ slips }: { slips: SlipRecord[] }) {
  const { t, fmt, settings } = useApp();
  const today = todayLocal();
  const all = slips.map((r) => applyOverrides(r.slip, settings.codeOverrides));
  // Vacation taken now is paid from the last earning year; this year's pay counts towards next year's.
  const now = vacationBasis(all, settings, earningYearForVacationOn(today, settings));
  const next = vacationBasis(all, settings, earningYearOf(today, settings));
  const vacationYear = { start: addDays(now.year.end, 1), end: addYears(now.year.end, 1) };
  // "april 2025" inside a sentence (English keeps its capital).
  const month = (date: string) => (settings.language === 'en' ? fmt.month(date) : fmt.month(date).toLocaleLowerCase());

  return (
    <Card title={t('vacation.title')}>
      <p className="small">
        {t('vacation.intro', {
          from: month(vacationYear.start),
          to: month(vacationYear.end),
          earnFrom: month(now.year.start),
          earnTo: month(now.year.end),
        })}
      </p>
      <Progress basis={now} />
      {now.complete ? (
        <p className="small ok">
          <Cited
            text={t('vacation.ready', { pay: fmt.money(now.pay), days: now.paidDays, perDay: fmt.money(now.perDay), result: fmt.money(vacationPayPerDay(now)) })}
          />
        </p>
      ) : (
        <>
          <p className="small">
            {t('vacation.missing', {
              months: now.months
                .filter((m) => !m.covered)
                .map((m) => month(`${m.month}-01`))
                .join(', '),
            })}
          </p>
          <p className="muted small">{t('vacation.howTo')}</p>
        </>
      )}
      {now.minimum !== undefined && (
        <p className="muted small">
          <Cited text={t('vacation.minimum', { minimum: fmt.money(now.minimum) })} />
        </p>
      )}
      <p className="small vacation-next">{t('vacation.next', { from: month(next.year.start), to: month(next.year.end) })}</p>
      <Progress basis={next} />
      <p className="muted small">{t('vacation.caveat')}</p>
    </Card>
  );
}

function Progress({ basis }: { basis: VacationBasis }) {
  const { t, fmt } = useApp();
  const total = basis.months.length;
  return (
    <div className="vacation-progress">
      <div
        className="progress-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={basis.covered}
        aria-label={t('vacation.progress', { n: basis.covered, total })}
      >
        {basis.months.map((m) => (
          <span key={m.month} className={m.covered ? 'is-covered' : undefined} title={fmt.month(`${m.month}-01`)} />
        ))}
      </div>
      <span className="small">
        {basis.complete ? t('vacation.progressDone', { total }) : t('vacation.progress', { n: basis.covered, total, left: total - basis.covered })}
      </span>
    </div>
  );
}
