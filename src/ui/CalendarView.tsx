import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { useApp } from '../app-context.ts';
import { db } from '../db.ts';
import { calculatePeriod, calculateShifts } from '../domain/calc.ts';
import { calendarDays, monthCounts, monthsOf, slipAbsences, upcomingHolidays, type CalendarDay } from '../domain/calendar.ts';
import { payDateFor } from '../domain/payday.ts';
import { usualWeekdays } from '../domain/reportCheck.ts';
import { isoWeekday, monthEnd, todayLocal } from '../domain/time.ts';
import { vacationLedger } from '../domain/vacationDays.ts';
import type { TextKey } from '../i18n.ts';
import { href, navigate } from '../router.ts';
import { Card, Fold, Page } from './common.tsx';
import { DayList, MissingLink, shiftMonth } from './DaysView.tsx';
import { useIssues } from './issues-context.tsx';
import { applyOverrides } from './slipComparison.ts';
import { stampText } from './stamps.ts';

// Kalender: the year as small squares, a month as large ones. Each day's
// colour says what it was – worked, sick, vacation, komp or other leave, a
// usual working day with nothing registered – with the public holidays
// outlined. The year highlights this month with its counts and lists the
// holidays ahead with what they mean for you; a month shows each day's hours
// and marks (OB, overtime, karens, pay day, something to check), the day
// tapped, the month's numbers, what to check, and its holidays.

/** "#/days" (this year), "#/days/2027" (a year) or "#/days/2027-05" (a month). */
export function CalendarView({ month }: { month?: string }) {
  if (month && /^\d{4}-\d{2}$/.test(month)) return <CalendarMonth month={month} />;
  const year = month && /^\d{4}$/.test(month) ? Number(month) : Number(todayLocal().slice(0, 4));
  return <CalendarYear year={year} />;
}

function useCalendar(from: string, to: string): CalendarDay[] {
  const { days, settings } = useApp();
  const today = todayLocal();
  const { results, issues } = useMemo(() => calculateShifts(days, settings), [days, settings]);
  const records = useLiveQuery(() => db.slips.toArray(), []);
  const fromSlips = useMemo(() => slipAbsences((records ?? []).map((r) => applyOverrides(r.slip, settings.codeOverrides))), [records, settings.codeOverrides]);
  return useMemo(() => calendarDays(from, to, { days, results, issues, settings, today, fromSlips }), [from, to, days, results, issues, settings, today, fromSlips]);
}

const KIND_LABEL: Record<CalendarDay['kind'], TextKey | null> = {
  worked: null,
  sick: 'cal.kind.sick',
  vacation: 'cal.kind.vacation',
  komp: 'cal.kind.komp',
  leave: 'cal.kind.leave',
  missing: 'cal.kind.missing',
  future: null,
  free: null,
};

const cellClass = (d: CalendarDay, today: string) =>
  ['cal-day', `cal-${d.kind}`, d.holiday?.kind === 'holiday' ? 'cal-holiday' : '', d.date === today ? 'cal-today' : '', d.weekend ? 'cal-weekend' : ''].filter(Boolean).join(' ');

function Legend() {
  const { t } = useApp();
  return (
    <p className="cal-legend small">
      {(['worked', 'sick', 'vacation', 'komp', 'missing'] as const).map((k) => (
        <span key={k}>
          <i className={`cal-key cal-${k}`} /> {t(`cal.legend.${k}`)}
        </span>
      ))}
      <span>
        <i className="cal-key cal-holiday" /> {t('cal.legend.holiday')}
      </span>
    </p>
  );
}

