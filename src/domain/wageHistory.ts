import { RULES } from './agreement.ts';
import { hourlyRateOn, minimumWageOn, monthlyPayOn, wagePeriodOn, type Settings, type WagePeriod } from './model.ts';
import type { PaySlip } from './payslip.ts';
import { paidWages, type PaidWage } from './raises.ts';
import { addDays, type LocalDate } from './time.ts';

// The wage as the pay slips show it, step by step: each wage taken apart
// into the agreement's minimum on its dates and the part above it – the
// personal supplement ("personligt tillägg") – and each change named for
// what it was: the agreement's raise on 1 April, the step after a year's
// employment, a personal raise, a wage put right after being below the
// minimum, or a cut. From the same steps, the settings that pay what the
// slips pay: "the minimum + the supplement", so they follow every new minimum.

export interface WageStep extends PaidWage {
  /** The agreement's minimum on the step's first day (per hour, or per month × 174 h for a monthly salary). */
  minimum: number;
  /** The wage above the minimum: the personal supplement (negative: below the minimum). */
  above: number;
  /** The agreement's minimum is known on the step's first day. */
  known: boolean;
  /** Below the minimum at some point of the step (the minimum may rise within it). */
  belowMinimum: boolean;
  /** What changed from the step before. */
  change?: WageChangeParts;
}

