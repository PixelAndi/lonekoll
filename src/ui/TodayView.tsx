import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { useApp } from '../app-context.ts';
import { db } from '../db.ts';
import { calculatePeriod, kompBalance } from '../domain/calc.ts';
import { isHoliday } from '../domain/holidays.ts';
import { monthlyPayOn } from '../domain/model.ts';
import { payDateFor } from '../domain/payday.ts';
import { usualWeekdays } from '../domain/reportCheck.ts';
import { currentSickPeriod } from '../domain/sick.ts';
import { workedPastMidnight } from '../domain/night.ts';
import { taxBasis, taxColumn, taxFor } from '../domain/tax.ts';
import { addDays, isoWeekday, monthEnd, monthStart, todayLocal } from '../domain/time.ts';
import { vacationLedger } from '../domain/vacationDays.ts';
import { href, navigate } from '../router.ts';
import { useTaxData } from '../taxData.ts';
import { AbsenceSheet } from './AbsenceSheet.tsx';
import { openClock } from './actions.ts';
import { Card, Icon, Page } from './common.tsx';
import { IssuesLine } from './IssuesView.tsx';
import { SickInfo } from './SickInfo.tsx';
import { applyOverrides } from './slipComparison.ts';

// Idag: the everyday things, for the end of the day – register the day
// (scan the clock after clocking out, or sick, leave, typed in, a timecard),
// the days of the last two weeks still without anything, an ongoing sick
// period with what is due when, what the next pay should be (hourly) or the
// komptid saved and used (monthly salary), and the vacation days left, from
// the pay slips and from the app's own count. The checks are in Kontroll.

export function TodayView() {
  const { t, days, settings } = useApp();
  const [sheet, setSheet] = useState<'sick' | 'leave' | null>(null);
  const today = todayLocal();
  const sick = useMemo(() => currentSickPeriod(days, today), [days, today]);
  // Only for someone whose shifts have ended after midnight: the day before is to be scanned too.
  const pastMidnight = useMemo(() => workedPastMidnight(days), [days]);

  return (
    <Page title={t('nav.today')}>
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

      <Card title={t('today.register')} className="today-register">
        <button type="button" className="button button-primary button-large" onClick={() => openClock('scan')}>
          <Icon name="camera" /> {t('scan.open')}
        </button>
        <ol className="today-steps small">
          <li>{t('today.step1')}</li>
          <li>{t('today.step2')}</li>
          <li>{t('today.step3')}</li>
          <li>{t('today.step4')}</li>
        </ol>
        {pastMidnight && <p className="small today-midnight">{t('today.midnight')}</p>}
        <div className="today-more">
          <button type="button" className="button" onClick={() => setSheet('sick')}>
            {t('today.sick')}
          </button>
          <button type="button" className="button" onClick={() => setSheet('leave')}>
            {t('today.leave')}
          </button>
          <button type="button" className="button" onClick={() => navigate({ name: 'day', date: today })}>
            {t('today.type')}
          </button>
          <a className="button" href={href({ name: 'timecard' })}>
            {t('timecard.button')}
          </a>
        </div>
        <p className="small">
          <button type="button" className="link-inline" onClick={() => openClock('pick')}>
            {t('today.photos')}
          </button>{' '}
          · <a href={href({ name: 'help', section: 'forgot' })}>{t('today.forgot')}</a>
        </p>
      </Card>

      <MissingDays />

      {sick && (
        <Card title={t('today.sickNow', { day: sick.dayNo })} className="card-highlight">
          <SickInfo start={sick.start} />
          <button type="button" className="button" onClick={() => setSheet('sick')}>
            {t('today.stillSick')}
          </button>
        </Card>
      )}

      <Prognosis />
      <VacationCard />
      <IssuesLine />

      {sheet && <AbsenceSheet kind={sheet} onClose={() => setSheet(null)} />}
    </Page>
  );
}

/** Usual working days of the last two weeks with nothing registered (scanning can catch up on them). */
function MissingDays() {
  const { t, fmt, days } = useApp();
  const today = todayLocal();
  const missing = useMemo(() => {
    if (!days.length) return [];
    const first = days.reduce((min, d) => (d.date < min ? d.date : min), today);
    const usual = usualWeekdays(days, today);
    const logged = new Set(days.map((d) => d.date));
    const out: string[] = [];
    for (let d = addDays(today, -1); d >= addDays(today, -14) && d >= first; d = addDays(d, -1)) {
      if (usual.has(isoWeekday(d)) && !isHoliday(d) && !logged.has(d)) out.push(d);
    }
    return out;
  }, [days, today]);
  if (!missing.length) return null;
  return (
    <Card className="today-missing">
      <p>
        <strong>{t('today.missing', { n: missing.length })}</strong>
      </p>
      <ul className="today-missing-list">
        {missing.slice(0, 5).map((d) => (
          <li key={d}>
            <a href={href({ name: 'day', date: d })}>{fmt.date(d)}</a>
          </li>
        ))}
      </ul>
      <p className="small muted">{t('today.missingHow')}</p>
    </Card>
  );
}