function CalendarYear({ year }: { year: number }) {
  const { t, fmt, days, settings } = useApp();
  const today = todayLocal();
  const list = useCalendar(`${year}-01-01`, `${year}-12-31`);
  const thisMonth = today.slice(0, 7);
  const focus = String(year) === today.slice(0, 4) ? thisMonth : null;
  const focusDays = focus ? list.filter((d) => d.date.startsWith(focus)) : [];
  const counts = monthCounts(focusDays);
  const period = useMemo(() => (focus ? calculatePeriod(days, settings, `${focus}-01`, monthEnd(`${focus}-01`)) : null), [focus, days, settings]);
  const obMinutes = period ? period.buckets.filter((b) => b.category.startsWith('ob')).reduce((s, b) => s + b.minutes, 0) : 0;
  const records = useLiveQuery(() => db.slips.toArray(), []);
  const ledger = useMemo(() => vacationLedger((records ?? []).map((r) => applyOverrides(r.slip, settings.codeOverrides)), settings, today), [records, settings, today]);

  return (
    <Page
      title={t('nav.calendar')}
      actions={
        <span className="cal-year-nav">
          <a href={href({ name: 'days', month: String(year - 1) })} aria-label={t('common.previous')}>
            ‹
          </a>
          <strong>{year}</strong>
          <a href={href({ name: 'days', month: String(year + 1) })} aria-label={t('common.next')}>
            ›
          </a>
        </span>
      }
    >
      {focus && (
        <Card className="cal-focus">
          <div className="cal-focus-head">
            <strong>{t('cal.thisMonth', { month: fmt.month(`${focus}-01`) })}</strong>
            <a href={href({ name: 'days', month: focus })}>{t('cal.openMonth')}</a>
          </div>
          <Counts counts={counts} />
          <p className="small muted">
            {t('cal.focusLine', { hours: fmt.duration(period?.workedMinutes ?? 0), ob: fmt.duration(obMinutes) })}
            {ledger.latest && ` · ${t('cal.vacationLeft', { paid: fmt.number(ledger.latest.paid, 0), saved: fmt.number(ledger.latest.saved, 0) })}`}
          </p>
        </Card>
      )}

      <div className="cal-year">
        {monthsOf(year).map((m) => {
          const key = m.slice(0, 7);
          const mdays = list.filter((d) => d.date.startsWith(key));
          const worked = mdays.filter((d) => d.kind === 'worked').length;
          const lead = (isoWeekday(m) + 6) % 7;
          return (
            <a key={key} href={href({ name: 'days', month: key })} className={`cal-mini ${key === focus ? 'cal-mini-now' : ''} ${key > thisMonth ? 'cal-mini-later' : ''}`}>
              <span className="cal-mini-head">
                <strong>{fmt.monthShort(m)}</strong>
                {worked > 0 && <span className="muted">{t('cal.days', { n: worked })}</span>}
              </span>
              <span className="cal-mini-grid" aria-hidden="true">
                {Array.from({ length: lead }, (_, i) => (
                  <i key={`b${i}`} />
                ))}
                {mdays.map((d) => (
                  <i key={d.date} className={cellClass(d, today)} />
                ))}
              </span>
            </a>
          );
        })}
      </div>
      <Legend />
      <UpcomingHolidays />
      <MissingLink />
    </Page>
  );
}

function Counts({ counts }: { counts: ReturnType<typeof monthCounts> }) {
  const { t } = useApp();
  return (
    <div className="cal-counts">
      <span className="cal-count cal-worked">
        <strong>{counts.worked}</strong>
        {t('cal.count.worked')}
      </span>
      <span className="cal-count cal-sick">
        <strong>{counts.sick}</strong>
        {t('cal.count.sick')}
      </span>
      <span className="cal-count cal-vacation">
        <strong>{counts.vacation}</strong>
        {t('cal.count.vacation')}
      </span>
      <span className="cal-count cal-holiday">
        <strong>{counts.holidays}</strong>
        {t('cal.count.holidays')}
      </span>
    </div>
  );
}

/** What a holiday means for you: worked (OB), not one of your days, or helglön if you're off. */
function holidayNote(t: ReturnType<typeof useApp>['t'], h: { date: string; kind: 'holiday' | 'sunday' }, usual: Set<number>, day?: CalendarDay): string {
  if (h.kind === 'sunday') return day?.kind === 'worked' ? t('cal.hol.eveWorked') : t('cal.hol.eve');
  if (day?.kind === 'worked') return t('cal.hol.worked');
  if (!usual.has(isoWeekday(h.date))) return t('cal.hol.notYourDay');
  return t('cal.hol.paid');
}

