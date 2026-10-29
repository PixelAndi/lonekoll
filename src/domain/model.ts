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

export interface DayRecord {
  date: LocalDate;
  /** Stamps exactly as the clock shows them for this calendar day. */
  rows: StampPair[];
  absence?: Absence;
  note?: string;
  photoIds: string[];
  /** Lowest OCR confidence of the last photo reading, if any. */
  ocrConfidence?: number;
  updatedAt: number;
}

export interface WagePeriod {
  from: LocalDate;
  hourly: number;
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
  /** When "ordinary working time" starts on Monday / the day after a holiday (no schedule). */
  ordinaryStart: LocalTime;
  /** Pay per hour taken from the working-time account (Bilaga C §5.3), if known. */
  timeBankRate?: number;
  /** Free text about personal deals, printed on the report. */
  localDeals: string;
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
  ordinaryStart: '06:00',
  localDeals: '',
  codeOverrides: {},
};

export function hourlyRateOn(settings: Settings, date: LocalDate): number | null {
  let rate: number | null = null;
  for (const w of [...settings.wages].sort((a, b) => a.from.localeCompare(b.from))) {
    if (w.from <= date) rate = w.hourly;
  }
  return rate;
}

export function ageOn(settings: Settings, date: LocalDate): number | null {
  if (!settings.birthDate) return null;
  const [by, bm, bd] = settings.birthDate.split('-').map(Number);
  const [y, m, d] = date.split('-').map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}
