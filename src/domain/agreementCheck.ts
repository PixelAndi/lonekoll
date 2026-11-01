import { AGREEMENT_PERIODS, agreementFor, payShare, type ObLevel } from './agreement.ts';
import { ageOn, minimumWageOn, monthlyPayOn, type Settings } from './model.ts';
import type { PaySlip, SlipLine } from './payslip.ts';
import { addDays, type LocalDate } from './time.ts';

// The pay slips checked against the collective agreement on their own – no
// clock data needed, so every month with a slip is checked: the hourly wage
// against the agreement's minimum (which rises each 1 April, and after a
// year's employment), the lowest raise at each revision (Bilaga J), and the
// prices of OB, overtime, sick pay and holiday pay against what the
// agreement and the law set. Each finding says what was paid, what is due,
// on which slips, and roughly how much it comes to.

export type FindingRule = 'minimum' | 'lowestRaise' | 'ob' | 'overtime' | 'sickPay' | 'holidayPay';

/** Why a wage is below the minimum: the step after a year's employment not given, a 1 April revision not applied, or neither. */
export type MinimumCause = 'oneYear' | 'revision' | 'below';

export interface AgreementFinding {
  rule: FindingRule;
  cause?: MinimumCause;
  /** OB level, or overtime +50 % / +100 %. */
  level?: number;
  /** The first and last slip period it was seen on (their start dates). */
  months: LocalDate[];
  /** About how much of it each month (the months' first days). */
  byMonth: Record<LocalDate, number>;
  /** When it applies from (the one-year date, the revision date, or the first slip's period). */
  from: LocalDate;
  paid: number;
  due: number;
  /** Hours paid at the lower price on these slips (summed lines prorated where the rate changed mid-month). */
  hours: number;
  /** About how much was paid too little, gross: hours × (due − paid). */
  amount: number;
  /** Hours had to be prorated (a summed line, the rate changing mid-month). */
  estimate: boolean;
  /** Lines on later slips that may have put it right: a retroactive line, or another payment. */
  corrections?: { month: LocalDate; text: string; amount: number }[];
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const HOURS = /^(tim|timmar|h)$/i;
const RETRO = /retro/i;
const monthEnd = (start: LocalDate) => {
  const [y, m] = start.split('-').map(Number);
  return `${start.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
const days = (a: LocalDate, b: LocalDate) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;

/** The hourly wage a slip pays: its wage lines' most common price (deductions and retro lines aside). */
export function slipHourlyRate(slip: PaySlip): number | undefined {
  const prices = new Map<number, number>();
  for (const l of slip.lines) {
    if (l.category !== 'wage' || !l.unitPrice || l.unitPrice < 50 || (l.quantity ?? 0) <= 0 || RETRO.test(l.text)) continue;
    prices.set(l.unitPrice, (prices.get(l.unitPrice) ?? 0) + (l.quantity ?? 0));
  }
  return [...prices].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** One finding for one slip, before slips in a row are joined. */
type Seen = Omit<AgreementFinding, 'months' | 'byMonth' | 'corrections'> & { month: LocalDate };

/** A wage line's dates: its own (a line per day), else its slip's period. */
function lineDates(l: SlipLine, slip: PaySlip): [LocalDate, LocalDate] {
  const start = slip.periodStart!;
  const end = slip.periodEnd ?? monthEnd(start);
  return l.from ? [l.from, l.to ?? l.from] : [start, end];
}

/** The wage on a slip against the minimum, line by line; a summed line whose minimum changes within its dates is prorated. */
function minimumOnSlip(slip: PaySlip, settings: Settings): Seen[] {
  const out: Seen[] = [];
  for (const l of slip.lines) {
    if (l.category !== 'wage' || !l.unitPrice || l.unitPrice < 50 || !l.quantity || l.quantity <= 0 || !HOURS.test(l.unit ?? '') || RETRO.test(l.text)) continue;
    const [from, to] = lineDates(l, slip);
    // The minimum on each day of the line: it changes on 1 April and on the one-year date.
    let short = 0;
    let shortDays = 0;
    let first: { date: LocalDate; due: number; cause: MinimumCause } | null = null;
    const total = days(from, to);
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const m = minimumWageOn(settings, d);
      if (!m || !m.known || l.unitPrice >= m.minimum - 0.005) continue;
      shortDays++;
      short = Math.max(short, m.minimum);
      if (!first) {
        // The step not given: paid at least the minimum for a first year. A revision missed: paid last period's minimum.
        const firstYear = round2(m.period.minimumWage.adult * payShare(ageOn(settings, d), settings.traineeYear));
        const before = AGREEMENT_PERIODS[AGREEMENT_PERIODS.indexOf(m.period) - 1];
        const lastYear = before && round2((m.afterOneYear ? before.minimumWage.adultAfterOneYear : before.minimumWage.adult) * payShare(ageOn(settings, d), settings.traineeYear));
        const cause: MinimumCause = m.afterOneYear && l.unitPrice >= firstYear - 0.005 ? 'oneYear' : lastYear !== undefined && l.unitPrice >= lastYear - 0.005 ? 'revision' : 'below';
        first = { date: d, due: m.minimum, cause };
      }
    }
    if (!first) continue;
    const hours = l.quantity * (shortDays / total);
    out.push({
      rule: 'minimum',
      cause: first.cause,
      month: slip.periodStart!,
      from: first.date,
      paid: l.unitPrice,
      due: short,
      hours: round2(hours),
      amount: round2(hours * (short - l.unitPrice)),
      estimate: shortDays < total && !l.from,
    });
  }
  return out;
}

/** The prices of OB, overtime, sick pay and holiday pay on a slip against the agreement and the slip's own hourly wage. */
function pricesOnSlip(slip: PaySlip, settings: Settings): Seen[] {
  const out: Seen[] = [];
  const start = slip.periodStart!;
  const end = slip.periodEnd ?? monthEnd(start);
  const rate = slipHourlyRate(slip);
  const period = agreementFor(end);
  const share = payShare(ageOn(settings, end), settings.traineeYear);
  const monthly = monthlyPayOn(settings, end) !== null;
  const add = (rule: FindingRule, l: SlipLine, due: number, level?: number) => {
    const paid = l.unitPrice!;
    if (paid >= due - 0.01) return;
    const hours = l.quantity!;
    out.push({ rule, level, month: start, from: start, paid, due: round2(due), hours, amount: round2(hours * (due - paid)), estimate: false });
  };
  for (const l of slip.lines) {
    if (!l.unitPrice || !l.quantity || l.quantity <= 0 || !HOURS.test(l.unit ?? '')) continue;
    const ob = /^ob([1-4])$/.exec(l.category);
    if (ob && period) add('ob', l, period.ob[Number(ob[1]) as ObLevel] * share, Number(ob[1]));
    if (monthly || rate === undefined) continue;
    // Hourly pay: the supplement alone is on the line (the hour itself is on the wage lines).
    if (l.category === 'ot50') add('overtime', l, rate * 0.5, 50);
    if (l.category === 'ot100') add('overtime', l, rate, 100);
    // Sjuklönelagen §6: 80 % of the pay the hour would have given.
    if (l.category === 'sickPay') add('sickPay', l, rate * 0.8);
    if (l.category === 'holidayPay') add('holidayPay', l, rate);
  }
  return out;
}

/**
 * The lowest raise (Bilaga J) at each revision, for a wage above the minimum: the rate on the last
 * slip before the revision against the rates after it. (At the minimum, the minimum's own rise
 * applies, and a shortfall shows as below the minimum.)
 */
function lowestRaises(slips: PaySlip[], settings: Settings): Seen[] {
  const out: Seen[] = [];
  const dated = slips.filter((s) => s.periodStart).sort((a, b) => a.periodStart!.localeCompare(b.periodStart!));
  for (const p of AGREEMENT_PERIODS.slice(1)) {
    const before = [...dated].reverse().find((s) => s.periodStart! < p.from && s.periodStart! >= addDays(p.from, -62));
    const r0 = before && slipHourlyRate(before);
    if (!r0) continue;
    const old = minimumWageOn(settings, addDays(p.from, -1));
    if (!old || r0 <= old.minimum + 0.005) continue;
    const due = round2(r0 + p.minimumRaise);
    for (const s of dated.filter((x) => x.periodStart! >= p.from && x.periodStart! <= p.to)) {
      const r1 = slipHourlyRate(s);
      if (!r1) continue;
      if (r1 >= due - 0.005) break;
      // Below the new minimum too: that finding says it.
      const now = minimumWageOn(settings, s.periodStart!);
      if (now && r1 < now.minimum - 0.005) continue;
      const hours = s.lines.filter((l) => l.category === 'wage' && l.unitPrice === r1 && (l.quantity ?? 0) > 0).reduce((t, l) => t + l.quantity!, 0);
      out.push({ rule: 'lowestRaise', month: s.periodStart!, from: p.from, paid: r1, due, hours: round2(hours), amount: round2(hours * (due - r1)), estimate: false });
    }
  }
  return out;
}

/** Every finding on each slip, before slips in a row are joined. */
function allSeen(slips: PaySlip[], settings: Settings): Seen[] {
  const dated = slips.filter((s) => s.periodStart);
  return [...dated.flatMap((s) => [...minimumOnSlip(s, settings), ...pricesOnSlip(s, settings)]), ...lowestRaises(dated, settings)];
}

/**
 * Lines on later slips that may have put a finding right: a retroactive line, or a payment the
 * app can't place ("Övrig ersättning"). They are named, not counted: only the employer can say.
 */
function correctionsAfter(slips: PaySlip[], month: LocalDate, amount: number): AgreementFinding['corrections'] {
  // Small sums (a regular allowance) are left out: a correction is at least a tenth of what is owed.
  const least = Math.max(100, amount * 0.1);
  const out = slips
    .filter((s) => s.periodStart && s.periodStart > month && s.periodStart <= addDays(month, 366))
    .flatMap((s) => s.lines.filter((l) => (l.amount ?? 0) >= least && (RETRO.test(l.text) || l.category === 'other')).map((l) => ({ month: s.periodStart!, text: l.text, amount: l.amount! })))
    .sort((a, b) => a.month.localeCompare(b.month));
  return out.length ? out : undefined;
}

/** Every finding on the slips, those in a row with the same prices joined into one. */
export function checkAgainstAgreement(slips: PaySlip[], settings: Settings): AgreementFinding[] {
  const seen = allSeen(slips, settings).sort(
    (a, b) => a.rule.localeCompare(b.rule) || (a.level ?? 0) - (b.level ?? 0) || a.month.localeCompare(b.month),
  );
  const out: AgreementFinding[] = [];
  for (const s of seen) {
    const last = out[out.length - 1];
    const same = last && last.rule === s.rule && last.level === s.level && last.cause === s.cause && last.paid === s.paid && last.due === s.due;
    if (same) {
      if (!last.months.includes(s.month)) last.months.push(s.month);
      last.hours = round2(last.hours + s.hours);
      last.amount = round2(last.amount + s.amount);
      last.byMonth[s.month] = round2((last.byMonth[s.month] ?? 0) + s.amount);
      last.estimate ||= s.estimate;
    } else {
      const { month, ...rest } = s;
      out.push({ ...rest, months: [month], byMonth: { [month]: rest.amount } });
    }
  }
  for (const f of out) f.corrections = correctionsAfter(slips, f.months[f.months.length - 1], f.amount);
  return out.sort((a, b) => b.amount - a.amount);
}

/** The findings on one slip (the lowest raise needs the slips around it). */
export function slipFindings(slip: PaySlip, all: PaySlip[], settings: Settings): AgreementFinding[] {
  if (!slip.periodStart) return [];
  const own = [...minimumOnSlip(slip, settings), ...pricesOnSlip(slip, settings)];
  const around = all.includes(slip) ? all : [...all, slip];
  const raises = lowestRaises(around.filter((s) => s.periodStart), settings).filter((s) => s.month === slip.periodStart);
  return [...own, ...raises].map(({ month, ...rest }) => ({ ...rest, months: [month], byMonth: { [month]: rest.amount }, corrections: correctionsAfter(all, month, rest.amount) }));
}

/**
 * The months the check couldn't cover, from the start of the employment to the latest slip: no
 * slip for the month, or a slip whose hourly wage couldn't be read.
 */
export function uncheckedMonths(slips: PaySlip[], settings: Settings): { missing: LocalDate[]; unread: LocalDate[] } {
  const dated = slips.filter((s) => s.periodStart);
  if (!dated.length) return { missing: [], unread: [] };
  const months = new Map<string, boolean>();
  for (const s of dated) {
    const key = s.periodStart!.slice(0, 7);
    months.set(key, (months.get(key) ?? false) || slipHourlyRate(s) !== undefined || monthlyPayOn(settings, s.periodStart!) !== null);
  }
  const keys = [...months.keys()].sort();
  const first = settings.employedSince && settings.employedSince.slice(0, 7) < keys[0] ? settings.employedSince.slice(0, 7) : keys[0];
  const missing: LocalDate[] = [];
  for (let m = first; m <= keys[keys.length - 1]; m = addDays(`${m}-28`, 7).slice(0, 7)) if (!months.has(m)) missing.push(`${m}-01`);
  const unread = keys.filter((k) => !months.get(k)).map((k) => `${k}-01`);
  return { missing, unread };
}
