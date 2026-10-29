import { agreementFor, payShare, RULES, type ObLevel } from './agreement.ts';
import { isHoliday, specialDay } from './holidays.ts';
import { ageOn, hourlyRateOn, type DayRecord, type Settings } from './model.ts';
import { buildShifts, type Shift, type StampIssue } from './shifts.ts';
import {
  addDays,
  addYears,
  daysBetween,
  isoWeekday,
  localToUtc,
  MINUTE_MS,
  toHours,
  toMinutes,
  utcToLocal,
  weekStart,
  type LocalDate,
} from './time.ts';

// Pay categories shared by the calculation and the pay slip comparison.
export type PayCategory =
  | 'wage'
  | 'ob1'
  | 'ob2'
  | 'ob3'
  | 'ob4'
  | 'ot50'
  | 'ot100'
  | 'sickPay'
  | 'karens'
  | 'holidayPay'
  | 'permission'
  | 'timebankPay'
  | 'vacationPay';

export const OB_CATEGORY: Record<ObLevel, PayCategory> = { 1: 'ob1', 2: 'ob2', 3: 'ob3', 4: 'ob4' };

/** Minutes worked at one unit price within one category. */
export interface Bucket {
  category: PayCategory;
  /** Price per hour (à-pris). */
  rate: number;
  minutes: number;
}

export function obLevelAt(date: LocalDate, minute: number, ignoreSpecialDays = false): ObLevel | 0 {
  const special = ignoreSpecialDays ? undefined : specialDay(date);
  const wd = isoWeekday(date);
  if (special?.kind === 'holiday') return 4;
  if (special?.kind === 'sunday' || wd === 7) return 3;
  if (wd === 6) return minute < 360 ? 2 : 3;
  if (wd === 5) return minute < 360 ? 1 : minute >= 1080 ? 2 : 0;
  return minute < 360 || minute >= 1080 ? 1 : 0;
}

/** Overtime in this minute is +100 % from the start (Sunday or holiday window, Bageri §4). */
export function inFullOvertimeWindow(date: LocalDate, minute: number, ordinaryStart: number): boolean {
  const wd = isoWeekday(date);
  if ((wd === 6 && minute >= RULES.sundayWindowStartSaturday) || wd === 7 || (wd === 1 && minute < ordinaryStart)) return true;
  if (isHoliday(date)) return true;
  if (minute >= RULES.holidayWindowStartDayBefore && isHoliday(addDays(date, 1))) return true;
  return minute < ordinaryStart && isHoliday(addDays(date, -1));
}

export type ShiftWarningCode = 'no-break' | 'short-rest' | 'extra-shift' | 'no-rate' | 'no-agreement';

export interface ShiftResult {
  shift: Shift;
  startTime: string;
  endTime: string;
  obMinutes: Record<ObLevel, number>;
  overtime50: number;
  overtime100: number;
  overtimeReason: 'long-shift' | 'extra-shift' | null;
  /** Per-minute results keyed by the local date of the minute. */
  byDate: Map<LocalDate, Bucket[]>;
  /** Wage + OB + overtime, unrounded (used for averages). */
  earnings: number;
  warnings: ShiftWarningCode[];
}

