import type { Language } from './i18n.ts';
import { formatDuration, parseDate, type LocalDate } from './domain/time.ts';

// Number and date formatting for the two languages.

const LOCALES: Record<Language, string> = { sv: 'sv-SE', en: 'en-GB', pl: 'pl-PL' };
const locale = (lang: Language) => LOCALES[lang];

/** "ons 28 okt." → "Ons 28 okt." (only the first letter; Swedish months stay lower case). */
const capitalizeFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface Formatter {
  money(n: number | undefined): string;
  /** Signed, e.g. "−360,00 kr" / "+12,00 kr". */
  signedMoney(n: number | undefined): string;
  number(n: number | undefined, decimals?: number): string;
  hours(n: number | undefined): string;
  duration(minutes: number): string;
  date(date: LocalDate, style?: 'short' | 'long' | 'numeric'): string;
  month(date: LocalDate): string;
}

export function formatter(lang: Language): Formatter {
  const num = (decimals: number) =>
    new Intl.NumberFormat(locale(lang), { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const two = num(2);
  const asDate = (d: LocalDate) => {
    const { y, m, d: day } = parseDate(d);
    return new Date(Date.UTC(y, m - 1, day));
  };
  return {
    money: (n) => (n === undefined ? '–' : `${two.format(n)} kr`),
    signedMoney: (n) => (n === undefined ? '–' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${two.format(Math.abs(n))} kr`),
    number: (n, decimals = 2) => (n === undefined ? '–' : num(decimals).format(n)),
    hours: (n) => (n === undefined ? '–' : `${two.format(n)} h`),
    duration: (minutes) => formatDuration(minutes),
    date: (d, style = 'short') => {
      if (style === 'numeric') return d;
      const options: Intl.DateTimeFormatOptions =
        style === 'long'
          ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }
          : { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' };
      return capitalizeFirst(new Intl.DateTimeFormat(locale(lang), options).format(asDate(d)));
    },
    month: (d) =>
      capitalizeFirst(new Intl.DateTimeFormat(locale(lang), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(asDate(d))),
  };
}
