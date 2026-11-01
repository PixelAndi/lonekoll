import { AGREEMENT_PERIODS, agreementFor, payShare, RULES, type AgreementPeriod } from './agreement.ts';
import { addYears, type LocalDate, type LocalTime } from './time.ts';

// What the app stores. Everything lives in the browser on the user's device.

export interface StampPair {
  in: LocalTime | null;
  out: LocalTime | null;
  /** True when typed by hand rather than read from a photo. */
  inManual?: boolean;
  outManual?: boolean;
  /** What the scanner read, kept when the time was then changed by hand. */
  inRead?: LocalTime;
  outRead?: LocalTime;
  /** Saved as read although the scanner was unsure of it. */
  inDoubt?: boolean;
  outDoubt?: boolean;
}

export type Theme = 'auto' | 'light' | 'dark';

export type AbsenceType = 'sick' | 'vacation' | 'timebank' | 'komp' | 'holiday' | 'permission' | 'unpaid';

/** How a day's overtime is paid: in money, or as paid time off later (komptid, §4.3). */
export type OvertimeAs = 'pay' | 'komp';

/**
 * How overtime turns into komptid, by local agreement:
 * hour: each overtime hour gives an hour off, and the overtime supplement is paid in money (as in most of Livs's supplements);
 * supplement: the supplement too is taken as time, 1.5 or 2 hours off per hour, and nothing is paid.
 */
export type KompMode = 'hour' | 'supplement';

export interface Absence {
  type: AbsenceType;
  /** Hours off (time bank, permission, part days). */
  hours?: number;
  /** The shift you were booked for (sick days, public holidays). End before start = next day. */
  bookedStart?: LocalTime;
  bookedEnd?: LocalTime;
}

/** A shift in a schedule. End at or before start = ends the next day. */
export interface ScheduledShift {
  start: LocalTime;
  end: LocalTime;
  /** Unpaid break inside the shift, in minutes. */
  breakMinutes: number;
}

export interface Schedule {
  /** Monday of week 1 of the rotation. */
  startMonday: LocalDate;
  /** weeks[w][d]: d = 0 (Monday) … 6 (Sunday); null = day off. */
  weeks: (ScheduledShift | null)[][];
}

export interface DayRecord {
  date: LocalDate;
  /** Stamps exactly as the clock shows them for this calendar day. */
  rows: StampPair[];
  absence?: Absence;
  /** This day's schedule when it differs from the regular one; 'off' = day off. */
  scheduleOverride?: ScheduledShift | 'off';
  /** How this day's overtime is paid; the default is `Settings.overtimeAs`. */
  overtimeAs?: OvertimeAs;
  /** The employer moved this day's shift (förskjuten tid, Bageri §3). */
  shiftMoved?: boolean;
  note?: string;
  photoIds: string[];
  /** Lowest OCR confidence of the last photo reading, if any. */
  ocrConfidence?: number;
  updatedAt: number;
}

export interface WagePeriod {
  from: LocalDate;
  /**
   * fixed (default): `hourly` as entered · minimum: the agreement's minimum
   * wage on each date plus `supplement`, so it follows every new minimum ·
   * monthly: a monthly salary (`monthly`), paid by Bilaga F.
   */
  basis?: 'fixed' | 'minimum' | 'monthly';
  /** Everything you get per hour, including personal supplements (fixed basis). */
  hourly: number;
  /**
   * Personal supplement (kr/h), e.g. a deal instead of förskjuten tid: part of
   * `hourly` (fixed basis) or on top of the minimum wage (minimum basis).
   */
  supplement?: number;
  /** The supplement is entered per hour (default) or per month, e.g. "2 000 kr more a month". */
  supplementPer?: 'hour' | 'month';
  /** Monthly salary (monthly basis), including fixed monthly supplements (Bilaga F, Definitioner). */
  monthly?: number;
  /** Ordinary working hours per week on average (monthly basis); 40 × the employment rate if not set. */
  weeklyHours?: number;
}

/** Which agreement supplements apply to this person. */
export interface Supplements {
  ob: boolean;
  overtime: boolean;
  /** Förskjuten tid (Bageri §3); only with a schedule. */
  shiftedTime: boolean;
  holidayPay: boolean;
}

/** Skiftformstillägg (§4.4): 5.3 % for two-shift, discontinuous three-shift and permanent night work, 11.1 % for continuous three-shift. */
export type ShiftForm = 'none' | 'two-shift' | 'continuous';

export interface TaxSettings {
  /** municipality: table from where you live; table: a table number you enter; percent: a flat rate (side income, adjusted tax). */
  mode: 'municipality' | 'table' | 'percent';
  municipality?: string;
  churchMember: boolean;
  parish?: string;
  table?: number;
  percent?: number;
}