/**
 * What the next pay should be: for an hourly wage the gross the log adds up to for the month it
 * pays, with tax from the tax table, and this month so far; for a monthly salary the komptid saved
 * and used. Komptid is shown for anyone who has any.
 */
function Prognosis() {
  const { t, fmt, days, settings } = useApp();
  const today = todayLocal();
  const monthly = monthlyPayOn(settings, today) !== null;
  const next = useMemo(() => {
    const day = settings.payDay ?? 25;
    const lastMonth = monthStart(addDays(monthStart(today), -1)).slice(0, 7);
    const month = payDateFor(lastMonth, day) >= today ? lastMonth : today.slice(0, 7);
    const start = `${month}-01`;
    const period = calculatePeriod(days, settings, start, monthEnd(start));
    return { date: payDateFor(month, day), month: start, gross: period.expectedGross, shifts: period.shifts.length };
  }, [days, settings, today]);
  const soFar = useMemo(() => calculatePeriod(days, settings, monthStart(today), today), [days, settings, today]);
  const komp = useMemo(() => {
    const now = kompBalance(days, settings, today);
    const before = kompBalance(days, settings, addDays(monthStart(today), -1));
    return { left: now.left, earned: now.earned - before.earned, taken: now.taken - before.taken };
  }, [days, settings, today]);
  const payYear = Number(next.date.slice(0, 4));
  const { tables, rates, loading } = useTaxData(payYear);
  const basis = taxBasis(settings.tax, rates);
  const tax = !loading && basis.kind !== 'unknown' && next.gross > 0 ? taxFor(basis, tables, next.gross, taxColumn(settings.birthDate, payYear)) : undefined;
  const hasKomp = komp.left !== 0 || komp.earned !== 0 || komp.taken !== 0 || settings.overtimeAs === 'komp';

  return (
    <Card title={t('today.prognosis')}>
      <a className="today-next" href={href({ name: 'month', month: next.month.slice(0, 7) })}>
        <span className="small muted">{t('today.payDay', { date: fmt.date(next.date) })}</span>
        {monthly ? (
          <strong>{t('today.monthlyPay', { amount: fmt.money(Math.round(next.gross)) })}</strong>
        ) : next.gross > 0 ? (
          <strong>
            {t('today.payGross', { amount: fmt.money(Math.round(next.gross)) })}
            {tax !== undefined && ` · ${t('today.payNet', { amount: fmt.money(Math.round(next.gross - tax)) })}`}
          </strong>
        ) : (
          <strong>{t('today.payNone')}</strong>
        )}
        <span className="small muted">{t('today.payFor', { month: fmt.month(next.month), n: next.shifts })}</span>
      </a>
      {next.month.slice(0, 7) !== today.slice(0, 7) && (
        <p className="small">
          {t('today.soFar', { month: fmt.month(monthStart(today)), hours: fmt.duration(soFar.workedMinutes), amount: fmt.money(Math.round(soFar.expectedGross)) })}
        </p>
      )}
      {hasKomp && (
        <p className="small">
          {t('today.komp', { left: fmt.number(komp.left), earned: fmt.number(komp.earned), taken: fmt.number(komp.taken) })}
        </p>
      )}
      <p className="small muted">{t('today.prognosisNote')}</p>
    </Card>
  );
}

/** Vacation days left: the latest slip's balances, less the vacation days logged since. */
function VacationCard() {
  const { t, fmt, days, settings } = useApp();
  const dayCount = (n: number) => fmt.number(n, Number.isInteger(n) ? 0 : 1);
  const records = useLiveQuery(() => db.slips.toArray(), []);
  const today = todayLocal();
  const ledger = useMemo(() => vacationLedger((records ?? []).map((r) => applyOverrides(r.slip, settings.codeOverrides)), settings, today), [records, settings, today]);
  if (!ledger.latest) return null;
  const after = monthEnd(ledger.latest.month);
  const loggedSince = days.filter((d) => d.absence?.type === 'vacation' && d.date > after && d.date <= today).length;
  const mismatches = ledger.steps.filter((s) => s.mismatch).length;
  return (
    <Card title={t('today.vacation')}>
      <p className="today-vacation">
        <strong>{t('today.vacationLeft', { paid: dayCount(ledger.latest.paid), saved: dayCount(ledger.latest.saved) })}</strong>
      </p>
      <p className="small muted">{t('today.vacationAsOf', { month: fmt.month(ledger.latest.month) })}</p>
      {loggedSince > 0 && <p className="small">{t('today.vacationLogged', { n: loggedSince, left: dayCount(Math.max(0, ledger.latest.paid - loggedSince)) })}</p>}
      <p className={mismatches ? 'small warn-text' : 'small ok'}>
        {mismatches ? <a href={href({ name: 'issues' })}>{t('today.vacationCheck', { n: mismatches })}</a> : `✓ ${t('today.vacationOk')}`}
      </p>
    </Card>
  );
}
