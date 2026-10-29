import { addDays, isoWeekday, type LocalDate } from './time.ts';

// Days the bakery supplement (Tilläggsavtal Bagerier §2) treats specially.
// "holiday" = helgdag (highest OB, 100 % overtime); "sunday" = paid as a
// Sunday (nyårsafton, midsommarafton).

export type SpecialDayKind = 'holiday' | 'sunday';

export interface SpecialDay {
  date: LocalDate;
  kind: SpecialDayKind;
  /** Key into the translations, e.g. 'holiday.christmasEve'. */
  name: string;
}

/** Easter Sunday (Gregorian), "anonymous" computus. */
export function easterSunday(year: number): LocalDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** First date from `from` (inclusive) that falls on the ISO weekday. */
function nextWeekday(from: LocalDate, weekday: number): LocalDate {
  const diff = (weekday - isoWeekday(from) + 7) % 7;
  return addDays(from, diff);
}

const cache = new Map<number, Map<LocalDate, SpecialDay>>();

export function specialDays(year: number): Map<LocalDate, SpecialDay> {
  const cached = cache.get(year);
  if (cached) return cached;
  const easter = easterSunday(year);
  const y = String(year);
  const list: SpecialDay[] = [
    { date: `${y}-01-01`, kind: 'holiday', name: 'holiday.newYearsDay' },
    { date: `${y}-01-06`, kind: 'holiday', name: 'holiday.epiphany' },
    { date: addDays(easter, -2), kind: 'holiday', name: 'holiday.goodFriday' },
    { date: easter, kind: 'holiday', name: 'holiday.easterSunday' },
    { date: addDays(easter, 1), kind: 'holiday', name: 'holiday.easterMonday' },
    { date: `${y}-05-01`, kind: 'holiday', name: 'holiday.mayDay' },
    { date: addDays(easter, 39), kind: 'holiday', name: 'holiday.ascension' },
    { date: addDays(easter, 49), kind: 'holiday', name: 'holiday.pentecost' },
    { date: `${y}-06-06`, kind: 'holiday', name: 'holiday.nationalDay' },
    { date: nextWeekday(`${y}-06-20`, 6), kind: 'holiday', name: 'holiday.midsummerDay' },
    { date: nextWeekday(`${y}-10-31`, 6), kind: 'holiday', name: 'holiday.allSaints' },
    { date: `${y}-12-24`, kind: 'holiday', name: 'holiday.christmasEve' },
    { date: `${y}-12-25`, kind: 'holiday', name: 'holiday.christmasDay' },
    { date: `${y}-12-26`, kind: 'holiday', name: 'holiday.boxingDay' },
    { date: nextWeekday(`${y}-06-19`, 5), kind: 'sunday', name: 'holiday.midsummerEve' },
    { date: `${y}-12-31`, kind: 'sunday', name: 'holiday.newYearsEve' },
  ];
  const map = new Map<LocalDate, SpecialDay>();
  // A holiday wins if two coincide (e.g. National Day on Pentecost).
  for (const day of list) if (!map.has(day.date) || day.kind === 'holiday') map.set(day.date, day);
  cache.set(year, map);
  return map;
}

export function specialDay(date: LocalDate): SpecialDay | undefined {
  return specialDays(Number(date.slice(0, 4))).get(date);
}

export function isHoliday(date: LocalDate): boolean {
  return specialDay(date)?.kind === 'holiday';
}