export interface WageChangeParts {
  /** The whole change, per hour or per month. */
  amount: number;
  /** The part that is the minimum rising: on 1 April (revision) and/or after a year's employment. */
  agreement: number;
  revision: boolean;
  oneYear: boolean;
  /** The wage put up to the minimum after being below it. */
  corrected: number;
  /** The part that is the personal supplement changing. */
  personal: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The minimum for a wage of this basis on a date: per hour, or per month (174 h, Bilaga F §12). */
function minimumFor(settings: Settings, basis: PaidWage['basis'], date: LocalDate) {
  const m = minimumWageOn(settings, date);
  if (!m) return null;
  return {
    ...m,
    amount: basis === 'monthly' ? round2(m.minimum * RULES.hoursPerMonth) : m.minimum,
  };
}

export function wageHistory(slips: PaySlip[], settings: Settings): WageStep[] {
  const steps: WageStep[] = [];
  for (const p of paidWages(slips)) {
    const atStart = minimumFor(settings, p.basis, p.from);
    const atEnd = minimumFor(settings, p.basis, p.to);
    const minimum = atStart?.amount ?? 0;
    const step: WageStep = {
      ...p,
      minimum,
      known: !!atStart,
      above: round2(p.amount - minimum),
      belowMinimum: !!atStart && p.amount < Math.max(minimum, atEnd?.amount ?? 0) - 0.005,
    };
    const prev = steps[steps.length - 1];
    if (prev && prev.basis === p.basis && atStart) {
      const prevMin = minimumFor(settings, prev.basis, prev.from);
      const amount = round2(p.amount - prev.amount);
      // The minimum rose by this much; a wage left below it got only what it rose by.
      const risen = round2(minimum - prev.minimum);
      const agreement = step.above < 0 ? round2(Math.max(0, Math.min(risen, amount))) : risen;
      // The supplement is the part above the minimum; a wage below it has none.
      const personal = round2(Math.max(0, step.above) - Math.max(0, prev.above));
      // A wage below the minimum before and not after: that part of the rise put it right.
      const corrected = prev.above < 0 && step.above >= 0 ? round2(-prev.above) : 0;
      step.change = {
        amount,
        agreement,
        revision: !!prevMin && prevMin.period !== atStart.period,
        oneYear: !!prevMin && !prevMin.afterOneYear && atStart.afterOneYear && step.above >= 0,
        corrected,
        personal,
      };
    }
    steps.push(step);
  }
  return steps;
}

/**
 * A wage the slips keep paying: steps one after another with the same personal supplement above
 * the minimum (or the same monthly salary) – kept through the agreement's raises, it reads as a
 * deal between employer and employee. A step below the minimum counts as the minimum with no
 * supplement: that is what was due.
 */
export interface WagePattern {
  /** Stays the same as more slips come: its first day and its wage. */
  key: string;
  from: LocalDate;
  to: LocalDate;
  /** The settings row that pays the same. */
  row: WagePeriod;
  steps: WageStep[];
  /** Raises of the minimum the supplement was kept through. */
  revisions: number;
  /** The settings pay something else for some of it. */
  differs: boolean;
  /** The last pattern on the slips (still paid). */
  last: boolean;
}

export type WageAnswer = 'agreed' | 'disputed' | 'unsure';

function rowFor(s: WageStep): WagePeriod {
  if (s.basis === 'monthly') return { from: s.from, basis: 'monthly', monthly: s.amount, hourly: 0 };
  if (!s.known) return { from: s.from, basis: 'fixed', hourly: s.amount };
  return { from: s.from, basis: 'minimum', hourly: 0, supplement: round2(Math.max(0, s.above)), supplementPer: 'hour' };
}

const sameRow = (a: WagePeriod, b: WagePeriod) =>
  a.basis === b.basis && (a.basis === 'monthly' ? a.monthly === b.monthly : a.basis === 'fixed' ? a.hourly === b.hourly : a.supplement === b.supplement);

export function wagePatterns(steps: WageStep[], settings: Settings): WagePattern[] {
  const off = new Set(stepsNotInSettings(steps, settings));
  const out: WagePattern[] = [];
  for (const s of steps) {
    const row = rowFor(s);
    const last = out[out.length - 1];
    if (last && sameRow(last.row, row)) {
      last.steps.push(s);
      last.to = s.to;
      if (s.change?.revision) last.revisions++;
      last.differs ||= off.has(s);
    } else {
      out.push({ key: '', from: s.from, to: s.to, row, steps: [s], revisions: 0, differs: off.has(s), last: false });
    }
  }
  // From the start of the employment when the first slip is later.
  if (out.length && settings.employedSince && settings.employedSince < out[0].from) {
    out[0].from = settings.employedSince;
    out[0].row = { ...out[0].row, from: settings.employedSince };
  }
  for (const p of out) p.key = `${p.from}|${p.row.basis}|${p.row.basis === 'monthly' ? p.row.monthly : p.row.basis === 'fixed' ? p.row.hourly : p.row.supplement}`;
  if (out.length) out[out.length - 1].last = true;
  return out;
}

/** The settings that pay what the slips pay, all through. */
export function wagesFromHistory(steps: WageStep[], settings: Settings): WagePeriod[] {
  return wagePatterns(steps, settings).map((p) => p.row);
}

/**
 * The settings' wages with one pattern put in: its row from its first day; after it, the wage the
 * settings had (unless it is the last pattern, still paid).
 */
export function applyPattern(settings: Settings, p: WagePattern): WagePeriod[] {
  const after = addDays(p.to, 1);
  const before = wagePeriodOn(settings, after);
  const kept = settings.wages.filter((w) => w.from < p.from || w.from > p.to);
  const rows = [...kept, p.row];
  if (!p.last && before && !kept.some((w) => w.from === after)) rows.push({ ...before, from: after });
  return rows.sort((a, b) => a.from.localeCompare(b.from));
}

/** The pattern a date falls in, with the user's answer about it. */
export function patternOn(patterns: WagePattern[], date: LocalDate): WagePattern | undefined {
  return patterns.find((p) => p.from <= date && date <= p.to);
}

/** The steps whose wage the settings don't give (what is due: below the minimum counts as the minimum). */
export function stepsNotInSettings(steps: WageStep[], settings: Settings): WageStep[] {
  return steps.filter((s) => {
    const due = s.basis === 'monthly' ? s.amount : Math.max(s.amount, s.minimum);
    const set = (date: LocalDate) => (s.basis === 'monthly' ? (monthlyPayOn(settings, date)?.monthly ?? null) : hourlyRateOn(settings, date));
    const at = set(s.from);
    return at === null || Math.abs(at - due) > 0.005;
  });
}
