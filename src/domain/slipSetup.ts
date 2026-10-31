import { calculatePeriod } from './calc.ts';
import { comparePeriod } from './compare.ts';
import { hourlyRateOn, monthlyPayOn, type DayRecord, type Settings } from './model.ts';
import type { PaySlip } from './payslip.ts';
import type { LocalDate } from './time.ts';

// Settings suggested from a pay slip, so a new user starts from how they are
// actually paid: the hourly wage (or monthly salary), the overtime limit the
// slip's overtime fits, OB, the tax table and the employer. Each suggestion
// says which line it comes from. Nothing changes until the user picks them.

export type Suggestion =
  | { code: 'hourly'; hourly: number; line: string }
  | { code: 'monthly'; monthly: number; line: string }
  | { code: 'overtime-limit'; minutes: number; hours: number }
  | { code: 'ob'; lines: string[] }
  | { code: 'tax-table'; table: number }
  | { code: 'employer'; employer: string };

export interface SlipSetup {
  suggestions: Suggestion[];
  /** With every suggestion applied: the difference to the slip that remains (gross). */
  remaining?: number;
}

/** Overtime limits per shift to try (minutes). */
const LIMITS = [420, 450, 480, 510, 540, 555, 570, 600];
const isHours = (unit?: string) => /^(tim|timmar|h)$/i.test(unit ?? '');
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function suggestFromSlip(slip: PaySlip, days: DayRecord[], settings: Settings, start: LocalDate, end: LocalDate): SlipSetup {
  const suggestions: Suggestion[] = [];

  // The wage: one hourly rate on the wage lines, or the monthly salary.
  const monthlyLine = slip.lines.find((l) => l.category === 'monthlySalary' && l.amount && l.amount > 0);
  const wageLines = slip.lines.filter((l) => l.category === 'wage' && l.unitPrice);
  const rates = [...new Set(wageLines.map((l) => l.unitPrice!))];
  if (monthlyLine) {
    const monthly = monthlyLine.amount!;
    if (monthlyPayOn(settings, end)?.monthly !== monthly) suggestions.push({ code: 'monthly', monthly, line: monthlyLine.text });
  } else if (rates.length === 1 && rates[0] !== hourlyRateOn(settings, end)) {
    suggestions.push({ code: 'hourly', hourly: rates[0], line: wageLines[0].text });
  }

  // The overtime limit the slip's overtime hours fit (without a schedule).
  const slipOvertime = round2(
    slip.lines.filter((l) => ['ot50', 'ot100', 'otUnknown'].includes(l.category) && isHours(l.unit)).reduce((s, l) => s + (l.quantity ?? 0), 0),
  );
  if (settings.scheduleMode !== 'fixed' && slipOvertime > 0) {
    const withWage = apply(settings, suggestions, start);
    const overtimeWith = (limit: number) => {
      const p = calculatePeriod(days, { ...withWage, ordinaryShiftMinutes: limit }, start, end);
      return (p.totals.ot50?.hours ?? 0) + (p.totals.ot100?.hours ?? 0);
    };
    const fits = (limit: number) => Math.abs(overtimeWith(limit) - slipOvertime) <= 0.1;
    if (!fits(settings.ordinaryShiftMinutes)) {
      const match = LIMITS.find(fits);
      if (match) suggestions.push({ code: 'overtime-limit', minutes: match, hours: slipOvertime });
    }
  }

  // OB on the slip while OB is switched off.
  const obLines = slip.lines.filter((l) => /^ob[1-4]$|obUnknown/.test(l.category)).map((l) => l.text);
  if (!settings.supplements.ob && obLines.length) suggestions.push({ code: 'ob', lines: [...new Set(obLines)] });

  // The tax table the employer used, when it differs.
  if (slip.taxTable && !(settings.tax.mode === 'table' && settings.tax.table === slip.taxTable)) {
    suggestions.push({ code: 'tax-table', table: slip.taxTable });
  }

  if (slip.employer && !settings.employer) suggestions.push({ code: 'employer', employer: slip.employer });

  if (suggestions.length === 0) return { suggestions };
  const applied = apply(settings, suggestions, start);
  const comparison = comparePeriod(calculatePeriod(days, applied, start, end), slip, days, applied);
  return { suggestions, remaining: comparison.totalDifference };
}

/** The settings with the chosen suggestions. A wage applies from the slip's period on. */
export function apply(settings: Settings, chosen: Suggestion[], from: LocalDate): Settings {
  let next: Settings = { ...settings };
  const wageFrom = (date: LocalDate) => {
    // Replace a wage row starting the same day, keep earlier ones.
    const others = next.wages.filter((w) => w.from !== date);
    return { others, from: next.wages.length === 0 ? '2000-01-01' : date };
  };
  for (const s of chosen) {
    switch (s.code) {
      case 'hourly': {
        const { others, from: f } = wageFrom(from);
        next = { ...next, wages: [...others, { from: f, basis: 'fixed', hourly: s.hourly }] };
        break;
      }
      case 'monthly': {
        const { others, from: f } = wageFrom(from);
        next = { ...next, wages: [...others, { from: f, basis: 'monthly', monthly: s.monthly, hourly: 0 }] };
        break;
      }
      case 'overtime-limit':
        next = { ...next, ordinaryShiftMinutes: s.minutes, ordinaryShiftChosen: true };
        break;
      case 'ob':
        next = { ...next, supplements: { ...next.supplements, ob: true } };
        break;
      case 'tax-table':
        next = { ...next, tax: { ...next.tax, mode: 'table', table: s.table } };
        break;
      case 'employer':
        next = { ...next, employer: s.employer };
        break;
    }
  }
  return next;
}
