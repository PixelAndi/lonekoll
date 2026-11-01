import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { useApp } from '../app-context.ts';
import { db, type SlipRecord } from '../db.ts';
import { agreementFor } from '../domain/agreement.ts';
import { calculatePeriod, type PeriodResult } from '../domain/calc.ts';
import { comparePeriod, type Comparison, type ComparisonRow, type Note, type TaxContext } from '../domain/compare.ts';
import { monthlyPayOn, type Settings } from '../domain/model.ts';
import { RULES } from '../domain/agreement.ts';
import type { PaySlip, SlipCategory } from '../domain/payslip.ts';
import { taxBasis, taxColumn } from '../domain/tax.ts';
import { formatDuration, monthEnd, monthStart, todayLocal } from '../domain/time.ts';
import { useTaxData } from '../taxData.ts';
import type { Formatter } from '../format.ts';
import type { TextKey, Translate } from '../i18n.ts';
import { shiftMonth } from './DaysView.tsx';
import { earningYearForVacationOn, slipDueDate, vacationBasis, type VacationBasis } from '../domain/vacation.ts';

/** The earning year a slip's vacation pay is paid from, and how much of it has its pay slips. */
export function vacationBasisFor(slip: PaySlip, all: SlipRecord[], settings: Settings): VacationBasis | undefined {
  const date = slip.periodEnd ?? slipDueDate(slip);
  if (!date) return undefined;
  return vacationBasis(
    all.map((r) => r.slip),
    settings,
    earningYearForVacationOn(date, settings),
  );
}

export interface SlipComparison {
  record: SlipRecord;
  slip: PaySlip;
  start: string;
  end: string;
  period: PeriodResult;
  comparison: Comparison;
  tax: TaxContext;
  /** The year whose tax tables apply (the year the pay is paid out). */
  taxYear: number;
}

export function applyOverrides(slip: PaySlip, overrides: Record<string, string>): PaySlip {
  return { ...slip, lines: slip.lines.map((l) => ({ ...l, category: (overrides[l.code] as SlipCategory) ?? l.category })) };
}

/** The pay period of a slip; falls back to the month before the pay date. */
export function slipPeriod(slip: PaySlip, importedAt: number): { start: string; end: string } {
  if (slip.periodStart && slip.periodEnd) return { start: slip.periodStart, end: slip.periodEnd };
  const paid = slip.payDate ?? todayLocal(importedAt);
  const start = `${shiftMonth(paid.slice(0, 7), -1)}-01`;
  return { start: monthStart(start), end: monthEnd(start) };
}

/** undefined while loading, null if the slip doesn't exist. */
export function useSlipComparison(id: string): SlipComparison | null | undefined {
  const { days, settings } = useApp();
  const record = useLiveQuery(() => db.slips.get(id).then((r) => r ?? null), [id]);
  const all = useLiveQuery(() => db.slips.toArray(), []);
  const taxYear = Number((record?.slip.payDate ?? record?.slip.periodEnd ?? todayLocal()).slice(0, 4));
  const taxData = useTaxData(taxYear);
  return useMemo(() => {
    if (record === undefined || all === undefined || taxData.loading) return undefined;
    if (record === null) return null;
    const slip = applyOverrides(record.slip, settings.codeOverrides);
    const { start, end } = slipPeriod(slip, record.importedAt);
    const period = calculatePeriod(days, settings, start, end);
    const tax: TaxContext = { basis: taxBasis(settings.tax, taxData.rates), tables: taxData.tables, column: taxColumn(settings.birthDate, taxYear) };
    const vacation = vacationBasisFor(slip, all, settings);
    return { record, slip, start, end, period, tax, taxYear, comparison: comparePeriod(period, slip, days, settings, tax, vacation) };
  }, [record, all, days, settings, taxData, taxYear]);
}

/** Rows worth a look; gross and net only repeat the other rows' differences. */
export function countFindings(c: Comparison): number {
  return c.rows.filter((r) => r.key !== 'gross' && r.key !== 'net' && ['diff', 'check', 'missing', 'extra'].includes(r.status)).length;
}

const REF: Partial<Record<ComparisonRow['key'], TextKey>> = {
  wage: 'ref.wage',
  ob1: 'ref.ob',
  ob2: 'ref.ob',
  ob3: 'ref.ob',
  ob4: 'ref.ob',
  obTotal: 'ref.ob',
  ot50: 'ref.ot',
  ot100: 'ref.ot',
  otTotal: 'ref.ot',
  sickPay: 'ref.sick',
  karens: 'ref.sick',
  holidayPay: 'ref.holidayPay',
  permission: 'ref.permission',
  vacationDays: 'ref.vacation',
  vacationPay: 'ref.vacation',
  timebankHours: 'ref.timebank',
  timebankPay: 'ref.timebank',
  gross: 'ref.gross',
  shiftedTime: 'ref.shiftedTime',
  kompEarned: 'ref.komp',
  kompPay: 'ref.komp',
  shiftForm: 'ref.shiftForm',
  taxTable: 'ref.tax',
  tax: 'ref.tax',
  net: 'ref.net',
  monthlySalary: 'ref.monthlySalary',
  sickDeduction: 'ref.sickMonthly',
  vacationDeduction: 'ref.vacationDeduction',
  absenceDeduction: 'ref.absenceDeduction',
};