function addToBucket(list: Bucket[], category: PayCategory, rate: number, minutes = 1): void {
  const b = list.find((x) => x.category === category && x.rate === rate);
  if (b) b.minutes += minutes;
  else list.push({ category, rate, minutes });
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

interface ClassifyOptions {
  extraShift: boolean;
  /** Holiday pay: OB as if the day were an ordinary weekday, no overtime. */
  asOrdinaryDay?: boolean;
}

/** Classifies every minute of a set of work intervals. */
function classify(intervals: { start: number; end: number }[], settings: Settings, opts: ClassifyOptions) {
  const ordinaryStart = toMinutes(settings.ordinaryStart);
  const byDate = new Map<LocalDate, Bucket[]>();
  const obMinutes: Record<ObLevel, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let worked = 0;
  let overtime50 = 0;
  let overtime100 = 0;
  let earnings = 0;
  let missingRate = false;
  let missingAgreement = false;
  for (const iv of intervals) {
    for (let t = iv.start; t < iv.end; t += MINUTE_MS) {
      const { date, minute } = utcToLocal(t);
      const list = byDate.get(date) ?? [];
      byDate.set(date, list);
      const rate = hourlyRateOn(settings, date);
      const period = agreementFor(date);
      if (rate === null) missingRate = true;
      if (!period) missingAgreement = true;
      const hourly = rate ?? 0;
      addToBucket(list, 'wage', hourly);
      earnings += hourly / 60;

      const overtime =
        !opts.asOrdinaryDay && (opts.extraShift || worked >= settings.ordinaryShiftMinutes);
      let level = obLevelAt(date, minute, opts.asOrdinaryDay);
      if (overtime) {
        const full =
          overtime50 + overtime100 >= RULES.overtimeFirstTierMinutes || inFullOvertimeWindow(date, minute, ordinaryStart);
        const pct = full ? RULES.overtimeHighPercent : RULES.overtimeLowPercent;
        addToBucket(list, full ? 'ot100' : 'ot50', round2(hourly * pct));
        earnings += (hourly * pct) / 60;
        if (full) overtime100++;
        else overtime50++;
        // Holiday OB is not paid on top of overtime, but holiday overtime may not
        // pay less than Sunday overtime (Bageri §2): use the Sunday OB instead.
        if (level === 4) level = 3;
      }
      if (level !== 0 && period) {
        const share = payShare(ageOn(settings, date), settings.traineeYear);
        const obRate = round2(period.ob[level] * share);
        addToBucket(list, OB_CATEGORY[level], obRate);
        obMinutes[level]++;
        earnings += obRate / 60;
      }
      worked++;
    }
  }
  return { byDate, obMinutes, overtime50, overtime100, earnings, missingRate, missingAgreement };
}

export function calculateShifts(days: DayRecord[], settings: Settings): { results: ShiftResult[]; issues: StampIssue[] } {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const { shifts, issues } = buildShifts(sorted);
  const perWeek = new Map<LocalDate, number>();
  const results: ShiftResult[] = [];
  let previousEnd: number | null = null;
  for (const shift of shifts) {
    const week = weekStart(shift.date);
    const index = (perWeek.get(week) ?? 0) + 1;
    perWeek.set(week, index);
    const extraShift = settings.maxShiftsPerWeek > 0 && index > settings.maxShiftsPerWeek;
    const c = classify(shift.intervals, settings, { extraShift });

    const warnings: ShiftWarningCode[] = [];
    if (shift.intervals.some((iv) => iv.end - iv.start > RULES.maxMinutesWithoutBreak * MINUTE_MS)) warnings.push('no-break');
    if (previousEnd !== null && shift.start - previousEnd < RULES.minDailyRestMinutes * MINUTE_MS) warnings.push('short-rest');
    if (extraShift) warnings.push('extra-shift');
    if (c.missingRate) warnings.push('no-rate');
    if (c.missingAgreement) warnings.push('no-agreement');
    previousEnd = shift.end;

    const startLocal = utcToLocal(shift.start);
    const endLocal = utcToLocal(shift.end);
    const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    results.push({
      shift,
      startTime: hhmm(startLocal.minute),
      endTime: hhmm(endLocal.minute),
      obMinutes: c.obMinutes,
      overtime50: c.overtime50,
      overtime100: c.overtime100,
      overtimeReason: c.overtime50 + c.overtime100 === 0 ? null : extraShift ? 'extra-shift' : 'long-shift',
      byDate: c.byDate,
      earnings: c.earnings,
      warnings,
    });
  }
  return { results, issues };
}

// ---------------------------------------------------------------------------
// Pay period

export interface CategoryTotal {
  hours: number;
  amount: number;
  /** Unit prices involved (several if the rate changed during the period). */
  rates: number[];
}

export interface SickDayResult {
  date: LocalDate;
  dayInSpell: number;
  basis: 'booked' | 'average' | 'none';
  lostMinutes: number;
  lostPay: number;
  sickPay: number;
}

export interface SickResult {
  days: SickDayResult[];
  sickPay: number;
  waitingDeduction: number;
  /** Weeks of logged work the averages are based on. */
  weeksUsed: number;
  averageWeekPay: number | null;
}

export type PeriodWarningCode = 'below-minimum-wage' | 'sick-beyond-14' | 'sick-no-history';

export interface PeriodWarning {
  code: PeriodWarningCode;
  date?: LocalDate;
  values?: Record<string, number | string>;
}

export interface PeriodResult {
  start: LocalDate;
  end: LocalDate;
  shifts: ShiftResult[];
  issues: StampIssue[];
  buckets: (Bucket & { hours: number; amount: number })[];
  totals: Partial<Record<PayCategory, CategoryTotal>>;
  workedMinutes: number;
  sick: SickResult | null;
  vacationDays: number;
  timebankHours: number;
  warnings: PeriodWarning[];
  expectedGross: number;
}

function addTotal(totals: PeriodResult['totals'], category: PayCategory, hours: number, amount: number, rate?: number) {
  const t = totals[category] ?? { hours: 0, amount: 0, rates: [] };
  t.hours = round2(t.hours + hours);
  t.amount = round2(t.amount + amount);
  if (rate !== undefined && !t.rates.includes(rate)) t.rates.push(rate);
  totals[category] = t;
}

function bookedInterval(date: LocalDate, start: string, end: string) {
  const endDate = toMinutes(end) <= toMinutes(start) ? addDays(date, 1) : date;
  return { start: localToUtc(date, start), end: localToUtc(endDate, end) };
}

function sumBuckets(byDate: Map<LocalDate, Bucket[]>): number {
  let total = 0;
  for (const list of byDate.values()) for (const b of list) total += (b.rate * b.minutes) / 60;
  return total;
}

/** Average earnings per shift and per week over the weeks before `before`. */
function averages(results: ShiftResult[], before: LocalDate) {
  const from = addDays(before, -7 * RULES.averageWeeks);
  const window = results.filter((r) => r.shift.date >= from && r.shift.date < before);
  if (window.length === 0) return null;
  const first = window[0].shift.date;
  const weeks = Math.min(RULES.averageWeeks, Math.max(1, Math.ceil(daysBetween(first, before) / 7)));
  const earnings = window.reduce((s, r) => s + r.earnings, 0);
  return {
    perShift: earnings / window.length,
    minutesPerShift: window.reduce((s, r) => s + r.shift.workedMinutes, 0) / window.length,
    perWeek: earnings / weeks,
    weeks,
  };
}

function calculateSick(days: DayRecord[], results: ShiftResult[], settings: Settings, start: LocalDate, end: LocalDate, warnings: PeriodWarning[]): SickResult | null {
  const sickDates = days.filter((d) => d.absence?.type === 'sick').map((d) => d.date).sort();
  if (!sickDates.some((d) => d >= start && d <= end)) return null;

  // Group sick days into spells; a relapse within 5 days continues the spell.
  const spells: LocalDate[][] = [];
  for (const date of sickDates) {
    const spell = spells[spells.length - 1];
    if (spell && daysBetween(spell[spell.length - 1], date) <= RULES.sickRelapseDays) spell.push(date);
    else spells.push([date]);
  }

  const out: SickResult = { days: [], sickPay: 0, waitingDeduction: 0, weeksUsed: 0, averageWeekPay: null };
  for (const spell of spells) {
    if (!spell.some((d) => d >= start && d <= end)) continue;
    const avg = averages(results, spell[0]);
    if (avg) {
      out.weeksUsed = avg.weeks;
      out.averageWeekPay = round2(avg.perWeek);
    }
    let spellPay = 0;
    for (const date of spell) {
      const dayInSpell = daysBetween(spell[0], date) + 1;
      if (dayInSpell > RULES.sickPayDays) {
        warnings.push({ code: 'sick-beyond-14', date });
        continue;
      }
      const absence = days.find((d) => d.date === date)?.absence;
      let basis: SickDayResult['basis'] = 'none';
      let lostPay = 0;
      let lostMinutes = 0;
      if (absence?.bookedStart && absence.bookedEnd) {
        const iv = bookedInterval(date, absence.bookedStart, absence.bookedEnd);
        lostPay = sumBuckets(classify([iv], settings, { extraShift: false }).byDate);
        lostMinutes = Math.round((iv.end - iv.start) / MINUTE_MS);
        basis = 'booked';
      } else if (avg) {
        lostPay = avg.perShift;
        lostMinutes = Math.round(avg.minutesPerShift);
        basis = 'average';
      } else {
        warnings.push({ code: 'sick-no-history', date });
      }
      const sickPay = lostPay * RULES.sickPayPercent;
      spellPay += sickPay;
      if (date >= start && date <= end) {
        out.days.push({ date, dayInSpell, basis, lostMinutes, lostPay: round2(lostPay), sickPay: round2(sickPay) });
        out.sickPay += sickPay;
      }
    }
    // The waiting-day deduction belongs to the period where the spell starts.
    if (spell[0] >= start && spell[0] <= end && avg) {
      const deduction = Math.min(avg.perWeek * RULES.sickPayPercent * RULES.waitingDayPercent, spellPay);
      out.waitingDeduction += deduction;
    }
  }
  out.sickPay = round2(out.sickPay);
  out.waitingDeduction = round2(out.waitingDeduction);
  return out;
}

function minimumWageWarnings(settings: Settings, start: LocalDate, end: LocalDate, warnings: PeriodWarning[]) {
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const rate = hourlyRateOn(settings, date);
    const period = agreementFor(date);
    if (rate === null || !period) continue;
    const age = ageOn(settings, date);
    const share = payShare(age, settings.traineeYear);
    // The higher minimum needs a year of employment after turning 18.
    let oneYear = false;
    if (settings.employedSince && (age === null || age >= 18)) {
      const adultFrom = settings.birthDate ? addYears(settings.birthDate, 18) : settings.employedSince;
      const countFrom = adultFrom > settings.employedSince ? adultFrom : settings.employedSince;
      oneYear = date >= addYears(countFrom, 1);
    }
    const minimum = round2((oneYear ? period.minimumWage.adultAfterOneYear : period.minimumWage.adult) * share);
    if (rate < minimum) {
      warnings.push({ code: 'below-minimum-wage', date, values: { rate, minimum } });
      return;
    }
  }
}

