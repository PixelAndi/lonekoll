import { RULES } from './agreement.ts';
import { hourlyRateOn, minimumWageOn, monthlyPayOn, type Settings, type WagePeriod } from './model.ts';
import type { PaySlip } from './payslip.ts';
import { paidWages, type PaidWage } from './raises.ts';
import type { LocalDate } from './time.ts';

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
 * The settings that pay what the slips pay: from each step, the minimum plus its supplement per
 * hour (a step below the minimum counts as the minimum: that is what was due), or the monthly
 * salary; steps with the same supplement one after another are one row.
 */
export function wagesFromHistory(steps: WageStep[], settings: Settings): WagePeriod[] {
  const rows: WagePeriod[] = [];
  for (const s of steps) {
    const row: WagePeriod =
      s.basis === 'monthly'
        ? { from: s.from, basis: 'monthly', monthly: s.amount, hourly: 0 }
        : !s.known
          ? { from: s.from, basis: 'fixed', hourly: s.amount }
          : {
              from: s.from,
              basis: 'minimum',
              hourly: 0,
              supplement: round2(Math.max(0, s.above)),
              supplementPer: 'hour',
            };
    const last = rows[rows.length - 1];
    const sameAsLast =
      last &&
      last.basis === row.basis &&
      (row.basis === 'monthly' ? last.monthly === row.monthly : row.basis === 'fixed' ? last.hourly === row.hourly : last.supplement === row.supplement);
    if (!sameAsLast) rows.push(row);
  }
  // From the start of the employment when the first slip is later.
  if (rows.length && settings.employedSince && settings.employedSince < rows[0].from) rows[0] = { ...rows[0], from: settings.employedSince };
  return rows;
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
