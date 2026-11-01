import type { DayRecord } from './model.ts';

// Which months the app has days for, from the first to now: so a month
// never scanned or logged between them is noticed (a gap in what the
// report can check).

export interface MonthCoverage {
  /** "2022-03". */
  month: string;
  /** Days with stamps or an absence. */
  days: number;
  /** A pay slip for the month was imported. */
  slip: boolean;
  /**
   * ok: has days · gap: none, between months that have · after: none, after
   * the last month that has (not yet scanned, or still going on).
   */
  status: 'ok' | 'gap' | 'after';
}

function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Every month from the first with days (or a pay slip) up to the current one. */
export function monthCoverage(days: DayRecord[], slipMonths: string[], today: string): MonthCoverage[] {
  const counts = new Map<string, number>();
  for (const d of days) if (d.rows.length || d.absence) counts.set(d.date.slice(0, 7), (counts.get(d.date.slice(0, 7)) ?? 0) + 1);
  // A slip saved without a period ("") has no month: counting it broke the Days tab.
  const slips = new Set(slipMonths.filter((m) => /^\d{4}-\d{2}$/.test(m)));
  const known = [...counts.keys(), ...slips].sort();
  if (!known.length) return [];
  const withDays = [...counts.keys()].sort();
  const lastWithDays = withDays[withDays.length - 1] ?? '';
  const end = [today.slice(0, 7), known[known.length - 1]].sort()[1];
  const out: MonthCoverage[] = [];
  for (let m = known[0]; m <= end && out.length < 600; m = nextMonth(m)) {
    const n = counts.get(m) ?? 0;
    out.push({ month: m, days: n, slip: slips.has(m), status: n ? 'ok' : m < lastWithDays ? 'gap' : 'after' });
  }
  return out;
}
