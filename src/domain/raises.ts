import { RULES } from './agreement.ts';
import { hourlyRateOn, minimumWageOn, monthlyPayOn, supplementOn, wagePeriodOn, type Settings, type WagePeriod } from './model.ts';
import type { PaySlip } from './payslip.ts';
import { monthEnd, type LocalDate } from './time.ts';

// The wage as paid, from the pay slips in order: when it changed (a raise),
// and where the settings say something else for those dates – a suggestion
// to add the wage from that date. A slip paying less than the agreement's
// minimum is not a setting to copy but something to take up: it is told
// apart. Retroactive pay ("retro") is an adjustment, not the wage: left out,
// but noted (the raise may apply from earlier than the slip shows).

export interface PaidWage {
  from: LocalDate;
  to: LocalDate;
  basis: 'hourly' | 'monthly';
  /** kr/h or kr/month. */
  amount: number;
  /** The slips it was paid on (their periods' first days). */
  slips: LocalDate[];
  /** A slip of the period had retroactive pay. */
  retro: boolean;
  /** Hours paid at this wage on the slips (hourly wage). */
  hours: number;
}

/**
 * The wage paid against a wage of "the minimum plus a supplement": how much
 * above the minimum the slip pays, against how much the settings say – per
 * hour, per normal month, and on the hours the slips paid.
 */
export interface SupplementBreakdown {
  minimum: number;
  /** kr/h above the minimum on the slips, and as set. */
  paidSupplement: number;
  setSupplement: number;
  /** The same per normal full-time month (174 h, Bilaga F §12). */
  paidPerMonth: number;
  setPerMonth: number;
  /** Slip minus settings, per hour; times the hours the slips paid. */
  perHour: number;
  onHours: number;
}

export type WageChange =
  | { kind: 'differs'; paid: PaidWage; settings: number | null; breakdown?: SupplementBreakdown }
  | { kind: 'belowMinimum'; paid: PaidWage; minimum: number };

const RETRO = /retro/i;
const same = (a: PaidWage, b: { basis: string; amount: number }) => a.basis === b.basis && Math.abs(a.amount - b.amount) < 0.005;

/** The wages paid, period by period, from the slips (wage lines' own dates where they have them). */
export function paidWages(slips: PaySlip[]): PaidWage[] {
  const parts: PaidWage[] = [];
  for (const slip of slips) {
    if (!slip.periodStart) continue;
    const start = slip.periodStart;
    const end = slip.periodEnd ?? monthEnd(start);
    const retro = slip.lines.some((l) => RETRO.test(l.text));
    const monthly = slip.lines.find((l) => l.category === 'monthlySalary' && l.amount && l.amount > 0 && !RETRO.test(l.text));
    if (monthly) {
      parts.push({ from: start, to: end, basis: 'monthly', amount: monthly.amount!, slips: [start], retro, hours: 0 });
      continue;
    }
    // Each hourly rate on the wage lines (a raise in the middle of a period shows as two, with their dates).
    const byRate = new Map<number, { from: LocalDate; to: LocalDate; hours: number }>();
    for (const l of slip.lines) {
      if (l.category !== 'wage' || !l.unitPrice || l.unitPrice < 50 || RETRO.test(l.text)) continue;
      const span = byRate.get(l.unitPrice);
      const from = l.from ?? start;
      const to = l.to ?? end;
      const hours = /^(tim|timmar|h)$/i.test(l.unit ?? '') ? (l.quantity ?? 0) : 0;
      byRate.set(
        l.unitPrice,
        span ? { from: from < span.from ? from : span.from, to: to > span.to ? to : span.to, hours: span.hours + hours } : { from, to, hours },
      );
    }
    for (const [amount, span] of byRate) parts.push({ ...span, basis: 'hourly', amount, slips: [start], retro });
  }
  parts.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  // The same wage on slips one after another is one period.
  const out: PaidWage[] = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last && same(last, p)) {
      if (p.to > last.to) last.to = p.to;
      last.slips = [...new Set([...last.slips, ...p.slips])];
      last.retro ||= p.retro;
      last.hours += p.hours;
    } else out.push({ ...p });
  }
  return out;
}

