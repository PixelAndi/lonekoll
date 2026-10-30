import { isRightToLeft, type Language } from './i18n.ts';
import { formatDuration, parseDate, type LocalDate } from './domain/time.ts';

// Number and date formatting for each language.

// Dari: the Gregorian calendar and Latin digits, as on the clock and the pay slips.
const LOCALES: Record<Language, string> = { sv: 'sv-SE', en: 'en-GB', pl: 'pl-PL', prs: 'fa-AF-u-ca-gregory-nu-latn' };
const locale = (lang: Language) => LOCALES[lang];

/**
 * Kept left to right inside right-to-left text, so "14:30–18:20" or
 * "1 234,00 kr" isn't shown back to front. Invisible, and harmless in
 * left-to-right text.
 */
export const ltr = (s: string) => `\u2066${s}\u2069`;

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
  const keep = isRightToLeft(lang) ? ltr : (s: string) => s;
  return {
    money: (n) => (n === undefined ? '–' : keep(`${two.format(n)} kr`)),
    signedMoney: (n) => (n === undefined ? '–' : keep(`${n > 0 ? '+' : n < 0 ? '−' : ''}${two.format(Math.abs(n))} kr`)),
    number: (n, decimals = 2) => (n === undefined ? '–' : keep(num(decimals).format(n))),
    hours: (n) => (n === undefined ? '–' : keep(`${two.format(n)} h`)),
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
