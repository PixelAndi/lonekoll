import { calculatePeriod, type PeriodResult } from './calc.ts';
import type { Comparison, ComparisonRow } from './compare.ts';
import { isHoliday } from './holidays.ts';
import { hourlyRateOn, monthlyPayOn, type DayRecord, type Settings } from './model.ts';
import type { PaySlip } from './payslip.ts';
import { scheduledShift } from './schedule.ts';
import { addDays, isoWeekday, weekStart, type LocalDate, type LocalTime } from './time.ts';

// What to look at before a report goes to anyone: data that is missing or
// unsure, pay slip lines the app can't check, and signs that a setting
// (rather than the pay) is what differs. And how sure each row of the
// report is. The aim is a report that is right before it is shown.

export type CheckItem =
  /** The settings gave the same pay as these slips (start of their periods). */
  | { code: 'settings-matched'; months: LocalDate[] }
  | { code: 'settings-never-matched' }
  /** Almost every row differs, or by a lot: probably a setting. */
  | { code: 'settings-suspect'; amount: number }
  | { code: 'wage-rate'; slip: number; settings: number }
  /** The slip's overtime fits another limit per shift (minutes). */
  | { code: 'overtime-limit'; limit: number; match: number }
  | { code: 'missing-days'; dates: LocalDate[] }
  | { code: 'stamp-issues'; dates: LocalDate[] }
  | { code: 'doubts'; times: StampRef[] }
  | { code: 'unread-lines'; lines: { text: string; amount?: number }[] }
  /** Holidays you may have been due holiday pay for, with no shift marked (no schedule). */
  | { code: 'holidays'; dates: LocalDate[] }
  | { code: 'edited'; times: (StampRef & { read: LocalTime })[] };

export interface StampRef {
  date: LocalDate;
  field: 'in' | 'out';
  time: LocalTime;
}

export type CheckLevel = 'ok' | 'info' | 'warn';

export function checkLevel(item: CheckItem): CheckLevel {
  if (item.code === 'settings-matched') return 'ok';
  if (item.code === 'settings-never-matched' || item.code === 'edited') return 'info';
  return 'warn';
}

export interface ReportCheckInput {
  slip: PaySlip;
  comparison: Comparison;
  period: PeriodResult;
  days: DayRecord[];
  settings: Settings;
  start: LocalDate;
  end: LocalDate;
  today: LocalDate;
  /** The user's other pay slips: their period and whether the calculation matched them. */
  others: { start: LocalDate; matched: boolean }[];
}

export interface ReportCheck {
  items: CheckItem[];
  /** A setting is probably wrong: saving needs the settings confirmed. */
  suspect: boolean;
  /** Anything to look at before saving. */
  warnings: boolean;
}

const MONEY_ROWS = new Set(['gross', 'net', 'tax', 'taxTable', 'otTotal', 'obTotal']);
const REVIEW: ComparisonRow['status'][] = ['diff', 'missing', 'extra', 'check'];
/** Overtime limits to try when the slip's overtime doesn't fit the user's. */
const LIMITS = [420, 450, 480, 510, 540, 555, 570, 600];
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const isHours = (unit?: string) => /^(tim|timmar|h)$/i.test(unit ?? '');

