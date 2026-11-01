import type { Basis } from '../domain/basis.ts';
import type { Formatter } from '../format.ts';
import type { Translate } from '../i18n.ts';

// What the comparison rests on, said for both readers: the employee (which
// days to add to the log) and the employer (which days to look up in their
// own time records) – so a difference caused by missing days isn't read as
// a wrong pay, nor a wrong pay waved away as missing days.

const hoursOf = (list: { hours: number }[]) => list.reduce((s, d) => s + d.hours, 0);

/** The dates, short: "19/7 (8,50 h), 20/7 (9,00 h)". */
function dateList(list: { date: string; hours?: number }[], fmt: Formatter): string {
  return list.map((d) => (d.hours !== undefined ? `${fmt.date(d.date, 'numeric')} (${fmt.number(d.hours, 2)} h)` : fmt.date(d.date, 'numeric'))).join(', ');
}

/** The basis in full, for the report: what is logged, what is missing, and how to read a difference. */
export function BasisSection({ basis, t, fmt }: { basis: Basis; t: Translate; fmt: Formatter }) {
  return (
    <section className={`report-basis report-basis-${basis.state}`}>
      <h2>{t('basis.title')}</h2>
      <BasisFacts basis={basis} t={t} fmt={fmt} />
      <p className="report-ref">{t('basis.howToRead')}</p>
    </section>
  );
}

function BasisFacts({ basis, t, fmt }: { basis: Basis; t: Translate; fmt: Formatter }) {
  const paid = basis.paidDays.length
    ? t('basis.paidDays', { n: basis.paidDays.length, hours: fmt.number(hoursOf(basis.paidDays), 2) })
    : null;
  if (basis.state === 'none') {
    return (
      <>
        <p className="basis-alert">
          <strong>{t('basis.none')}</strong>
        </p>
        {paid && <p>{paid}</p>}
      </>
    );
  }
  return (
    <>
      <p>
        {t('basis.logged', { n: basis.logged.length })}
        {paid && ` ${paid}`}
      </p>
      {basis.state === 'full' && <p className="ok">✓ {t(basis.paidDays.length ? 'basis.fullPaid' : 'basis.full')}</p>}
      {basis.paidNotLogged.length > 0 && (
        <p className="basis-alert">
          <strong>{t('basis.paidNotLogged', { n: basis.paidNotLogged.length, hours: fmt.number(hoursOf(basis.paidNotLogged), 2) })}</strong>{' '}
          {dateList(basis.paidNotLogged, fmt)}
        </p>
      )}
      {basis.unlogged.length > 0 && (
        <p className="basis-alert">
          <strong>{t('basis.unlogged', { n: basis.unlogged.length })}</strong> {dateList(basis.unlogged.map((date) => ({ date })), fmt)}
        </p>
      )}
    </>
  );
}

/** The short version, on the slip's page in the app: what is missing, and what to do about it. */
export function BasisNotice({ basis, t, fmt }: { basis: Basis; t: Translate; fmt: Formatter }) {
  if (basis.state === 'full') return null;
  return (
    <div className="notice notice-warn">
      <BasisFacts basis={basis} t={t} fmt={fmt} />
      <p className="small">{t('basis.whatToDo')}</p>
    </div>
  );
}
