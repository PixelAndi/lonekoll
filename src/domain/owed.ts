import type { AgreementFinding } from './agreementCheck.ts';
import { addYears, monthEnd, type LocalDate } from './time.ts';
import type { PaySlip } from './payslip.ts';

// A rough estimate of what may be owed, in two numbers kept apart:
//  - "likely": what the slips pay below the collective agreement's own prices
//    (the agreement check) – it needs neither the settings nor the clock;
//  - "to look into": a month the slip pays less gross than calculated from the
//    log, counted only where every day is logged and the settings' wage is the
//    one the slips pay (otherwise the difference may be the app's, not the pay).
// A month is counted from one source only: a month with an agreement finding
// is left out of the second number. Amounts marked as settled are set aside;
// later lines that may have corrected something are named, not subtracted.
// Net is rough: each slip's own tax share. Amounts paid more than two years
// ago are flagged (the time limit for claims under a collective agreement).

export interface MonthComparison {
  /** The slip's period's first day. */
  month: LocalDate;
  /** Slip gross minus the calculated gross (negative: the slip pays less). */
  difference: number;
}

export interface OwedItem {
  key: string;
  source: 'agreement' | 'comparison';
  months: LocalDate[];
  amount: number;
  /** After tax, roughly (the slips' own tax share); null when no slip shows its tax. */
  net: number | null;
  /** The part paid out more than two years ago. */
  old: number;
  finding?: AgreementFinding;
}

export interface Owed {
  likely: OwedItem[];
  investigate: OwedItem[];
  settled: OwedItem[];
  likelyTotal: number;
  likelyNet: number | null;
  investigateTotal: number;
  investigateNet: number | null;
  /** Of both totals, the part older than two years. */
  old: number;
}

/** Below this a comparison difference is left out: rounding, a few minutes. */
export const LEAST_DIFFERENCE = 100;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const findingKey = (f: AgreementFinding) => `agr:${f.rule}:${f.cause ?? f.level ?? ''}:${f.months[0]}`;
export const comparisonKey = (month: LocalDate) => `cmp:${month}`;

/** The day a month's pay was paid: its slip's pay day, else the 25th of the month after. */
function paidOn(slip: PaySlip | undefined, month: LocalDate): LocalDate {
  if (slip?.payDate) return slip.payDate;
  const end = monthEnd(month);
  const [y, m] = end.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-25` : `${y}-${String(m + 1).padStart(2, '0')}-25`;
}

export function owedEstimate(findings: AgreementFinding[], comparisons: MonthComparison[], slips: PaySlip[], settled: string[], today: LocalDate): Owed {
  const slipOf = new Map(slips.filter((s) => s.periodStart).map((s) => [s.periodStart!, s]));
  // A share above 60 % is a misread figure, not a tax.
  const shareOf = (s: PaySlip | undefined) => (s?.gross && s.gross > 0 && s.tax !== undefined && s.tax >= 0 && s.tax <= s.gross * 0.6 ? s.tax / s.gross : null);
  // A month without its slip's tax takes the share over all slips that show it.
  const withTax = slips.filter((s) => shareOf(s) !== null);
  const overall = withTax.length ? withTax.reduce((a, s) => a + s.tax!, 0) / withTax.reduce((a, s) => a + s.gross!, 0) : null;
  const taxShare = (month: LocalDate) => shareOf(slipOf.get(month)) ?? overall;
  const limit = addYears(today, -2);
  const item = (key: string, source: OwedItem['source'], byMonth: Record<LocalDate, number>, finding?: AgreementFinding): OwedItem => {
    const months = Object.keys(byMonth).sort();
    let amount = 0;
    let net = 0;
    let netKnown = true;
    let old = 0;
    for (const m of months) {
      const a = byMonth[m];
      amount += a;
      const share = taxShare(m);
      if (share === null) netKnown = false;
      else net += a * (1 - share);
      if (paidOn(slipOf.get(m), m) < limit) old += a;
    }
    return {
      key,
      source,
      months,
      amount: round2(amount),
      net: netKnown ? round2(net) : null,
      old: round2(old),
      finding,
    };
  };

  const fromAgreement = findings.map((f) => item(findingKey(f), 'agreement', f.byMonth, f));
  const agreementMonths = new Set(findings.flatMap((f) => f.months));
  const fromComparison = comparisons
    .filter((c) => c.difference <= -LEAST_DIFFERENCE && !agreementMonths.has(c.month))
    .map((c) => item(comparisonKey(c.month), 'comparison', { [c.month]: -c.difference }));

  const isSettled = (i: OwedItem) => settled.includes(i.key);
  const likely = fromAgreement.filter((i) => !isSettled(i));
  const investigate = fromComparison.filter((i) => !isSettled(i)).sort((a, b) => a.months[0].localeCompare(b.months[0]));
  const sum = (items: OwedItem[]) => round2(items.reduce((s, i) => s + i.amount, 0));
  const sumNet = (items: OwedItem[]) => (items.some((i) => i.net === null) ? null : round2(items.reduce((s, i) => s + (i.net ?? 0), 0)));
  return {
    likely,
    investigate,
    settled: [...fromAgreement, ...fromComparison].filter(isSettled),
    likelyTotal: sum(likely),
    likelyNet: sumNet(likely),
    investigateTotal: sum(investigate),
    investigateNet: sumNet(investigate),
    old: round2([...likely, ...investigate].reduce((s, i) => s + i.old, 0)),
  };
}