/** With a monthly salary, these rows follow Bilaga F instead. */
const MONTHLY_REF: Partial<Record<ComparisonRow['key'], TextKey>> = {
  ot50: 'ref.otMonthly',
  ot100: 'ref.otMonthly',
  otTotal: 'ref.otMonthly',
  sickPay: 'ref.sickMonthly',
  karens: 'ref.sickMonthly',
};

export function rowReference(row: ComparisonRow, t: Translate, settings: Settings, periodEnd: string, taxYear: number, fmt: Formatter): string {
  const monthly = monthlyPayOn(settings, periodEnd);
  const key = (monthly && MONTHLY_REF[row.key]) || REF[row.key];
  if (!key) return '';
  const agreement = agreementFor(periodEnd);
  return t(key, {
    perHour: fmt.number(monthly?.perHour ?? 0),
    perDay: fmt.number(monthly?.perDay ?? 0),
    perVacationDay: fmt.number(monthly ? monthly.monthly / RULES.vacationDaysPerMonth : 0),
    sickRate: fmt.number(monthly ? monthly.perHour * RULES.sickPayPercent : 0),
    unpaid: fmt.number(monthly ? monthly.weeklyHours * RULES.monthlySickUnpaidShare : 0),
    limit: formatDuration(settings.ordinaryShiftMinutes),
    minimum: String(agreement?.vacationPayPerDayMin ?? 0),
    rate: fmt.number(agreement?.shiftedTime ?? 0),
    year: taxYear,
    column: taxColumn(settings.birthDate, taxYear),
  });
}

export function noteText(note: Note, t: Translate, fmt: Formatter): string {
  const v = note.values ?? {};
  const num = (k: string) => (typeof v[k] === 'number' ? fmt.number(v[k] as number) : '');
  switch (note.code) {
    case 'wage-deductions':
      return t(v.absence === 'timebank' ? 'note.wage-deductions-timebank' : 'note.wage-deductions', {
        hours: num('hours'),
        amount: fmt.money(v.amount as number),
        date: String(v.date ?? ''),
      });
    case 'wage-rate-differs':
    case 'wage-rate-differs-minimum': {
      const list = (k: string) => String(v[k] ?? '').split(' / ').map((x) => fmt.number(Number(x))).join(' / ');
      return t(`note.${note.code}`, { slip: list('slip'), expected: list('expected'), minimum: num('minimum'), supplement: num('supplement') });
    }
    case 'wage-below-minimum':
      return t('note.wage-below-minimum', {
        slip: num('slip'),
        minimum: num('minimum'),
        from: fmt.date(String(v.from), 'numeric'),
        hours: num('hours'),
        short: fmt.money(v.short as number),
      });
    case 'gross-includes-unchecked':
      return t('note.gross-includes-unchecked', { amount: fmt.money(v.amount as number) });
    case 'sick-estimate':
      return t('note.sick-estimate', { weeks: String(v.weeks ?? '') });
    case 'tax-table-differs':
      return t('note.tax-table-differs', { slip: String(v.slip), expected: String(v.expected) });
    case 'tax-percent':
      return t('note.tax-percent', { percent: num('percent') });
    case 'vacation-pay-checked':
      return t('note.vacation-pay-checked', {
        pay: fmt.number(v.pay as number),
        days: String(v.days),
        price: num('price'),
        from: fmt.date(String(v.from)),
        to: fmt.date(String(v.to)),
      });
    case 'komp-earned':
      return t('note.komp-earned', { hours: num('hours') });
    case 'net-other-deductions':
      return t('note.net-other-deductions', { amount: fmt.money(v.amount as number) });
    default:
      return t(`note.${note.code}`, { price: num('price'), minimum: num('minimum') });
  }
}

export function rowLabel(row: ComparisonRow, t: Translate): string {
  return t(`cat.${row.key}` as TextKey);
}

/** "121,90 h · 22 901,35 kr", "2 dagar" etc. */
export function sideText(side: { hours?: number; amount?: number; count?: number }, key: ComparisonRow['key'], fmt: Formatter): string {
  if (key === 'vacationDays' || key === 'taxTable') return side.count === undefined ? '–' : fmt.number(side.count, 0);
  if (key === 'timebankHours') return fmt.hours(side.hours);
  const parts: string[] = [];
  if (side.hours !== undefined && side.hours !== 0 && key !== 'karens') parts.push(fmt.hours(side.hours));
  if (side.amount !== undefined) parts.push(fmt.money(side.amount));
  return parts.length ? parts.join(' · ') : '–';
}

export function diffText(row: ComparisonRow, fmt: Formatter): string {
  if (row.key === 'vacationDays') return row.diff.count ? `${row.diff.count > 0 ? '+' : ''}${row.diff.count}` : '';
  const parts: string[] = [];
  if (row.diff.hours) parts.push(`${row.diff.hours > 0 ? '+' : '−'}${fmt.number(Math.abs(row.diff.hours))} h`);
  if (row.diff.amount) parts.push(fmt.signedMoney(row.diff.amount));
  return parts.join(' · ');
}
