import { agreementFor, RULES } from './agreement.ts';
import type { PayCategory, PeriodResult } from './calc.ts';
import { hourlyRateOn, hourlySupplement, minimumWageOn, wagePeriodOn, type DayRecord, type Settings } from './model.ts';
import type { PaySlip, SlipCategory, SlipLine } from './payslip.ts';
import { taxFor, type TaxBasis, type TaxColumn, type TaxTables } from './tax.ts';
import type { LocalDate } from './time.ts';

// Lines up the calculated pay for a period with what the pay slip says.

export type RowStatus = 'ok' | 'diff' | 'check' | 'missing' | 'extra' | 'info';

export type RowKey =
  | PayCategory
  | 'obTotal'
  | 'otTotal'
  | 'vacationDays'
  | 'timebankHours'
  | 'gross'
  | 'taxTable'
  | 'tax'
  | 'net';

export type NoteCode =
  | 'wage-deductions'
  | 'wage-rate-differs'
  | 'wage-rate-differs-minimum'
  | 'sick-base-only'
  | 'sick-estimate'
  | 'vacation-below-min'
  | 'vacation-pay-unchecked'
  | 'timebank-rate-unknown'
  | 'ob-missing-level'
  | 'gross-includes-unchecked'
  | 'tax-table-differs'
  | 'tax-percent'
  | 'tax-data-missing'
  | 'tax-not-set'
  | 'net-other-deductions';

export interface Note {
  code: NoteCode;
  values?: Record<string, number | string>;
}

export interface ComparisonRow {
  key: RowKey;
  expected: { hours?: number; amount?: number; count?: number };
  slip: { hours?: number; amount?: number; count?: number; prices: number[] };
  /** Slip minus expected: negative = the slip pays less than calculated. */
  diff: { hours?: number; amount?: number; count?: number };
  status: RowStatus;
  notes: Note[];
}

/** The log has nothing for the period, or starts after the period does. */
export type CoverageNote = { code: 'no-log' } | { code: 'log-starts-late'; date: LocalDate };

export interface Comparison {
  rows: ComparisonRow[];
  otherLines: SlipLine[];
  coverage: CoverageNote[];
  /** Slip gross minus expected gross. */
  totalDifference?: number;
  /** Slip net pay minus expected net pay (when tax can be worked out). */
  netDifference?: number;
}