export function checkReport(input: ReportCheckInput): ReportCheck {
  const { slip, comparison, period, days, settings, start, end, today } = input;
  const items: CheckItem[] = [];
  const byDate = new Map(days.map((d) => [d.date, d]));
  const monthly = monthlyPayOn(settings, end) !== null;

  // Earlier months that matched say the settings are probably right (H).
  const matched = input.others.filter((o) => o.matched && o.start !== start).map((o) => o.start).sort();
  items.push(matched.length ? { code: 'settings-matched', months: matched.slice(-3) } : { code: 'settings-never-matched' });

  // Probably a setting (B): nearly every row differs, or by more than a tenth of the pay.
  const compared = comparison.rows.filter((r) => !MONEY_ROWS.has(r.key) && r.status !== 'info');
  const differing = compared.filter((r) => REVIEW.includes(r.status));
  const total = Math.abs(comparison.totalDifference ?? 0);
  const suspect = (differing.length >= 3 && differing.length / compared.length >= 0.6) || (!!slip.gross && total > slip.gross * 0.1);
  if (suspect) items.push({ code: 'settings-suspect', amount: round2(comparison.totalDifference ?? 0) });

  // The slip's hourly wage differs from the settings'.
  const rate = hourlyRateOn(settings, end);
  const slipRates = [...new Set(slip.lines.filter((l) => l.category === 'wage' && l.unitPrice).map((l) => l.unitPrice!))];
  if (!monthly && rate !== null && slipRates.length === 1 && Math.abs(slipRates[0] - rate) > 0.005) {
    items.push({ code: 'wage-rate', slip: slipRates[0], settings: rate });
  }

  // The slip's overtime fits another limit per shift (no schedule only).
  const slipOvertime = round2(
    slip.lines.filter((l) => ['ot50', 'ot100', 'otUnknown'].includes(l.category) && isHours(l.unit)).reduce((s, l) => s + (l.quantity ?? 0), 0),
  );
  const ourOvertime = round2((period.totals.ot50?.hours ?? 0) + (period.totals.ot100?.hours ?? 0));
  if (settings.scheduleMode !== 'fixed' && slipOvertime > 0 && Math.abs(slipOvertime - ourOvertime) > 0.1) {
    const match = LIMITS.filter((l) => l !== settings.ordinaryShiftMinutes).find((limit) => {
      const p = calculatePeriod(days, { ...settings, ordinaryShiftMinutes: limit }, start, end);
      return Math.abs((p.totals.ot50?.hours ?? 0) + (p.totals.ot100?.hours ?? 0) - slipOvertime) <= 0.1;
    });
    if (match) items.push({ code: 'overtime-limit', limit: settings.ordinaryShiftMinutes, match });
  }

  // Working days with nothing logged, and holidays with no shift marked.
  const workedDates = new Set(period.shifts.flatMap((r) => r.shift.dates));
  const usualDays = usualWeekdays(days, end);
  const isWorkday = (date: LocalDate) =>
    settings.scheduleMode === 'fixed' ? scheduledShift(settings, date, byDate.get(date)) !== null : usualDays.has(isoWeekday(date));
  const missing: LocalDate[] = [];
  const holidays: LocalDate[] = [];
  const last = end < today ? end : addDays(today, -1);
  for (let date = start; date <= last; date = addDays(date, 1)) {
    const day = byDate.get(date);
    if (workedDates.has(date) || day?.absence || !isWorkday(date)) continue;
    if (!isHoliday(date)) missing.push(date);
    else if (settings.scheduleMode !== 'fixed' && settings.supplements.holidayPay && !monthly) holidays.push(date);
  }
  if (missing.length) items.push({ code: 'missing-days', dates: missing });
  if (holidays.length) items.push({ code: 'holidays', dates: holidays });

  const issueDates = [...new Set(period.issues.map((i) => i.date))];
  if (issueDates.length) items.push({ code: 'stamp-issues', dates: issueDates });

  // Times saved although the scanner was unsure, and times changed after scanning (G).
  const doubts: StampRef[] = [];
  const edited: (StampRef & { read: LocalTime })[] = [];
  for (const day of days) {
    if (day.date < start || day.date > end) continue;
    for (const row of day.rows) {
      for (const field of ['in', 'out'] as const) {
        const time = row[field];
        if (!time) continue;
        if (field === 'in' ? row.inDoubt : row.outDoubt) doubts.push({ date: day.date, field, time });
        const read = field === 'in' ? row.inRead : row.outRead;
        if (read && read !== time) edited.push({ date: day.date, field, time, read });
      }
    }
  }
  if (doubts.length) items.push({ code: 'doubts', times: doubts });

  // Pay slip lines the app can't check.
  const unread = slip.lines.filter((l) => ['other', 'obUnknown', 'otUnknown'].includes(l.category) && (l.amount ?? 0) !== 0);
  if (unread.length) items.push({ code: 'unread-lines', lines: unread.map((l) => ({ text: l.text, amount: l.amount })) });

  if (edited.length) items.push({ code: 'edited', times: edited });

  return { items, suspect, warnings: items.some((i) => checkLevel(i) === 'warn') };
}

