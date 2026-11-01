import { correctionsAfter, type AgreementFinding } from './agreementCheck.ts';
import { addYears, monthEnd, type LocalDate } from './time.ts';
import type { PaySlip } from './payslip.ts';

// A rough estimate of what may be owed, in two numbers kept apart:
//  - "likely": what the slips pay below the collective agreement's own prices
//    (the agreement check) – it needs neither the settings nor the clock;
//  - "to look into": a month the slip pays less gross than calculated from the
//    log, counted only where every day is logged and the settings' wage is the
//    one the slips pay (otherwise the difference may be the app's, not the pay).
// A month is counted from one source only: a month with an agreement finding
// is left out of the second number. Later lines that may have corrected
// something are suggested, not subtracted: the user says whether a line put
// it right (then that line's amount covers it, as far as it goes – a line can
// cover more than one item, never more than its amount), marks it settled,
// or says it is no error at all (the app got it wrong). Each can be undone.
// Net is rough: each slip's own tax share. Amounts paid more than two years
// ago are flagged (the time limit for claims under a collective agreement).

export interface MonthComparison {
  /** The slip's period's first day. */
  month: LocalDate;
  /** Slip gross minus the calculated gross (negative: the slip pays less). */
  difference: number;
}

/** A later line that may have put something right. */
export interface Correction {
  month: LocalDate;
  text: string;
  amount: number;
}

/** What the user said about an item. */
export type Resolution =
  | { kind: 'settled'; date: LocalDate }
  | { kind: 'notError'; date: LocalDate }
  /** Put away by the user (e.g. too old to claim): out of the way, not counted, can be brought back. */
  | { kind: 'archived'; date: LocalDate }
  | { kind: 'linked'; date: LocalDate; line: Correction };

export interface OwedAnswers {
  resolutions: Record<string, Resolution>;
  /** Suggestions the user said were not the correction: `${item key}>${line key}`. */
  rejected: string[];
  /** Keys marked settled before resolutions existed. */
  settled?: string[];
}

export const lineKey = (c: Correction) => `${c.month}|${c.text}|${c.amount}`;
export const rejectionKey = (itemKey: string, c: Correction) => `${itemKey}>${lineKey(c)}`;

export interface OwedItem {
  key: string;
  source: 'agreement' | 'comparison';
  months: LocalDate[];
  /** What is still owed: the whole amount, less what a linked line covers. */
  amount: number;
  /** The whole amount before any linked line. */
  whole: number;
  /** The part a linked line covers. */
  covered: number;
  resolution?: Resolution;
  /** Later lines that may have put it right, still to be answered. */
  suggestions: Correction[];
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
  /** Put away by the user: not counted, kept apart. */
  archived: OwedItem[];
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

export function owedEstimate(findings: AgreementFinding[], comparisons: MonthComparison[], slips: PaySlip[], answers: OwedAnswers, today: LocalDate): Owed {
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
      whole: round2(amount),
      covered: 0,
      suggestions: [],
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

  const all = [...fromAgreement, ...fromComparison].sort((a, b) => a.months[0].localeCompare(b.months[0]));
  const resolutionOf = (key: string): Resolution | undefined =>
    answers.resolutions[key] ?? (answers.settled?.includes(key) ? { kind: 'settled', date: today } : undefined);
  // What each line has left after the items linked to it (oldest first).
  const used = new Map<string, number>();
  for (const i of all) {
    i.resolution = resolutionOf(i.key);
    if (i.resolution?.kind !== 'linked') continue;
    const line = i.resolution.line;
    const left = Math.max(0, line.amount - (used.get(lineKey(line)) ?? 0));
    i.covered = round2(Math.min(i.whole, left));
    used.set(lineKey(line), (used.get(lineKey(line)) ?? 0) + i.covered);
    scale(i, round2(i.whole - i.covered));
  }
  for (const i of all) {
    const lines = i.finding ? i.finding.corrections : correctionsAfter(slips, i.months[i.months.length - 1], i.whole);
    i.suggestions = (lines ?? []).filter(
      (c) => !answers.rejected.includes(rejectionKey(i.key, c)) && c.amount - (used.get(lineKey(c)) ?? 0) >= 1 && !(i.resolution?.kind === 'linked' && lineKey(i.resolution.line) === lineKey(c)),
    );
  }
  // Open: no answer, or a linked line that covers only part of it.
  const isOpen = (i: OwedItem) => !i.resolution || (i.resolution.kind === 'linked' && i.amount >= 1);
  const likely = fromAgreement.filter(isOpen);
  const investigate = fromComparison.filter(isOpen).sort((a, b) => a.months[0].localeCompare(b.months[0]));
  const sum = (items: OwedItem[]) => round2(items.reduce((s, i) => s + i.amount, 0));
  const sumNet = (items: OwedItem[]) => (items.some((i) => i.net === null) ? null : round2(items.reduce((s, i) => s + (i.net ?? 0), 0)));
  return {
    likely,
    investigate,
    settled: all.filter((i) => !isOpen(i) && i.resolution?.kind !== 'archived'),
    archived: all.filter((i) => i.resolution?.kind === 'archived'),
    likelyTotal: sum(likely),
    likelyNet: sumNet(likely),
    investigateTotal: sum(investigate),
    investigateNet: sumNet(investigate),
    old: round2([...likely, ...investigate].reduce((s, i) => s + i.old, 0)),
  };
}

/** An item's amounts scaled to what is still owed (net and the old part in proportion). */
function scale(i: OwedItem, amount: number) {
  const f = i.whole > 0 ? amount / i.whole : 0;
  i.amount = amount;
  if (i.net !== null) i.net = round2(i.net * f);
  i.old = round2(i.old * f);
}