export interface Settings {
  language: 'sv' | 'en' | 'pl' | 'prs';
  /** Light or dark look; auto follows the phone. */
  theme: Theme;
  name: string;
  employer: string;
  wages: WagePeriod[];
  birthDate?: LocalDate;
  employedSince?: LocalDate;
  /** The day of the month pay is paid out (the month after the period; moved back to a banking day), or null. */
  payDay: number | null;
  traineeYear: 0 | 1 | 2 | 3;
  /** Employment rate in percent (100 = full time). */
  employmentPercent: number;
  /** Overtime starts after this many worked minutes in a shift. */
  ordinaryShiftMinutes: number;
  /** Set when the user has entered the shift length themselves. */
  ordinaryShiftChosen?: boolean;
  /** Shifts beyond this number in a Monday–Sunday week are overtime (0 = off). */
  maxShiftsPerWeek: number;
  /** Overtime shorter than this in a shift gets no overtime pay (many workplaces use 15 or 30). */
  minOvertimeMinutes: number;
  /** When "ordinary working time" starts on Monday / the day after a holiday (no schedule). */
  ordinaryStart: LocalTime;
  /** Pay per hour taken from the working-time account (Bilaga C §5.3), if known. */
  timeBankRate?: number;
  /** Free text about personal deals, printed on the report. */
  localDeals: string;
  scheduleMode: 'none' | 'fixed';
  schedule: Schedule;
  supplements: Supplements;
  shiftForm: ShiftForm;
  /** The shift form applies from this date (empty: always). */
  shiftFormFrom: LocalDate | null;
  /** The user has answered the question about permanent night work found in the stamps. */
  nightAsked: boolean;
  tax: TaxSettings;
  /** Pay slip codes the user has re-classified. */
  codeOverrides: Record<string, string>;
  /** Amounts in the owed estimate the user has marked as settled (their keys, see owed.ts). */
  settledOwed: string[];
  /** What the user said about each item in the owed estimate (see owed.ts). */
  owedResolutions: Record<string, import('./owed.ts').Resolution>;
  /** Suggested corrections the user said were not it. */
  rejectedCorrections: string[];
  /**
   * The user's answers about wages the slips keep paying (key: the pattern's, see wageHistory.ts):
   * agreed – it is the deal, set in the settings; disputed – the settings hold the deal, the slips
   * pay otherwise (a claim in the report); unsure – asked in the report.
   */
  wageAnswers: Record<string, 'agreed' | 'disputed' | 'unsure'>;
  /** Pay slips whose suggested settings the user put aside ("Not now"). */
  setupDismissed?: string[];
  /** How overtime is paid unless a day says otherwise. */
  overtimeAs: OvertimeAs;
  kompMode: KompMode;
  /** The first month of the vacation earning year (intjänandeår): 4 = 1 April–31 March, 1 = the calendar year. */
  vacationYearStartMonth: 1 | 4;
  /** Keep the pictures of scanned timecards in the app (on this device), to look up the source later. */
  keepTimecards?: boolean;
  /** Sounds in the scanners (a picture taken, a page read). */
  scanSound: boolean;
  /** Where the data is kept: on this device only (the default), or also in the user's Google Drive. */
  cloud?: CloudSettings;
}

/**
 * Saving to the user's own Google Drive. The app always works on the copy on
 * the device; Drive gets a copy in the background (when the app is open).
 */
export interface CloudSettings {
  mode: 'local' | 'drive';
  /** When to sync: each time the app is opened, every 15 or 60 minutes while it is open, or by hand. */
  interval: 'open' | '15' | '60' | 'manual';
  /** Upload pictures and PDFs only on wifi (where the phone says which network it is on). */
  wifiOnly: boolean;
  /** Days after which an original kept in Drive is replaced on the device by a small preview; null: never. */
  reduceAfterDays: number | null;
  /** The account, as Google says (shown in the settings). */
  email?: string;
  lastSync?: number;
  /** This device, so a copy written from another can be told apart and merged. */
  deviceId?: string;
}

export const DEFAULT_CLOUD: CloudSettings = { mode: 'local', interval: 'open', wifiOnly: true, reduceAfterDays: 30 };