export function calculatePeriod(days: DayRecord[], settings: Settings, start: LocalDate, end: LocalDate): PeriodResult {
  const { results, issues } = calculateShifts(days, settings);
  const warnings: PeriodWarning[] = [];

  // Collect minute buckets that fall inside the period.
  const merged: Bucket[] = [];
  for (const r of results) {
    for (const [date, list] of r.byDate) {
      if (date < start || date > end) continue;
      for (const b of list) addToBucket(merged, b.category, b.rate, b.minutes);
    }
  }
  const totals: PeriodResult['totals'] = {};
  const buckets = merged
    .filter((b) => b.minutes > 0)
    .map((b) => {
      const hours = toHours(b.minutes);
      const amount = round2(hours * b.rate);
      addTotal(totals, b.category, hours, amount, b.rate);
      return { ...b, hours, amount };
    });
  const workedMinutes = merged.filter((b) => b.category === 'wage').reduce((s, b) => s + b.minutes, 0);

  const inPeriod = days.filter((d) => d.date >= start && d.date <= end);
  const sick = calculateSick(days, results, settings, start, end, warnings);
  if (sick) {
    const lostHours = toHours(sick.days.reduce((s, d) => s + d.lostMinutes, 0));
    addTotal(totals, 'sickPay', lostHours, sick.sickPay);
    if (sick.waitingDeduction) addTotal(totals, 'karens', 0, -sick.waitingDeduction);
  }

  let vacationDays = 0;
  let timebankHours = 0;
  for (const d of inPeriod) {
    const a = d.absence;
    if (!a) continue;
    const rate = hourlyRateOn(settings, d.date) ?? 0;
    if (a.type === 'vacation') vacationDays++;
    if (a.type === 'timebank' && a.hours) {
      timebankHours += a.hours;
      if (settings.timeBankRate) addTotal(totals, 'timebankPay', a.hours, round2(a.hours * settings.timeBankRate), settings.timeBankRate);
    }
    if (a.type === 'permission' && a.hours) addTotal(totals, 'permission', a.hours, round2(a.hours * rate), rate);
    if (a.type === 'holiday' && a.bookedStart && a.bookedEnd) {
      // §5.1: the hours you would have worked, with the OB the day would have had as a normal weekday.
      const iv = bookedInterval(d.date, a.bookedStart, a.bookedEnd);
      const capped = { start: iv.start, end: Math.min(iv.end, iv.start + settings.ordinaryShiftMinutes * MINUTE_MS) };
      const pay = sumBuckets(classify([capped], settings, { extraShift: false, asOrdinaryDay: true }).byDate);
      addTotal(totals, 'holidayPay', toHours((capped.end - capped.start) / MINUTE_MS), round2(pay));
    }
  }

  minimumWageWarnings(settings, start, end, warnings);

  const expectedGross = round2(Object.values(totals).reduce((s, t) => s + (t?.amount ?? 0), 0));
  return {
    start,
    end,
    shifts: results.filter((r) => [...r.byDate.keys()].some((d) => d >= start && d <= end)),
    issues: issues.filter((i) => i.date >= start && i.date <= end),
    buckets,
    totals,
    workedMinutes,
    sick,
    vacationDays,
    timebankHours,
    warnings,
    expectedGross,
  };
}