/** Where the wage paid differs from the settings: each period whose wage the settings don't have. */
export function wageChanges(paid: PaidWage[], settings: Settings): WageChange[] {
  const out: WageChange[] = [];
  for (const p of paid) {
    if (p.basis === 'hourly') {
      // At its start and its end: the minimum may rise within it (1 April, a year's employment).
      const minimum = Math.max(minimumWageOn(settings, p.from)?.minimum ?? 0, minimumWageOn(settings, p.to)?.minimum ?? 0);
      if (minimum && p.amount < minimum - 0.005) {
        out.push({ kind: 'belowMinimum', paid: p, minimum });
        continue;
      }
    }
    // As the settings have it, at the start and the end of the period (a raise set at the wrong date shows at one).
    const set = (date: LocalDate) => (p.basis === 'monthly' ? (monthlyPayOn(settings, date)?.monthly ?? null) : hourlyRateOn(settings, date));
    const atStart = set(p.from);
    const atEnd = set(p.to);
    const fits = (n: number | null) => n !== null && Math.abs(n - p.amount) < 0.005;
    if (fits(atStart) && fits(atEnd)) continue;
    const date = fits(atStart) ? p.to : p.from;
    out.push({ kind: 'differs', paid: p, settings: fits(atStart) ? atEnd : atStart, breakdown: p.basis === 'hourly' ? breakdown(settings, p, date) : undefined });
  }
  return out;
}

/** The date the wage paid is added from: its period's start (the first wage set: from the start of the employment, if earlier). */
export function paidWageFrom(settings: Settings, p: PaidWage): LocalDate {
  return settings.wages.length === 0 && settings.employedSince && settings.employedSince < p.from ? settings.employedSince : p.from;
}

/** The settings with the wage paid from the period's start (a wage row starting the same day replaced). */
export function applyPaidWage(settings: Settings, p: PaidWage): Settings {
  const from = paidWageFrom(settings, p);
  const row: WagePeriod = p.basis === 'monthly' ? { from, basis: 'monthly', monthly: p.amount, hourly: 0 } : { from, basis: 'fixed', hourly: p.amount };
  const wages = [...settings.wages.filter((w) => w.from !== from), row].sort((a, b) => a.from.localeCompare(b.from));
  return { ...settings, wages };
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** With a wage of "the minimum plus a supplement": the slip's wage taken apart the same way. */
function breakdown(settings: Settings, p: PaidWage, date: LocalDate): SupplementBreakdown | undefined {
  if (wagePeriodOn(settings, date)?.basis !== 'minimum') return undefined;
  const minimum = minimumWageOn(settings, date)?.minimum;
  if (minimum === undefined) return undefined;
  const paidSupplement = round2(p.amount - minimum);
  const setSupplement = supplementOn(settings, date);
  return {
    minimum,
    paidSupplement,
    setSupplement,
    paidPerMonth: round2(paidSupplement * RULES.hoursPerMonth),
    setPerMonth: round2(setSupplement * RULES.hoursPerMonth),
    perHour: round2(paidSupplement - setSupplement),
    onHours: round2((paidSupplement - setSupplement) * p.hours),
  };
}

/** Keep "the minimum plus a supplement", with the supplement the slips pay (per hour) from the period's start. */
export function applyPaidSupplement(settings: Settings, p: PaidWage, b: SupplementBreakdown): Settings {
  const from = p.from;
  const current = wagePeriodOn(settings, from);
  const row: WagePeriod = { ...(current ?? { hourly: 0 }), from, basis: 'minimum', supplement: b.paidSupplement, supplementPer: 'hour' };
  const wages = [...settings.wages.filter((w) => w.from !== from), row].sort((a, b) => a.from.localeCompare(b.from));
  return { ...settings, wages };
}
