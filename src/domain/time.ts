// Dates and clock times as the clock and the pay slip show them: local
// Swedish wall time. Durations are measured on real (UTC) time so a night
// shift over a daylight-saving change gets its real length.

/** 'YYYY-MM-DD' */
export type LocalDate = string;
/** 'HH:MM' */
export type LocalTime = string;

const MINUTE = 60_000;
const DAY = 86_400_000;

export function parseDate(date: LocalDate): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d };
}

export function toMinutes(time: LocalTime): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function fromMinutes(minutes: number): LocalTime {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function dateFromUtcDay(ms: number): LocalDate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const { y, m, d } = parseDate(date);
  return dateFromUtcDay(Date.UTC(y, m - 1, d) + days * DAY);
}

/** Same calendar date n years later (string compare safe, Feb 29 kept as is). */
export function addYears(date: LocalDate, years: number): LocalDate {
  return `${Number(date.slice(0, 4)) + years}${date.slice(4)}`;
}

export function daysBetween(from: LocalDate, to: LocalDate): number {
  const a = parseDate(from);
  const b = parseDate(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / DAY);
}

/** ISO weekday: Monday = 1 … Sunday = 7. */
export function isoWeekday(date: LocalDate): number {
  const { y, m, d } = parseDate(date);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

/** Monday of the ISO week the date falls in. */
export function weekStart(date: LocalDate): LocalDate {
  return addDays(date, 1 - isoWeekday(date));
}

export function monthStart(date: LocalDate): LocalDate {
  return `${date.slice(0, 7)}-01`;
}

export function monthEnd(date: LocalDate): LocalDate {
  const { y, m } = parseDate(date);
  return dateFromUtcDay(Date.UTC(y, m, 0));
}

export function datesInRange(from: LocalDate, to: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

function lastSundayUtc(year: number, month: number): number {
  // month is 1-based; start from the last day of the month and walk back.
  const last = new Date(Date.UTC(year, month, 0));
  return Date.UTC(year, month - 1, last.getUTCDate() - last.getUTCDay());
}

/** UTC offset of Swedish time (minutes) at a given instant. EU rules: summer time 01:00 UTC last Sunday of March to 01:00 UTC last Sunday of October. */
export function stockholmOffset(utcMs: number): number {
  const year = new Date(utcMs).getUTCFullYear();
  const start = lastSundayUtc(year, 3) + 60 * MINUTE;
  const end = lastSundayUtc(year, 10) + 60 * MINUTE;
  return utcMs >= start && utcMs < end ? 120 : 60;
}

/**
 * Wall time in Sweden → UTC instant. In the repeated October hour the first
 * (summer time) occurrence is used; a time in the skipped March hour is read
 * as standard time.
 */
export function localToUtc(date: LocalDate, time: LocalTime): number {
  const { y, m, d } = parseDate(date);
  const wall = Date.UTC(y, m - 1, d) + toMinutes(time) * MINUTE;
  for (const offset of [120, 60]) {
    const candidate = wall - offset * MINUTE;
    if (stockholmOffset(candidate) === offset) return candidate;
  }
  return wall - 60 * MINUTE;
}

export interface LocalMoment {
  date: LocalDate;
  /** Minutes after local midnight, 0-1439. */
  minute: number;
}

export function utcToLocal(utcMs: number): LocalMoment {
  const wall = utcMs + stockholmOffset(utcMs) * MINUTE;
  const dayMs = Math.floor(wall / DAY) * DAY;
  return { date: dateFromUtcDay(dayMs), minute: Math.round((wall - dayMs) / MINUTE) };
}

export function todayLocal(now = Date.now()): LocalDate {
  return utcToLocal(now).date;
}

/** 545 → "9:05" */
export function formatDuration(minutes: number): string {
  const sign = minutes < 0 ? '-' : '';
  const m = Math.abs(Math.round(minutes));
  return `${sign}${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** Hours with two decimals, the way pay slips count them. */
export function toHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

export const MINUTE_MS = MINUTE;
