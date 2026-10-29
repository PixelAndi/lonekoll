import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { useApp } from '../app-context.ts';
import { db, type SlipRecord } from '../db.ts';
import { agreementFor } from '../domain/agreement.ts';
import { calculatePeriod, type PeriodResult } from '../domain/calc.ts';
import { comparePeriod, type Comparison, type ComparisonRow, type Note } from '../domain/compare.ts';
import type { Settings } from '../domain/model.ts';
import type { PaySlip, SlipCategory } from '../domain/payslip.ts';
import { formatDuration, monthEnd, monthStart, todayLocal } from '../domain/time.ts';
import type { Formatter } from '../format.ts';
import type { TextKey, Translate } from '../i18n.ts';
import { shiftMonth } from './DaysView.tsx';

export interface SlipComparison {
  record: SlipRecord;
  slip: PaySlip;
  start: string;
  end: string;
  period: PeriodResult;
  comparison: Comparison;
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
  return useMemo(() => {
    if (record === undefined) return undefined;
    if (record === null) return null;
    const slip = applyOverrides(record.slip, settings.codeOverrides);
    const { start, end } = slipPeriod(slip, record.importedAt);
    const period = calculatePeriod(days, settings, start, end);
    return { record, slip, start, end, period, comparison: comparePeriod(period, slip, days, settings) };
  }, [record, days, settings]);
}

export function countFindings(c: Comparison): number {
  return c.rows.filter((r) => r.key !== 'gross' && ['diff', 'check', 'missing', 'extra'].includes(r.status)).length;
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
};

export function rowReference(row: ComparisonRow, t: Translate, settings: Settings, periodEnd: string): string {
  const key = REF[row.key];
  if (!key) return '';
  const minimum = agreementFor(periodEnd)?.vacationPayPerDayMin ?? 0;
  return t(key, { limit: formatDuration(settings.ordinaryShiftMinutes), minimum: String(minimum) });
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
    case 'gross-includes-unchecked':
      return t('note.gross-includes-unchecked', { amount: fmt.money(v.amount as number) });
    case 'sick-estimate':
      return t('note.sick-estimate', { weeks: String(v.weeks ?? '') });
    default:
      return t(`note.${note.code}`, { price: num('price'), minimum: num('minimum') });
  }
}

export function rowLabel(row: ComparisonRow, t: Translate): string {
  return t(`cat.${row.key}` as TextKey);
}

/** "121,90 h · 22 901,35 kr", "2 dagar" etc. */
export function sideText(side: { hours?: number; amount?: number; count?: number }, key: ComparisonRow['key'], fmt: Formatter): string {
  if (key === 'vacationDays') return side.count === undefined ? '–' : fmt.number(side.count, 0);
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