export const DEFAULT_SETTINGS: Settings = {
  language: 'sv',
  theme: 'auto',
  name: '',
  employer: '',
  wages: [],
  payDay: 25,
  traineeYear: 0,
  employmentPercent: 100,
  ordinaryShiftMinutes: 480,
  maxShiftsPerWeek: 5,
  minOvertimeMinutes: 0,
  ordinaryStart: '06:00',
  localDeals: '',
  codeOverrides: {},
  settledOwed: [],
  owedResolutions: {},
  rejectedCorrections: [],
  wageAnswers: {},
  scheduleMode: 'none',
  schedule: { startMonday: '2026-01-05', weeks: [[null, null, null, null, null, null, null]] },
  supplements: { ob: true, overtime: true, shiftedTime: true, holidayPay: true },
  shiftForm: 'none',
  shiftFormFrom: null,
  nightAsked: false,
  tax: { mode: 'municipality', churchMember: false },
  overtimeAs: 'pay',
  kompMode: 'hour',
  vacationYearStartMonth: 4,
  keepTimecards: true,
  scanSound: true,
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The wage row in force on a date. */
export function wagePeriodOn(settings: Settings, date: LocalDate): WagePeriod | undefined {
  let found: WagePeriod | undefined;
  for (const w of [...settings.wages].sort((a, b) => a.from.localeCompare(b.from))) {
    if (w.from <= date) found = w;
  }
  return found;
}

export interface MinimumWage {
  /** kr/h, after any youth or trainee share. */
  minimum: number;
  /** The higher minimum (a year's employment after turning 18) applies. */
  afterOneYear: boolean;
  period: AgreementPeriod;
  /** False after the last agreement in the app: the last known minimum is used. */
  known: boolean;
}

/** The agreement's minimum hourly wage for this person on a date (Bageri §1). */
/** The day the higher minimum starts: a year of employment after turning 18 (null without a start date). */
export function higherMinimumFrom(settings: Settings): LocalDate | null {
  if (!settings.employedSince) return null;
  const adultFrom = settings.birthDate ? addYears(settings.birthDate, 18) : settings.employedSince;
  return addYears(adultFrom > settings.employedSince ? adultFrom : settings.employedSince, 1);
}

export function minimumWageOn(settings: Settings, date: LocalDate): MinimumWage | null {
  const last = AGREEMENT_PERIODS[AGREEMENT_PERIODS.length - 1];
  let period = agreementFor(date);
  let known = true;
  if (!period) {
    // The old terms apply until a new agreement is signed.
    if (date <= last.to) return null;
    period = last;
    known = false;
  }
  const age = ageOn(settings, date);
  // The higher minimum needs a year of employment after turning 18.
  const higherFrom = higherMinimumFrom(settings);
  const afterOneYear = higherFrom !== null && (age === null || age >= 18) && date >= higherFrom;
  const base = afterOneYear ? period.minimumWage.adultAfterOneYear : period.minimumWage.adult;
  return { minimum: round2(base * payShare(age, settings.traineeYear)), afterOneYear, period, known };
}

/** The supplement in kr/h; a monthly amount is divided by the agreement's 174 hours. */
export function hourlySupplement(w: WagePeriod): number {
  const amount = w.supplement ?? 0;
  return w.supplementPer === 'month' ? round2(amount / RULES.hoursPerMonth) : amount;
}

/** A monthly salary's pay per hour and per day (Bilaga F §1). */
export interface MonthlyPay {
  monthly: number;
  weeklyHours: number;
  /** Månadslönen × 12 / (52 × ordinary weekly hours): for overtime, sick leave and absence. */
  perHour: number;
  /** Månadslönen × 12 / 365: for longer absences. */
  perDay: number;
}

export function monthlyPayOn(settings: Settings, date: LocalDate): MonthlyPay | null {
  const w = wagePeriodOn(settings, date);
  if (w?.basis !== 'monthly' || !w.monthly) return null;
  const weeklyHours = w.weeklyHours || round2((RULES.fullTimeWeeklyHours * settings.employmentPercent) / 100);
  // For overtime a full-timer's week counts as 40 hours, also on shifts (Bilaga F §3).
  const hoursForRate = settings.employmentPercent >= 100 ? RULES.fullTimeWeeklyHours : weeklyHours;
  return {
    monthly: w.monthly,
    weeklyHours,
    perHour: round2((w.monthly * 12) / (52 * hoursForRate)),
    perDay: round2((w.monthly * 12) / 365),
  };
}

export function hourlyRateOn(settings: Settings, date: LocalDate): number | null {
  const w = wagePeriodOn(settings, date);
  if (!w) return null;
  if (w.basis === 'monthly') return monthlyPayOn(settings, date)?.perHour ?? null;
  if (w.basis !== 'minimum') return w.hourly;
  const m = minimumWageOn(settings, date);
  return m ? round2(m.minimum + hourlySupplement(w)) : null;
}

/**
 * The hourly wage to calculate with: the wage set, but never less than the
 * agreement's minimum (Bageri §1) – the agreement is a floor, so a fixed wage
 * set below it (e.g. copied from a slip that pays too little) is calculated
 * at the minimum, and the slip's lower wage shows as a difference.
 */
export function payRateOn(settings: Settings, date: LocalDate): number | null {
  const rate = hourlyRateOn(settings, date);
  const w = wagePeriodOn(settings, date);
  if (rate === null || (w?.basis ?? 'fixed') !== 'fixed') return rate;
  const m = minimumWageOn(settings, date);
  return m && m.known && m.minimum > rate ? m.minimum : rate;
}

/** The personal-supplement part of the hourly wage on a date. */
export function supplementOn(settings: Settings, date: LocalDate): number {
  const w = wagePeriodOn(settings, date);
  return w ? hourlySupplement(w) : 0;
}

export function ageOn(settings: Settings, date: LocalDate): number | null {
  if (!settings.birthDate) return null;
  const [by, bm, bd] = settings.birthDate.split('-').map(Number);
  const [y, m, d] = date.split('-').map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}
