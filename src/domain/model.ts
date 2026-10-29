import type { LocalDate, LocalTime } from './time.ts';

// What the app stores. Everything lives in the browser on the user's device.

export interface StampPair {
  in: LocalTime | null;
  out: LocalTime | null;
  /** True when typed by hand rather than read from a photo. */
  inManual?: boolean;
  outManual?: boolean;
}

export type AbsenceType = 'sick' | 'vacation' | 'timebank' | 'holiday' | 'permission' | 'unpaid';

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
  /** Everything you get per hour, including personal supplements. */
  hourly: number;
  /** Part of `hourly` that is a personal supplement (kr/h), e.g. a deal instead of förskjuten tid. */
  supplement?: number;
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
  language: 'sv' | 'en';
  name: string;
  employer: string;
  wages: WagePeriod[];
  birthDate?: LocalDate;
  employedSince?: LocalDate;
  traineeYear: 0 | 1 | 2 | 3;
  /** Employment rate in percent (100 = full time). */
  employmentPercent: number;
  /** Overtime starts after this many worked minutes in a shift. */
  ordinaryShiftMinutes: number;
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
  tax: TaxSettings;
  /** Pay slip codes the user has re-classified. */
  codeOverrides: Record<string, string>;
}

export const DEFAULT_SETTINGS: Settings = {
  language: 'sv',
  name: '',
  employer: '',
  wages: [],
  traineeYear: 0,
  employmentPercent: 100,
  ordinaryShiftMinutes: 555,
  maxShiftsPerWeek: 5,
  minOvertimeMinutes: 0,
  ordinaryStart: '06:00',
  localDeals: '',
  codeOverrides: {},
  scheduleMode: 'none',
  schedule: { startMonday: '2026-01-05', weeks: [[null, null, null, null, null, null, null]] },
  supplements: { ob: true, overtime: true, shiftedTime: true, holidayPay: true },
  shiftForm: 'none',
  tax: { mode: 'municipality', churchMember: false },
};

export function hourlyRateOn(settings: Settings, date: LocalDate): number | null {
  let rate: number | null = null;
  for (const w of [...settings.wages].sort((a, b) => a.from.localeCompare(b.from))) {
    if (w.from <= date) rate = w.hourly;
  }
  return rate;
}

/** The personal-supplement part of the hourly wage on a date. */
export function supplementOn(settings: Settings, date: LocalDate): number {
  let supplement = 0;
  for (const w of [...settings.wages].sort((a, b) => a.from.localeCompare(b.from))) {
    if (w.from <= date) supplement = w.supplement ?? 0;
  }
  return supplement;
}

export function ageOn(settings: Settings, date: LocalDate): number | null {
  if (!settings.birthDate) return null;
  const [by, bm, bd] = settings.birthDate.split('-').map(Number);
  const [y, m, d] = date.split('-').map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}
