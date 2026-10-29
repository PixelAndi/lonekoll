import { agreementFor, payShare, RULES, type ObLevel } from './agreement.ts';
import { isHoliday, specialDay } from './holidays.ts';
import { ageOn, hourlyRateOn, minimumWageOn, supplementOn, wagePeriodOn, type DayRecord, type ScheduledShift, type Settings } from './model.ts';
import { rotationShifts, scheduledIntervals, scheduledMinutes, scheduledShift, scheduledWindow } from './schedule.ts';
import { buildShifts, type Shift, type StampIssue } from './shifts.ts';
import {
  addDays,
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
  | 'shiftedTime'
  | 'shiftForm'
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

export type ShiftWarningCode =
  | 'no-break'
  | 'short-rest'
  | 'extra-shift'
  | 'unscheduled-shift'
  | 'holiday-worked'
  | 'possible-moved-shift'
  | 'no-rate'
  | 'no-agreement';

/** Why the overtime minutes of a shift are overtime. */
export type OvertimeReason = 'long-shift' | 'extra-shift' | 'unscheduled' | 'holiday';

export interface ShiftResult {
  shift: Shift;
  startTime: string;
  endTime: string;
  /** The scheduled shift this shift was matched with (schedule mode). */
  scheduled?: { date: LocalDate; shift: ScheduledShift };
  obMinutes: Record<ObLevel, number>;
  overtime50: number;
  overtime100: number;
  overtimeReason: OvertimeReason | null;
  /** Minutes paid as förskjuten tid. */
  shiftedMinutes: number;
  /** Per-minute results keyed by the local date of the minute. */
  byDate: Map<LocalDate, Bucket[]>;
  /** Everything the shift earns, unrounded (used for averages). */
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
  /** Worked minutes of the shift that are ordinary time; the rest is overtime. */
  ordinaryMinutes: number;
  /** The scheduled window of a moved shift: ordinary minutes outside it are förskjuten tid. */
  shiftedFrom?: { start: number; end: number };
  /** Holiday pay: OB as if the day were an ordinary weekday. */
  asOrdinaryDay?: boolean;
}

/** Classifies every minute of a set of work intervals. */
function classify(intervals: { start: number; end: number }[], settings: Settings, opts: ClassifyOptions) {
  const ordinaryStart = toMinutes(settings.ordinaryStart);
  const shiftFormPercent = RULES.shiftFormPercent[settings.shiftForm] ?? 0;
  const byDate = new Map<LocalDate, Bucket[]>();
  const obMinutes: Record<ObLevel, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let worked = 0;
  let overtime50 = 0;
  let overtime100 = 0;
  let shifted = 0;
  let earnings = 0;
  let missingRate = false;
  let missingAgreement = false;
  let rateDate = '';
  let rate: number | null = null;
  for (const iv of intervals) {
    for (let t = iv.start; t < iv.end; t += MINUTE_MS) {
      const { date, minute } = utcToLocal(t);
      const list = byDate.get(date) ?? [];
      byDate.set(date, list);
      if (date !== rateDate) {
        rate = hourlyRateOn(settings, date);
        rateDate = date;
      }
      const period = agreementFor(date);
      if (rate === null) missingRate = true;
      if (!period) missingAgreement = true;
      const hourly = rate ?? 0;
      addToBucket(list, 'wage', hourly);
      earnings += hourly / 60;

      const ordinary = worked < opts.ordinaryMinutes;
      let level = settings.supplements.ob ? obLevelAt(date, minute, opts.asOrdinaryDay) : 0;
      if (!ordinary && settings.supplements.overtime) {
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
      if (ordinary && opts.shiftedFrom && settings.supplements.shiftedTime && period && (t < opts.shiftedFrom.start || t >= opts.shiftedFrom.end)) {
        addToBucket(list, 'shiftedTime', period.shiftedTime);
        earnings += period.shiftedTime / 60;
        shifted++;
      }
      // §4.4: not paid for hours that got overtime pay.
      if (shiftFormPercent > 0 && (ordinary || !settings.supplements.overtime)) {
        const shiftRate = round2(hourly * shiftFormPercent);
        addToBucket(list, 'shiftForm', shiftRate);
        earnings += shiftRate / 60;
      }
      worked++;
    }
  }
  return { byDate, obMinutes, overtime50, overtime100, shifted, earnings, missingRate, missingAgreement };
}

/** The scheduled shift an actual shift belongs to: most overlap, else the same day's. */
function matchSchedule(shift: Shift, settings: Settings, byDate: Map<LocalDate, DayRecord>) {
  let best: { date: LocalDate; shift: ScheduledShift; overlap: number } | null = null;
  for (const date of [addDays(shift.date, -1), shift.date, addDays(shift.date, 1)]) {
    const s = scheduledShift(settings, date, byDate.get(date));
    if (!s) continue;
    const w = scheduledWindow(date, s);
    const overlap = Math.max(0, Math.min(shift.end, w.end) - Math.max(shift.start, w.start));
    if (overlap > 0 && (!best || overlap > best.overlap)) best = { date, shift: s, overlap };
  }
  if (best) return { date: best.date, shift: best.shift };
  const sameDay = scheduledShift(settings, shift.date, byDate.get(shift.date));
  return sameDay ? { date: shift.date, shift: sameDay } : null;
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function calculateShifts(days: DayRecord[], settings: Settings): { results: ShiftResult[]; issues: StampIssue[] } {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map(sorted.map((d) => [d.date, d]));
  const { shifts, issues } = buildShifts(sorted);
  const fixed = settings.scheduleMode === 'fixed';
  const perWeek = new Map<LocalDate, number>();
  const ordinaryLeft = new Map<LocalDate, number>();
  const results: ShiftResult[] = [];
  let previousEnd: number | null = null;

  for (const shift of shifts) {
    const warnings: ShiftWarningCode[] = [];
    let ordinaryMinutes = settings.ordinaryShiftMinutes;
    let reason: OvertimeReason = 'long-shift';
    let shiftedFrom: { start: number; end: number } | undefined;
    let scheduled: ShiftResult['scheduled'];

    if (fixed) {
      scheduled = matchSchedule(shift, settings, byDate) ?? undefined;
      if (!scheduled) {
        // Work on a day off is overtime from the first minute.
        ordinaryMinutes = 0;
        reason = 'unscheduled';
        warnings.push('unscheduled-shift');
      } else if (isHoliday(scheduled.date) && settings.supplements.holidayPay) {
        // §5.1: working time is reduced on a holiday; work done anyway is overtime
        // (and holiday pay is paid for the scheduled hours).
        ordinaryMinutes = 0;
        reason = 'holiday';
        warnings.push('holiday-worked');
      } else {
        const left = ordinaryLeft.get(scheduled.date) ?? scheduledMinutes(scheduled.date, scheduled.shift);
        ordinaryMinutes = left;
        ordinaryLeft.set(scheduled.date, Math.max(0, left - shift.workedMinutes));
        const window = scheduledWindow(scheduled.date, scheduled.shift);
        const moved = byDate.get(shift.date)?.shiftMoved || byDate.get(scheduled.date)?.shiftMoved;
        if (moved) shiftedFrom = window;
        else if (settings.supplements.shiftedTime && Math.abs(shift.start - window.start) >= RULES.movedShiftHintMinutes * MINUTE_MS) {
          warnings.push('possible-moved-shift');
        }
      }
    } else {
      const week = weekStart(shift.date);
      const index = (perWeek.get(week) ?? 0) + 1;
      perWeek.set(week, index);
      if (settings.maxShiftsPerWeek > 0 && index > settings.maxShiftsPerWeek) {
        ordinaryMinutes = 0;
        reason = 'extra-shift';
        warnings.push('extra-shift');
      }
    }

    // A few minutes over the schedule is not overtime where a minimum applies.
    if (reason === 'long-shift' && shift.workedMinutes - ordinaryMinutes < settings.minOvertimeMinutes) ordinaryMinutes = Infinity;
    const c = classify(shift.intervals, settings, { ordinaryMinutes, shiftedFrom });
    if (shift.intervals.some((iv) => iv.end - iv.start > RULES.maxMinutesWithoutBreak * MINUTE_MS)) warnings.push('no-break');
    if (previousEnd !== null && shift.start - previousEnd < RULES.minDailyRestMinutes * MINUTE_MS) warnings.push('short-rest');
    if (c.missingRate) warnings.push('no-rate');
    if (c.missingAgreement) warnings.push('no-agreement');
    previousEnd = shift.end;

    results.push({
      shift,
      startTime: hhmm(utcToLocal(shift.start).minute),
      endTime: hhmm(utcToLocal(shift.end).minute),
      scheduled,
      obMinutes: c.obMinutes,
      overtime50: c.overtime50,
      overtime100: c.overtime100,
      overtimeReason: c.overtime50 + c.overtime100 === 0 ? null : reason,
      shiftedMinutes: c.shifted,
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
  /** booked: the shift entered on the day · schedule: from the schedule · average: recent shifts · not-scheduled: no lost pay. */
  basis: 'booked' | 'schedule' | 'average' | 'not-scheduled' | 'holiday' | 'none';
  lostMinutes: number;
  lostPay: number;
  sickPay: number;
}

export interface SickResult {
  days: SickDayResult[];
  sickPay: number;
  waitingDeduction: number;
  /** Weeks of logged work the averages are based on (0 when the schedule is used). */
  weeksUsed: number;
  averageWeekPay: number | null;
}

export type PeriodWarningCode =
  | 'below-minimum-wage'
  | 'below-minimum-wage-base'
  | 'minimum-wage-unknown'
  | 'sick-beyond-14'
  | 'sick-no-history'
  | 'scheduled-no-stamps'
  | 'holiday-pay-lost';

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
  /** Public holidays in the period that pay holiday pay. */
  holidays: { date: LocalDate; minutes: number; pay: number }[];
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

/** Pay for a shift you would have worked (sick pay, holiday pay). */
function wouldHaveEarned(intervals: { start: number; end: number }[], settings: Settings, ordinaryMinutes: number, asOrdinaryDay = false) {
  const c = classify(intervals, settings, { ordinaryMinutes, asOrdinaryDay });
  const minutes = intervals.reduce((s, iv) => s + Math.round((iv.end - iv.start) / MINUTE_MS), 0);
  return { pay: sumBuckets(c.byDate), minutes };
}

/** The first `minutes` of a set of intervals. */
function capIntervals(intervals: { start: number; end: number }[], minutes: number) {
  const out: { start: number; end: number }[] = [];
  let left = minutes * MINUTE_MS;
  for (const iv of intervals) {
    if (left <= 0) break;
    const end = Math.min(iv.end, iv.start + left);
    out.push({ start: iv.start, end });
    left -= end - iv.start;
  }
  return out;
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

/** An average week's pay from the schedule (holidays ignored). */
function scheduleWeekPay(settings: Settings): number | null {
  const shifts = rotationShifts(settings.schedule);
  const weeks = settings.schedule.weeks.length;
  if (shifts.length === 0 || weeks === 0) return null;
  const total = shifts.reduce(
    (s, { date, shift }) => s + wouldHaveEarned(scheduledIntervals(date, shift), settings, scheduledMinutes(date, shift), true).pay,
    0,
  );
  return total / weeks;
}

function calculateSick(days: DayRecord[], results: ShiftResult[], settings: Settings, start: LocalDate, end: LocalDate, warnings: PeriodWarning[]): SickResult | null {
  const sickDates = days.filter((d) => d.absence?.type === 'sick').map((d) => d.date).sort();
  if (!sickDates.some((d) => d >= start && d <= end)) return null;
  const byDate = new Map(days.map((d) => [d.date, d]));
  const fixed = settings.scheduleMode === 'fixed';

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
    const avg = fixed ? null : averages(results, spell[0]);
    const weekPay = fixed ? scheduleWeekPay(settings) : (avg?.perWeek ?? null);
    if (avg) out.weeksUsed = avg.weeks;
    if (weekPay !== null) out.averageWeekPay = round2(weekPay);
    let spellPay = 0;
    for (const date of spell) {
      const dayInSpell = daysBetween(spell[0], date) + 1;
      if (dayInSpell > RULES.sickPayDays) {
        warnings.push({ code: 'sick-beyond-14', date });
        continue;
      }
      const absence = byDate.get(date)?.absence;
      const scheduled = scheduledShift(settings, date, byDate.get(date));
      let basis: SickDayResult['basis'] = 'none';
      let lostPay = 0;
      let lostMinutes = 0;
      if (absence?.bookedStart && absence.bookedEnd) {
        const iv = bookedInterval(date, absence.bookedStart, absence.bookedEnd);
        ({ pay: lostPay, minutes: lostMinutes } = wouldHaveEarned([iv], settings, fixed ? Infinity : settings.ordinaryShiftMinutes));
        basis = 'booked';
      } else if (fixed && scheduled && isHoliday(date) && settings.supplements.holidayPay) {
        basis = 'holiday'; // paid as holiday pay instead (§5.1.3)
      } else if (fixed && scheduled) {
        const intervals = scheduledIntervals(date, scheduled);
        ({ pay: lostPay, minutes: lostMinutes } = wouldHaveEarned(intervals, settings, scheduledMinutes(date, scheduled)));
        basis = 'schedule';
      } else if (fixed) {
        basis = 'not-scheduled';
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
    if (spell[0] >= start && spell[0] <= end && weekPay !== null) {
      out.waitingDeduction += Math.min(weekPay * RULES.sickPayPercent * RULES.waitingDayPercent, spellPay);
    }
  }
  out.sickPay = round2(out.sickPay);
  out.waitingDeduction = round2(out.waitingDeduction);
  return out;
}

function minimumWageWarnings(settings: Settings, start: LocalDate, end: LocalDate, warnings: PeriodWarning[]) {
  let checked = false;
  let unknownWarned = false;
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const rate = hourlyRateOn(settings, date);
    const m = minimumWageOn(settings, date);
    if (rate === null || !m) continue;
    if (!m.known) {
      // A wage tied to the minimum needs the new agreement's figures.
      if (!unknownWarned && wagePeriodOn(settings, date)?.basis === 'minimum') {
        warnings.push({ code: 'minimum-wage-unknown', date, values: { minimum: m.minimum } });
        unknownWarned = true;
      }
      continue;
    }
    if (checked) continue;
    const minimum = m.minimum;
    const supplement = supplementOn(settings, date);
    if (rate < minimum) {
      warnings.push({ code: 'below-minimum-wage', date, values: { rate, minimum } });
      checked = true;
    } else if (supplement > 0 && rate - supplement < minimum) {
      warnings.push({ code: 'below-minimum-wage-base', date, values: { rate, base: round2(rate - supplement), supplement, minimum } });
      checked = true;
    }
  }
}

export interface PeriodOptions {
  /** Days after this aren't checked for missing stamps. */
  today?: LocalDate;
}

export function calculatePeriod(days: DayRecord[], settings: Settings, start: LocalDate, end: LocalDate, options: PeriodOptions = {}): PeriodResult {
  const { results, issues } = calculateShifts(days, settings);
  const warnings: PeriodWarning[] = [];
  const byDate = new Map(days.map((d) => [d.date, d]));
  const fixed = settings.scheduleMode === 'fixed';

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

  const sick = calculateSick(days, results, settings, start, end, warnings);
  if (sick) {
    const lostHours = toHours(sick.days.reduce((s, d) => s + d.lostMinutes, 0));
    addTotal(totals, 'sickPay', lostHours, sick.sickPay);
    if (sick.waitingDeduction) addTotal(totals, 'karens', 0, -sick.waitingDeduction);
  }

  // Holiday pay (§5.1): from the schedule, or for a holiday you mark as "would have worked".
  const holidays: PeriodResult['holidays'] = [];
  const workedDates = new Set(results.flatMap((r) => r.shift.dates));
  for (let date = start; date <= end; date = addDays(date, 1)) {
    if (!settings.supplements.holidayPay || !isHoliday(date)) continue;
    const day = byDate.get(date);
    let shift: ScheduledShift | null = null;
    if (fixed) shift = scheduledShift(settings, date, day);
    else if (day?.absence?.type === 'holiday' && day.absence.bookedStart && day.absence.bookedEnd) {
      shift = { start: day.absence.bookedStart, end: day.absence.bookedEnd, breakMinutes: 0 };
    }
    if (!shift) continue;
    // No holiday pay after unexcused absence the working day before or after (§5.1.3).
    if ([addDays(date, -1), addDays(date, 1)].some((d) => byDate.get(d)?.absence?.type === 'unpaid')) {
      warnings.push({ code: 'holiday-pay-lost', date });
      continue;
    }
    // Ordinary hours only (no overtime), with the OB of an ordinary weekday.
    const minutes = Math.min(scheduledMinutes(date, shift), fixed ? Infinity : settings.ordinaryShiftMinutes);
    const { pay } = wouldHaveEarned(capIntervals(scheduledIntervals(date, shift), minutes), settings, Infinity, true);
    holidays.push({ date, minutes, pay: round2(pay) });
    addTotal(totals, 'holidayPay', toHours(minutes), round2(pay));
  }

  let vacationDays = 0;
  let timebankHours = 0;
  for (const d of days) {
    if (d.date < start || d.date > end || !d.absence) continue;
    const a = d.absence;
    const rate = hourlyRateOn(settings, d.date) ?? 0;
    if (a.type === 'vacation') vacationDays++;
    if (a.type === 'timebank' && a.hours) {
      timebankHours += a.hours;
      if (settings.timeBankRate) addTotal(totals, 'timebankPay', a.hours, round2(a.hours * settings.timeBankRate), settings.timeBankRate);
    }
    if (a.type === 'permission' && a.hours) addTotal(totals, 'permission', a.hours, round2(a.hours * rate), rate);
  }

  // Scheduled days with neither stamps nor an absence: probably a missed photo.
  if (fixed && options.today) {
    const last = end < options.today ? end : addDays(options.today, -1);
    for (let date = start; date <= last; date = addDays(date, 1)) {
      const day = byDate.get(date);
      if (scheduledShift(settings, date, day) && !workedDates.has(date) && !day?.absence && !isHoliday(date)) {
        warnings.push({ code: 'scheduled-no-stamps', date });
      }
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
    holidays,
    vacationDays,
    timebankHours,
    warnings,
    expectedGross,
  };
}
