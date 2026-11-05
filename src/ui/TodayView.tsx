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
import { useIssues } from './issues-context.tsx';
import { cellClass, holidayNote, KIND_LABEL, useCalendar } from './CalendarView.tsx';
import { upcomingHolidays } from '../domain/calendar.ts';
import type { TextKey } from '../i18n.ts';
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

      <WeekStrip />

      <Card title={t('today.register')} className="today-register cal-focus">
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

      <TodayChips />
      <MissingDays />

      {sick && (
        <Card title={t('today.sickNow', { day: sick.dayNo })} className="card-highlight">
          <SickInfo period={sick} />
          <button type="button" className="button" onClick={() => setSheet('sick')}>
            {t('today.stillSick')}
          </button>
        </Card>
      )}

      <Prognosis />
      <Soon />

      {sheet && <AbsenceSheet kind={sheet} onClose={() => setSheet(null)} />}
    </Page>
  );
}

/** Usual working days of the last two weeks with nothing registered (scanning can catch up on them). */
function useMissingDays(): string[] {
  const { days } = useApp();
  const today = todayLocal();
  return useMemo(() => {
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
}

function MissingDays() {
  const { t, fmt } = useApp();
  const missing = useMissingDays();
  if (!missing.length) return null;
  return (
    <Card className="today-missing cal-check">
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
    const of = (prefix: string) => period.buckets.filter((b) => b.category.startsWith(prefix));
    return {
      date: payDateFor(month, day),
      month: start,
      gross: period.expectedGross,
      shifts: period.shifts.length,
      obMinutes: of('ob').reduce((s, b) => s + b.minutes, 0),
      obAmount: of('ob').reduce((s, b) => s + b.amount, 0),
      otMinutes: of('ot').reduce((s, b) => s + b.minutes, 0),
      otAmount: of('ot').reduce((s, b) => s + b.amount, 0),
    };
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
      <div className="cal-focus-head">
        <span className="small muted">{t('today.payFor', { month: fmt.month(next.month), n: next.shifts })}</span>
        <span className="small muted">{t('today.payDay', { date: fmt.date(next.date) })}</span>
      </div>
      {!monthly && next.gross === 0 ? (
        <p>
          <strong>{t('today.payNone')}</strong>
        </p>
      ) : (
        <a className="cal-numbers today-numbers" href={href({ name: 'month', month: next.month.slice(0, 7) })}>
          <div>
            <strong>≈ {fmt.money(Math.round(next.gross))}</strong>
            <span className="small muted">{monthly ? t('cat.monthlySalary') : t('today.num.gross')}</span>
          </div>
          <div>
            <strong>{tax !== undefined ? `≈ ${fmt.money(Math.round(next.gross - tax))}` : '–'}</strong>
            <span className="small muted">{t('today.num.net')}</span>
          </div>
          <div>
            <strong>{fmt.duration(next.obMinutes)}</strong>
            <span className="small muted">{t('cal.num.ob', { amount: fmt.money(Math.round(next.obAmount)) })}</span>
          </div>
          <div>
            <strong>{fmt.duration(next.otMinutes)}</strong>
            <span className="small muted">{t('cal.num.ot', { amount: fmt.money(Math.round(next.otAmount)) })}</span>
          </div>
        </a>
      )}
      <MonthProgress />
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

/** This week as seven squares, coloured like the Kalender: what each day was, today outlined. */
function WeekStrip() {
  const { t, fmt } = useApp();
  const today = todayLocal();
  const monday = addDays(today, 1 - isoWeekday(today));
  const list = useCalendar(monday, addDays(monday, 6));
  return (
    <section className="card today-week">
      <div className="cal-focus-head">
        <strong>{t('today.week')}</strong>
        <a className="small" href={href({ name: 'days', month: today.slice(0, 7) })}>
          {t('today.weekNo', { n: isoWeek(today) })} ›
        </a>
      </div>
      <div className="cal-grid">
        {list.map((d) => {
          const label =
            d.kind === 'worked' ? fmt.duration(d.minutes) : KIND_LABEL[d.kind] ? t(KIND_LABEL[d.kind]!) : d.date === today ? t('today.weekToday') : d.holiday ? t(d.holiday.name as TextKey) : '';
          return (
            <button key={d.date} type="button" className={`${cellClass(d, today)} ${d.warn ? 'cal-warn' : ''}`} aria-label={fmt.date(d.date, 'long')} onClick={() => navigate({ name: 'day', date: d.date })}>
              <span className="cal-mark">{t(`weekday.${isoWeekday(d.date)}` as TextKey).slice(0, 3)}</span>
              <span className="cal-num">{Number(d.date.slice(8))}</span>
              <span className="cal-label">{label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** ISO week number. */
function isoWeek(date: string): number {
  const thursday = addDays(date, 4 - isoWeekday(date));
  const jan1 = `${thursday.slice(0, 4)}-01-01`;
  return Math.floor((Date.parse(thursday) - Date.parse(jan1)) / 864e5 / 7) + 1;
}

/** Days in the last two weeks with nothing, vacation left, and what Kontroll has – at a glance. */
function TodayChips() {
  const { t, fmt, days, settings } = useApp();
  const today = todayLocal();
  const missing = useMissingDays();
  const { count } = useIssues();
  const records = useLiveQuery(() => db.slips.toArray(), []);
  const ledger = useMemo(() => vacationLedger((records ?? []).map((r) => applyOverrides(r.slip, settings.codeOverrides)), settings, today), [records, settings, today]);
  const dayCount = (n: number) => fmt.number(n, Number.isInteger(n) ? 0 : 1);
  let vacation: string | null = null;
  if (ledger.latest) {
    const after = monthEnd(ledger.latest.month);
    const since = days.filter((d) => d.absence?.type === 'vacation' && d.date > after && d.date <= today).length;
    vacation = t('today.chip.vacation', { paid: dayCount(Math.max(0, ledger.latest.paid - since)), saved: dayCount(ledger.latest.saved) });
  }
  if (!missing.length && !vacation && !count) return null;
  return (
    <div className="cal-chips">
      {missing.length > 0 && (
        <a className="cal-chip cal-chip-warn" href={href({ name: 'day', date: missing[missing.length - 1] })}>
          {missing.length === 1 ? t('cal.chip.missing1') : t('cal.chip.missing', { n: missing.length })}
        </a>
      )}
      {vacation && (
        <a className="cal-chip cal-chip-vacation" href={href({ name: 'slips' })}>
          {vacation}
        </a>
      )}
      {count > 0 && (
        <a className="cal-chip" href={href({ name: 'issues' })}>
          {t('today.chip.issues', { n: count })}
        </a>
      )}
    </div>
  );
}

/** How much of this month's usual working days have something registered, as a bar. */
function MonthProgress() {
  const { t, fmt, days } = useApp();
  const today = todayLocal();
  const start = monthStart(today);
  const end = monthEnd(start);
  const { total, done } = useMemo(() => {
    const usual = usualWeekdays(days, today);
    const logged = new Set(days.filter((d) => d.rows.length > 0 || d.absence).map((d) => d.date));
    let total = 0;
    let done = 0;
    for (let d = start; d <= end; d = addDays(d, 1)) {
      if (!usual.has(isoWeekday(d)) || isHoliday(d)) continue;
      total++;
      if (logged.has(d) && d <= today) done++;
    }
    return { total, done };
  }, [days, today, start, end]);
  if (!total) return null;
  return (
    <div className="today-progress">
      <div className="today-bar" aria-hidden="true">
        <i style={{ width: `${Math.min(100, (100 * done) / total)}%` }} />
      </div>
      <p className="small muted">{t('today.progress', { done, total, month: fmt.month(start) })}</p>
    </div>
  );
}

/** What comes next: the pay day, days off already registered ahead, and the next holidays with what they mean for you. */
function Soon() {
  const { t, fmt, days, settings } = useApp();
  const today = todayLocal();
  const usual = useMemo(() => usualWeekdays(days, today), [days, today]);
  const items: { date: string; text: string; note: string; kind?: string }[] = [];
  // The next pay day.
  const day = settings.payDay ?? 25;
  const lastMonth = monthStart(addDays(monthStart(today), -1)).slice(0, 7);
  const payMonth = payDateFor(lastMonth, day) >= today ? lastMonth : today.slice(0, 7);
  items.push({ date: payDateFor(payMonth, day), text: fmt.date(payDateFor(payMonth, day)), note: t('today.soon.pay', { month: fmt.month(`${payMonth}-01`) }), kind: 'ok' });
  // Days off registered ahead, as ranges (a weekend between keeps a range together).
  const ahead = days.filter((d) => d.date > today && d.date <= addDays(today, 90) && d.absence).sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 0; i < ahead.length; ) {
    let j = i;
    while (j + 1 < ahead.length && ahead[j + 1].absence!.type === ahead[i].absence!.type && ahead[j + 1].date <= addDays(ahead[j].date, 3)) j++;
    const from = ahead[i].date;
    const to = ahead[j].date;
    items.push({
      date: from,
      text: from === to ? fmt.date(from) : `${fmt.date(from)} – ${fmt.date(to)}`,
      note: `${t(`absence.${ahead[i].absence!.type}`)}${j > i ? ` (${t('cal.days', { n: j - i + 1 })})` : ''}`,
    });
    i = j + 1;
  }
  for (const h of upcomingHolidays(addDays(today, 1), 2)) items.push({ date: h.date, text: `${fmt.date(h.date)} · ${t(h.name as TextKey)}`, note: holidayNote(t, h, usual) });
  items.sort((a, b) => a.date.localeCompare(b.date));
  return (
    <Card title={t('today.soon')}>
      <ul className="cal-hols">
        {items.slice(0, 5).map((i) => (
          <li key={`${i.date}${i.note}`}>
            <span>{i.text}</span>
            <span className={i.kind === 'ok' ? 'ok' : 'muted'}>{i.note}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