/**
 * The weekdays someone usually works, from the last eight weeks: a weekday
 * with stamps or an absence (sick, vacation…) in at least half of the weeks.
 * Monday–Friday until there are two weeks to go by.
 */
function usualWeekdays(days: DayRecord[], end: LocalDate): Set<number> {
  const from = addDays(end, -56);
  const logged = days.filter((d) => d.date >= from && d.date <= end && (d.rows.length > 0 || d.absence));
  const weeks = new Set(logged.map((d) => weekStart(d.date)));
  if (weeks.size < 2) return new Set([1, 2, 3, 4, 5]);
  const usual = new Set<number>();
  for (let weekday = 1; weekday <= 7; weekday++) {
    const count = new Set(logged.filter((d) => isoWeekday(d.date) === weekday).map((d) => weekStart(d.date))).size;
    if (count / weeks.size >= 0.5) usual.add(weekday);
  }
  return usual;
}

/** How sure a row of the report is (D). */
export type Certainty = 'sure' | 'estimate' | 'local';

export function rowCertainty(row: ComparisonRow, period: PeriodResult, settings: Settings): Certainty | null {
  if (row.status === 'info' || MONEY_ROWS.has(row.key) || row.expected.amount === undefined) return null;
  if (row.key === 'sickPay' || row.key === 'karens') return period.sick?.days.some((d) => d.basis === 'average') ? 'estimate' : 'sure';
  // Overtime without a schedule depends on the limit per shift, which is often agreed locally.
  if ((row.key === 'ot50' || row.key === 'ot100') && settings.scheduleMode !== 'fixed') return 'local';
  // Monthly pay follows Bilaga F, which is a set of guidelines.
  if (['monthlySalary', 'sickDeduction', 'vacationDeduction', 'absenceDeduction'].includes(row.key)) return 'local';
  return 'sure';
}

/** Common, innocent reasons for a difference, to go through together (E). */
export type Explanation =
  | 'localOvertime'
  | 'komp'
  | 'nextSlip'
  | 'stamps'
  | 'wageChanged'
  | 'sickBasis'
  | 'holidayShift'
  | 'localMonthly'
  | 'followsGross'
  | 'taxTable';

export function explanations(row: ComparisonRow): Explanation[] {
  switch (row.key) {
    case 'ot50':
    case 'ot100':
    case 'otTotal':
      return ['localOvertime', 'komp', 'nextSlip'];
    case 'wage':
      return ['stamps', 'wageChanged', 'nextSlip'];
    case 'sickPay':
    case 'karens':
    case 'sickDeduction':
      return ['sickBasis', 'nextSlip'];
    case 'holidayPay':
      return ['holidayShift', 'nextSlip'];
    case 'monthlySalary':
    case 'vacationDeduction':
    case 'absenceDeduction':
      return ['localMonthly', 'nextSlip'];
    case 'tax':
    case 'net':
      return ['followsGross'];
    case 'taxTable':
      return ['taxTable'];
    default:
      return ['stamps', 'nextSlip'];
  }
}

/** A row that differs: something to go through together. */
export const needsReview = (row: ComparisonRow) => REVIEW.includes(row.status);

/** The rows the report explains (gross and net only add up the others). */
export const toReview = (row: ComparisonRow) => needsReview(row) && row.key !== 'gross' && row.key !== 'net';
