import type { LocalDate } from './time.ts';

// Livsmedelsavtalet 1 april 2025 – 31 mars 2027 with Tilläggsavtal för
// Bageriföretag (Livsmedelsföretagen / Livsmedelsarbetareförbundet).
// Amounts change every 1 April, so each period has its own numbers.
// When a new agreement is signed, add a period here.

export interface AgreementPeriod {
  from: LocalDate;
  to: LocalDate;
  /** Bageri §1, kr/h. */
  minimumWage: { adult: number; adultAfterOneYear: number };
  /**
   * Bageri §2, OB kr/h per level:
   * 1: Mon–Fri 00–06, Mon–Thu 18–24 · 2: Fri 18–24, Sat 00–06 ·
   * 3: Sat 06–24, Sunday, New Year's Eve, Midsummer Eve · 4: public holiday.
   */
  ob: Record<ObLevel, number>;
  /** Bageri §3, kr/h. */
  shiftedTime: number;
  /** Bageri §5, lowest vacation pay per day (full time, ≥ 6 months employed). */
  vacationPayPerDayMin: number;
  /** Bilaga J: lowest raise per hour at the revision on `from`. */
  minimumRaise: number;
}

export type ObLevel = 1 | 2 | 3 | 4;
export const OB_LEVELS: ObLevel[] = [1, 2, 3, 4];

export const AGREEMENT_PERIODS: AgreementPeriod[] = [
  {
    from: '2025-04-01',
    to: '2026-03-31',
    minimumWage: { adult: 164.34, adultAfterOneYear: 171.25 },
    ob: { 1: 49.46, 2: 96.08, 3: 150.71, 4: 221.71 },
    shiftedTime: 36.02,
    vacationPayPerDayMin: 1739,
    minimumRaise: 2.76,
  },
  {
    from: '2026-04-01',
    to: '2027-03-31',
    minimumWage: { adult: 169.92, adultAfterOneYear: 176.83 },
    ob: { 1: 50.89, 2: 98.87, 3: 155.09, 4: 228.14 },
    shiftedTime: 37.07,
    vacationPayPerDayMin: 1789,
    minimumRaise: 2.51,
  },
];

export function agreementFor(date: LocalDate): AgreementPeriod | undefined {
  return AGREEMENT_PERIODS.find((p) => p.from <= date && date <= p.to);
}

/** Fixed rules that are the same in every period. */
export const RULES = {
  /** §3.1.2: without a local agreement a shift is at most 9 h 15 min… */
  defaultOrdinaryShiftMinutes: 555,
  /** …and at most five shifts a week. */
  defaultMaxShiftsPerWeek: 5,
  /** Bageri §4: weekday overtime is +50 % for the first two hours, then +100 %. */
  overtimeFirstTierMinutes: 120,
  overtimeLowPercent: 0.5,
  overtimeHighPercent: 1,
  /** Bageri §4: the "Sunday" for overtime runs from Saturday 11:00… */
  sundayWindowStartSaturday: 11 * 60,
  /** …and the holiday window from 18:00 the day before. */
  holidayWindowStartDayBefore: 18 * 60,
  /** Sick Pay Act §6: 80 % of lost pay, waiting-day deduction 20 % of an average week's sick pay. */
  sickPayPercent: 0.8,
  waitingDayPercent: 0.2,
  /** Sick pay from the employer covers day 1–14. */
  sickPayDays: 14,
  /** A new sick spell within 5 days continues the previous one (Sick Pay Act §7). */
  sickRelapseDays: 5,
  /** Look-back for "an average week" when there is no schedule. */
  averageWeeks: 13,
  /** §5.7: vacation pay 13.2 % of earnings in the earning year. */
  vacationPayPercent: 0.132,
  /** Working Hours Act: break after at most 5 h, 11 h daily rest. */
  maxMinutesWithoutBreak: 300,
  minDailyRestMinutes: 660,
  /** §4.4 skiftformstillägg per worked (non-overtime) hour, share of the hourly wage. */
  shiftFormPercent: { none: 0, 'two-shift': 0.053, continuous: 0.111 },
  /** Hours in a full-time month when converting between monthly and hourly pay (Bilaga F §12, Bilaga J). */
  hoursPerMonth: 174,
  /** A shift starting this far from the schedule may have been moved (förskjuten tid). */
  movedShiftHintMinutes: 30,
} as const;

/** Youth and trainee pay as a share of minimum wage and OB (Bageri §1–2). */
export function payShare(age: number | null, traineeYear: number): number {
  if (traineeYear === 1) return 0.73;
  if (traineeYear === 2) return 0.8;
  if (traineeYear === 3) return 0.87;
  if (age !== null && age < 17) return 0.63;
  if (age !== null && age < 18) return 0.65;
  return 1;
}