/** What is needed to work out the tax: the table (or rate) and Skatteverket's tables for the pay year. */
export interface TaxContext {
  basis: TaxBasis;
  tables: TaxTables | null;
  column: TaxColumn;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const HOURS_TOLERANCE = 0.05;

interface SlipSum {
  hours: number;
  amount: number;
  count: number;
  prices: number[];
  lines: SlipLine[];
}

function sumSlip(lines: SlipLine[], categories: SlipCategory[]): SlipSum | undefined {
  const picked = lines.filter((l) => categories.includes(l.category));
  if (picked.length === 0) return undefined;
  const sum: SlipSum = { hours: 0, amount: 0, count: 0, prices: [], lines: picked };
  for (const l of picked) {
    if (l.quantity !== undefined && /^(tim|timmar|h)$/i.test(l.unit ?? '')) sum.hours = round2(sum.hours + l.quantity);
    if (l.quantity !== undefined && /^dag/i.test(l.unit ?? '')) sum.count = round2(sum.count + l.quantity);
    if (l.amount !== undefined) sum.amount = round2(sum.amount + l.amount);
    if (l.unitPrice !== undefined && !sum.prices.includes(l.unitPrice)) sum.prices.push(l.unitPrice);
  }
  return sum;
}

function moneyRow(
  key: RowKey,
  expected: { hours?: number; amount?: number } | undefined,
  slip: SlipSum | undefined,
  tolerancePerHour: number,
): ComparisonRow | null {
  if (!expected && !slip) return null;
  const row: ComparisonRow = {
    key,
    expected: expected ? { ...expected } : {},
    slip: slip ? { hours: slip.hours, amount: slip.amount, prices: slip.prices } : { prices: [] },
    diff: {},
    status: 'ok',
    notes: [],
  };
  if (!expected) {
    row.status = 'extra';
    return row;
  }
  if (!slip) {
    row.status = (expected.amount ?? 0) === 0 ? 'ok' : 'missing';
    row.diff = { hours: expected.hours !== undefined ? -expected.hours : undefined, amount: -(expected.amount ?? 0) };
    return row;
  }
  if (expected.hours !== undefined) row.diff.hours = round2(slip.hours - expected.hours);
  row.diff.amount = round2(slip.amount - (expected.amount ?? 0));
  const tolerance = 1 + HOURS_TOLERANCE * tolerancePerHour;
  const hoursOff = row.diff.hours !== undefined && Math.abs(row.diff.hours) > HOURS_TOLERANCE;
  if (hoursOff || Math.abs(row.diff.amount) > tolerance) row.status = 'diff';
  return row;
}

export function comparePeriod(period: PeriodResult, slip: PaySlip, days: DayRecord[], settings: Settings, tax?: TaxContext): Comparison {
  const rows: ComparisonRow[] = [];
  const t = period.totals;
  const lines = slip.lines;
  const hourly = hourlyRateOn(settings, period.end) ?? 0;
  const push = (row: ComparisonRow | null) => row && rows.push(row);

  // Hourly wage, with a note on dated deductions (e.g. time-bank days).
  const wage = moneyRow('wage', t.wage, sumSlip(lines, ['wage']), hourly);
  if (wage) {
    const deductions = lines.filter((l) => l.category === 'wage' && (l.quantity ?? 0) < 0);
    for (const d of deductions) {
      const day = days.find((x) => x.date === d.from);
      wage.notes.push({
        code: 'wage-deductions',
        values: { hours: -(d.quantity ?? 0), amount: -(d.amount ?? 0), date: d.from ?? '', absence: day?.absence?.type ?? '' },
      });
    }
    // A wrong hourly price is worth flagging even when few hours keep the amount small.
    const expectedRates = t.wage?.rates ?? [];
    const wrong = wage.slip.prices.filter((p) => expectedRates.length > 0 && !expectedRates.some((r) => Math.abs(r - p) < 0.005));
    if (wrong.length > 0) {
      const w = wagePeriodOn(settings, period.end);
      const m = w?.basis === 'minimum' ? minimumWageOn(settings, period.end) : null;
      wage.notes.push({
        code: m ? 'wage-rate-differs-minimum' : 'wage-rate-differs',
        values: { slip: wrong.join(' / '), expected: expectedRates.join(' / '), minimum: m?.minimum ?? 0, supplement: w ? hourlySupplement(w) : 0 },
      });
      if (wage.status === 'ok') wage.status = 'diff';
    }
    push(wage);
  }

  // OB per level, or as one total if the slip doesn't say which level.
  const obCats = ['ob1', 'ob2', 'ob3', 'ob4'] as const;
  if (lines.some((l) => l.category === 'obUnknown')) {
    const exp = obCats.reduce(
      (s, c) => ({ hours: round2(s.hours + (t[c]?.hours ?? 0)), amount: round2(s.amount + (t[c]?.amount ?? 0)) }),
      { hours: 0, amount: 0 },
    );
    push(moneyRow('obTotal', exp.amount ? exp : undefined, sumSlip(lines, [...obCats, 'obUnknown']), 50));
  } else {
    for (const c of obCats) {
      const row = moneyRow(c, t[c], sumSlip(lines, [c]), t[c]?.rates[0] ?? 50);
      if (row?.status === 'missing') row.notes.push({ code: 'ob-missing-level' });
      push(row);
    }
  }

  if (lines.some((l) => l.category === 'otUnknown')) {
    const exp = {
      hours: round2((t.ot50?.hours ?? 0) + (t.ot100?.hours ?? 0)),
      amount: round2((t.ot50?.amount ?? 0) + (t.ot100?.amount ?? 0)),
    };
    push(moneyRow('otTotal', exp.amount ? exp : undefined, sumSlip(lines, ['ot50', 'ot100', 'otUnknown']), hourly));
  } else {
    push(moneyRow('ot50', t.ot50, sumSlip(lines, ['ot50']), hourly / 2));
    push(moneyRow('ot100', t.ot100, sumSlip(lines, ['ot100']), hourly));
  }

  push(moneyRow('shiftedTime', t.shiftedTime, sumSlip(lines, ['shiftedTime']), 40));
  push(moneyRow('shiftForm', t.shiftForm, sumSlip(lines, ['shiftForm']), hourly * 0.11));

  // Sick pay: the expected value is an estimate when it rests on averages.
  const sickRow = moneyRow('sickPay', t.sickPay && { amount: t.sickPay.amount, hours: t.sickPay.hours }, sumSlip(lines, ['sickPay']), hourly);
  if (sickRow) {
    const slipSick = sumSlip(lines, ['sickPay']);
    const basePrice = round2(hourly * RULES.sickPayPercent);
    if (slipSick && slipSick.prices.length > 0 && slipSick.prices.every((p) => Math.abs(p - basePrice) < 0.02)) {
      const hadOb = period.shifts.some((s) => s.obMinutes[1] + s.obMinutes[2] + s.obMinutes[3] + s.obMinutes[4] > 0);
      if (hadOb) sickRow.notes.push({ code: 'sick-base-only', values: { price: basePrice } });
    }
    if (period.sick?.days.some((d) => d.basis === 'average')) {
      sickRow.notes.push({ code: 'sick-estimate', values: { weeks: period.sick.weeksUsed } });
      if (sickRow.status === 'diff') sickRow.status = 'check';
    }
    // Hours aren't comparable when the estimate uses average shifts.
    if (period.sick?.days.some((d) => d.basis === 'average')) sickRow.diff.hours = undefined;
    push(sickRow);
  }
  const karens = moneyRow('karens', t.karens, sumSlip(lines, ['karens']), hourly);
  if (karens && period.sick?.days.some((d) => d.basis === 'average') && karens.status === 'diff') karens.status = 'check';
  if (karens) karens.diff.hours = undefined;
  push(karens);

  push(moneyRow('holidayPay', t.holidayPay, sumSlip(lines, ['holidayPay']), hourly));
  push(moneyRow('permission', t.permission, sumSlip(lines, ['permission']), hourly));

  // Vacation: days can be checked; the daily amount only against the minimum.
  const vacSlip = sumSlip(lines, ['vacationDays']) ?? sumSlip(lines, ['vacationPay']);
  if (period.vacationDays || vacSlip) {
    const slipDays = vacSlip?.count ?? 0;
    rows.push({
      key: 'vacationDays',
      expected: { count: period.vacationDays },
      slip: { count: slipDays, prices: [] },
      diff: { count: slipDays - period.vacationDays },
      status: slipDays === period.vacationDays ? 'ok' : 'diff',
      notes: [],
    });
  }
  const vacPay = sumSlip(lines, ['vacationPay']);
  if (vacPay) {
    const agreement = agreementFor(slip.periodEnd ?? period.end);
    const minimum = agreement ? round2((agreement.vacationPayPerDayMin * settings.employmentPercent) / 100) : undefined;
    const lowest = Math.min(...vacPay.prices);
    const below = minimum !== undefined && vacPay.prices.length > 0 && lowest < minimum;
    rows.push({
      key: 'vacationPay',
      expected: {},
      slip: { amount: vacPay.amount, count: vacPay.count, prices: vacPay.prices },
      diff: {},
      status: below ? 'diff' : 'info',
      notes: [below ? { code: 'vacation-below-min', values: { price: lowest, minimum: minimum! } } : { code: 'vacation-pay-unchecked', values: { minimum: minimum ?? 0 } }],
    });
  }

  // Time bank: hours always, money when the hourly payout rate is known.
  const tbHours = sumSlip(lines, ['timebankHours']) ?? sumSlip(lines, ['timebankPay']);
  if (period.timebankHours || tbHours) {
    const slipHours = tbHours?.hours ?? 0;
    rows.push({
      key: 'timebankHours',
      expected: { hours: period.timebankHours },
      slip: { hours: slipHours, prices: [] },
      diff: { hours: round2(slipHours - period.timebankHours) },
      status: Math.abs(slipHours - period.timebankHours) <= HOURS_TOLERANCE ? 'ok' : 'diff',
      notes: [],
    });
  }
  const tbPay = sumSlip(lines, ['timebankPay']);
  if (t.timebankPay || tbPay) {
    const row = moneyRow('timebankPay', t.timebankPay, tbPay, settings.timeBankRate ?? hourly);
    if (row && !t.timebankPay) {
      row.status = 'info';
      row.notes.push({ code: 'timebank-rate-unknown', values: { price: tbPay?.prices[0] ?? 0 } });
    }
    push(row);
  }

  // Gross: lines we can't calculate (vacation pay, other) are taken as printed.
  const unchecked = lines.filter((l) => ['vacationPay', 'other'].includes(l.category) || (l.category === 'timebankPay' && !t.timebankPay));
  const passThrough = round2(unchecked.reduce((s, l) => s + (l.amount ?? 0), 0));
  let totalDifference: number | undefined;
  let netDifference: number | undefined;
  const expectedGross = round2(period.expectedGross + passThrough);
  if (slip.gross !== undefined) {
    totalDifference = round2(slip.gross - expectedGross);
    rows.push({
      key: 'gross',
      expected: { amount: expectedGross },
      slip: { amount: slip.gross, prices: [] },
      diff: { amount: totalDifference },
      status: Math.abs(totalDifference) <= 1 ? 'ok' : 'diff',
      notes: passThrough ? [{ code: 'gross-includes-unchecked', values: { amount: passThrough } }] : [],
    });
  }

  // Tax: the table for where you live, the tax on the pay the slip taxed, and net pay.
  if (tax && (slip.tax !== undefined || tax.basis.kind !== 'unknown')) {
    const basis = tax.basis;
    const expectedTable = basis.kind === 'table' ? basis.table : undefined;
    const tableRow: ComparisonRow = {
      key: 'taxTable',
      expected: { count: expectedTable },
      slip: { count: slip.taxTable, prices: [] },
      diff: {},
      status: expectedTable === undefined || slip.taxTable === undefined ? 'info' : expectedTable === slip.taxTable ? 'ok' : 'diff',
      notes: [],
    };
    if (basis.kind === 'percent') tableRow.notes.push({ code: 'tax-percent', values: { percent: basis.percent } });
    if (basis.kind === 'unknown') tableRow.notes.push({ code: 'tax-not-set' });
    rows.push(tableRow);

    const base = slip.taxBase ?? slip.gross;
    const expectedTax = base !== undefined ? taxFor(basis, tax.tables, base, tax.column) : undefined;
    const taxRow: ComparisonRow = {
      key: 'tax',
      expected: { amount: expectedTax },
      slip: { amount: slip.tax, prices: [] },
      diff: {},
      status: 'info',
      notes: [],
    };
    if (expectedTax !== undefined && slip.tax !== undefined) {
      taxRow.diff.amount = round2(slip.tax - expectedTax);
      taxRow.status = Math.abs(taxRow.diff.amount) <= 1 ? 'ok' : 'diff';
      if (taxRow.status === 'diff' && slip.taxTable !== undefined && expectedTable !== undefined && slip.taxTable !== expectedTable) {
        taxRow.notes.push({ code: 'tax-table-differs', values: { slip: slip.taxTable, expected: expectedTable } });
      }
    } else if (basis.kind === 'table' && !tax.tables) {
      taxRow.notes.push({ code: 'tax-data-missing' });
    }
    rows.push(taxRow);

    // Net = calculated gross − tax on it − other deductions, rounded to whole kronor.
    const taxOnExpected = taxFor(basis, tax.tables, expectedGross, tax.column);
    if (taxOnExpected !== undefined && slip.net !== undefined) {
      const expectedNet = Math.round(expectedGross - taxOnExpected - (slip.otherDeductions ?? 0));
      netDifference = round2(slip.net - expectedNet);
      rows.push({
        key: 'net',
        expected: { amount: expectedNet },
        slip: { amount: slip.net, prices: [] },
        diff: { amount: netDifference },
        status: Math.abs(netDifference) <= 1 ? 'ok' : 'diff',
        notes: slip.otherDeductions ? [{ code: 'net-other-deductions', values: { amount: slip.otherDeductions } }] : [],
      });
    }
  }

  // Does the log cover the period? Days before the first logged day are unknown.
  const logged = days.filter((d) => d.rows.length > 0 || d.absence).map((d) => d.date).sort();
  const coverage: CoverageNote[] = [];
  const firstInPeriod = logged.find((d) => d >= period.start && d <= period.end);
  if (!firstInPeriod) coverage.push({ code: 'no-log' });
  else if (!logged.some((d) => d < period.start) && firstInPeriod > period.start) {
    coverage.push({ code: 'log-starts-late', date: firstInPeriod });
  }

  return {
    rows,
    otherLines: lines.filter((l) => l.category === 'other'),
    coverage,
    totalDifference,
    netDifference,
  };
}