function UpcomingHolidays() {
  const { t, fmt, days } = useApp();
  const today = todayLocal();
  const usual = useMemo(() => usualWeekdays(days, today), [days, today]);
  const list = upcomingHolidays(today, 4);
  return (
    <Card title={t('cal.upcoming')}>
      <ul className="cal-hols">
        {list.map((h) => (
          <li key={h.date}>
            <span>
              {fmt.date(h.date)} · {t(h.name as TextKey)}
            </span>
            <span className="muted">{holidayNote(t, h, usual)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function CalendarMonth({ month }: { month: string }) {
  const { t, fmt, days, settings } = useApp();
  const today = todayLocal();
  const start = `${month}-01`;
  const end = monthEnd(start);
  const list = useCalendar(start, end);
  const [selected, setSelected] = useState<string | null>(today.startsWith(month) ? today : null);
  const period = useMemo(() => calculatePeriod(days, settings, start, end), [days, settings, start, end]);
  const counts = monthCounts(list);
  const sum = (prefix: string) => period.buckets.filter((b) => b.category.startsWith(prefix));
  const minutesOf = (prefix: string) => sum(prefix).reduce((s, b) => s + b.minutes, 0);
  const amountOf = (prefix: string) => sum(prefix).reduce((s, b) => s + b.amount, 0);
  const usual = useMemo(() => usualWeekdays(days, end < today ? end : today), [days, end, today]);
  const slip = useLiveQuery(() => db.slips.where('periodStart').equals(start).first(), [start]);
  const { owed } = useIssues();
  const owedHere = owed ? [...owed.likely, ...owed.investigate].filter((i) => i.months.includes(start)) : [];
  const owedTotal = owedHere.reduce((s, i) => s + i.amount, 0);
  const missing = list.filter((d) => d.kind === 'missing');
  const warn = list.filter((d) => d.warn);
  const holidays = list.filter((d) => d.holiday);
  const helgPaid = (slip?.slip.lines ?? []).some((l) => l.category === 'holidayPay' && (l.quantity ?? 0) > 0);
  const lead = (isoWeekday(start) + 6) % 7;
  const year = month.slice(0, 4);

  return (
    <Page
      title={fmt.month(start)}
      actions={
        <span className="cal-year-nav">
          <a href={href({ name: 'days', month: shiftMonth(month, -1) })} aria-label={t('common.previous')}>
            ‹
          </a>
          <a href={href({ name: 'days', month: shiftMonth(month, 1) })} aria-label={t('common.next')}>
            ›
          </a>
        </span>
      }
    >
      <a className="cal-back small" href={href({ name: 'days', month: year })}>
        ‹ {year}
      </a>
      <div className="cal-chips">
        {owedHere.length > 0 ? (
          <a className="cal-chip cal-chip-warn" href={href({ name: 'issues' })}>
            {t('cal.chip.owed', { amount: fmt.money(Math.round(owedTotal)) })}
          </a>
        ) : slip ? (
          <a className="cal-chip cal-chip-ok" href={href({ name: 'slip', id: slip.id })}>
            {t('cal.chip.slip')}
          </a>
        ) : (
          end < today && <span className="cal-chip">{t('cal.chip.noSlip')}</span>
        )}
        {missing.length > 0 && <span className="cal-chip cal-chip-warn">{missing.length === 1 ? t('cal.chip.missing1') : t('cal.chip.missing', { n: missing.length })}</span>}
        {counts.vacation > 0 && <span className="cal-chip cal-chip-vacation">{counts.vacation === 1 ? t('cal.chip.vacation1') : t('cal.chip.vacation', { n: counts.vacation })}</span>}
      </div>

      <section className="card cal-month">
        <div className="cal-weekdays" aria-hidden="true">
          {[1, 2, 3, 4, 5, 6, 7].map((w) => (
            <span key={w}>{t(`weekday.${w}` as TextKey).slice(0, 3)}</span>
          ))}
        </div>
        <div className="cal-grid">
          {Array.from({ length: lead }, (_, i) => (
            <span key={`b${i}`} />
          ))}
          {list.map((d) => {
            const label = d.kind === 'worked' ? fmt.duration(d.minutes) : KIND_LABEL[d.kind] ? t(KIND_LABEL[d.kind]!) : d.holiday ? t(d.holiday.name as TextKey) : '';
            const mark = d.warn ? '!' : d.karens ? t('cal.mark.karens') : d.payDay ? t('cal.mark.pay') : d.overtime ? t('cal.mark.ot') : d.ob ? 'OB' : '';
            return (
              <button
                key={d.date}
                type="button"
                className={`${cellClass(d, today)} ${selected === d.date ? 'cal-selected' : ''} ${d.warn ? 'cal-warn' : ''}`}
                aria-pressed={selected === d.date}
                aria-label={fmt.date(d.date, 'long')}
                onClick={() => setSelected(d.date)}
              >
                <span className="cal-num">{Number(d.date.slice(8))}</span>
                <span className="cal-label">{label}</span>
                <span className="cal-mark">{mark}</span>
              </button>
            );
          })}
        </div>
        <Legend />
      </section>

      {selected && <SelectedDay day={list.find((d) => d.date === selected)!} />}

      <Card title={t('cal.numbers')}>
        <div className="cal-numbers">
          <div>
            <strong>{fmt.duration(period.workedMinutes)}</strong>
            <span className="small muted">{t('cal.num.worked', { n: period.shifts.length })}</span>
          </div>
          <div>
            <strong>≈ {fmt.money(Math.round(period.expectedGross))}</strong>
            <span className="small muted">{t('cal.num.gross', { date: fmt.date(payDateFor(month, settings.payDay ?? 25)) })}</span>
          </div>
          <div>
            <strong>{fmt.duration(minutesOf('ob'))}</strong>
            <span className="small muted">{t('cal.num.ob', { amount: fmt.money(Math.round(amountOf('ob'))) })}</span>
          </div>
          <div>
            <strong>{fmt.duration(minutesOf('ot'))}</strong>
            <span className="small muted">{t('cal.num.ot', { amount: fmt.money(Math.round(amountOf('ot'))) })}</span>
          </div>
        </div>
        <Counts counts={counts} />
        <p className="small">
          <a href={href({ name: 'month', month })}>{t('cal.fullCalc')}</a>
        </p>
      </Card>

      {(missing.length > 0 || warn.length > 0 || owedHere.length > 0) && (
        <Card title={t('cal.toCheck', { month: fmt.month(start) })} className="cal-check">
          <ul className="cal-check-list">
            {missing.length > 0 && (
              <li>
                <span>{t('cal.check.missing', { dates: missing.map((d) => fmt.date(d.date)).join(', ') })}</span>
                <a href={href({ name: 'day', date: missing[0].date })}>{t('cal.check.fill')}</a>
              </li>
            )}
            {warn.length > 0 && (
              <li>
                <span>{t('cal.check.warnDays', { dates: warn.map((d) => fmt.date(d.date)).join(', ') })}</span>
                <a href={href({ name: 'day', date: warn[0].date })}>{t('cal.check.look')}</a>
              </li>
            )}
            {owedHere.map((i) => (
              <li key={i.key}>
                <span>{i.finding ? t(`agr.rule.${i.finding.rule === 'minimum' ? `minimum.${i.finding.cause}` : i.finding.rule}` as TextKey, { level: i.finding.level ?? '', holiday: i.finding.holiday ? t(i.finding.holiday as TextKey) : '' }) : t('owed.cmpItem')}</span>
                <a href={href({ name: 'issues' })}>{t('cal.check.look')}</a>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {holidays.length > 0 && (
        <Card title={t('cal.monthHolidays')}>
          <ul className="cal-hols">
            {holidays.map((d) => {
              const missingHelg = owedHere.some((i) => i.finding?.rule === 'holidayMissing' && i.finding.from === d.date);
              const note =
                d.holiday!.kind === 'holiday' && d.kind !== 'worked' && usual.has(isoWeekday(d.date)) && d.date <= today
                  ? missingHelg
                    ? t('cal.hol.missing')
                    : slip
                      ? helgPaid
                        ? t('cal.hol.onSlip')
                        : t('cal.hol.notOnSlip')
                      : t('cal.hol.paid')
                  : holidayNote(t, { date: d.date, kind: d.holiday!.kind }, usual, d);
              return (
                <li key={d.date}>
                  <span>
                    {fmt.date(d.date)} · {t(d.holiday!.name as TextKey)}
                  </span>
                  <span className={missingHelg ? 'warn-text' : 'muted'}>{note}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Fold title={t('cal.list')}>
        <DayList month={month} />
      </Fold>
    </Page>
  );
}

/** The day tapped in the month: what was registered and what it gives, and the way to it. */
function SelectedDay({ day }: { day: CalendarDay }) {
  const { t, fmt, days } = useApp();
  const record = days.find((d) => d.date === day.date);
  return (
    <Card className="cal-selected-card">
      <div className="cal-sel-head">
        <strong>{fmt.date(day.date, 'long')}</strong>
        {day.minutes > 0 && <strong>{fmt.duration(day.minutes)}</strong>}
      </div>
      {record?.rows.length ? <p className="cal-sel-stamps">{stampText(record.rows)}</p> : null}
      <p className="cal-sel-tags small">
        {record?.absence && <span>{t(`absence.${record.absence.type}`)}</span>}
        {day.holiday && <span>{t(day.holiday.name as TextKey)}</span>}
        {day.ob && <span>OB</span>}
        {day.overtime && <span>{t('cal.tag.ot')}</span>}
        {day.karens && <span>{t('cal.tag.karens')}</span>}
        {day.warn && <span className="warn-text">{t('cal.tag.warn')}</span>}
        {(record?.photoIds.length ?? 0) > 0 && <span>{t('cal.tag.photos', { n: record!.photoIds.length })}</span>}
        {!record && day.kind !== 'future' && <span>{t('cal.tag.nothing')}</span>}
      </p>
      <button type="button" className="link-inline" onClick={() => navigate({ name: 'day', date: day.date })}>
        {record ? t('cal.openDay') : t('cal.registerDay')}
      </button>
    </Card>
  );
}
