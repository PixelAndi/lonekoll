import { AGREEMENT_PERIODS, type ObLevel } from './agreement.ts';
import type { PayCategory } from './calc.ts';
import type { LocalDate } from './time.ts';

// Reads a pay slip from the positioned text of a PDF (pdf.js text items).
// Built on one bakery's slips (columns Löneart · Benämning · Datum ·
// Kvantitet · Enhet · A-Pris · Belopp) but only relies on each row starting
// with a numeric code, so similar layouts work too.

export interface TextItem {
  str: string;
  x: number;
  /** PDF coordinates: larger y is higher up the page. */
  y: number;
  width: number;
}

export type SlipCategory =
  | PayCategory
  | 'vacationDays'
  | 'sickHours'
  | 'timebankHours'
  | 'shiftedTime'
  | 'obUnknown'
  | 'otUnknown'
  | 'other';

export interface SlipLine {
  code: string;
  text: string;
  from?: LocalDate;
  to?: LocalDate;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  amount?: number;
  category: SlipCategory;
}

export interface PaySlip {
  employer?: string;
  periodStart?: LocalDate;
  periodEnd?: LocalDate;
  payDate?: LocalDate;
  lines: SlipLine[];
  gross?: number;
  tax?: number;
  net?: number;
  balances: {
    vacationDaysPaid?: number;
    vacationDaysSaved?: number;
    compHours?: number;
    timeBankHours?: number;
  };
}

const NUMBER = /^[-−]?\d{1,3}(?:[   ]\d{3})*,\d{2}$|^[-−]?\d+,\d{2}$/;
const UNIT = /^(timmar|tim|h|dagar|dag|st|antal|kr|mån|månad)$/i;
const DATE_RANGE = /^(\d{6}|\d{4}-\d{2}-\d{2})\s*-\s*(\d{6}|\d{4}-\d{2}-\d{2})$/;

export function parseSwedishNumber(s: string): number | undefined {
  const t = s.trim().replace(/[   ]/g, '').replace('−', '-').replace(',', '.');
  if (t === '' || t === '-') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function toIsoDate(s: string): LocalDate {
  if (/^\d{6}$/.test(s)) return `20${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}`;
  return s;
}

function groupLines(items: TextItem[]): TextItem[][] {
  const sorted = items.filter((i) => i.str.trim() !== '').sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: TextItem[][] = [];
  for (const item of sorted) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line[0].y - item.y) < 2.5) line.push(item);
    else lines.push([item]);
  }
  return lines.map((l) => l.sort((a, b) => a.x - b.x));
}

const OB_RATES: { level: ObLevel; rate: number }[] = AGREEMENT_PERIODS.flatMap((p) =>
  ([1, 2, 3, 4] as ObLevel[]).map((level) => ({ level, rate: p.ob[level] })),
);

export function classifyLine(text: string, amount: number | undefined, unitPrice: number | undefined, hourlyRate?: number): SlipCategory {
  const t = text.toLowerCase();
  if (t.includes('karens')) return 'karens';
  if (t.includes('sjuklön')) return 'sickPay';
  if (t.includes('sjuk')) return amount === undefined ? 'sickHours' : 'sickPay';
  if (/övertid|ötid/.test(t)) {
    if (/100|kval/.test(t)) return 'ot100';
    if (/50|enkel/.test(t)) return 'ot50';
    if (unitPrice && hourlyRate) {
      const ratio = unitPrice / hourlyRate;
      if (Math.abs(ratio - 0.5) < 0.02) return 'ot50';
      if (Math.abs(ratio - 1) < 0.02) return 'ot100';
    }
    return 'otUnknown';
  }
  if (/\bob\b|ob-|obekv/.test(t)) {
    const byPrice = unitPrice !== undefined ? OB_RATES.find((r) => Math.abs(r.rate - unitPrice) < 0.005) : undefined;
    if (byPrice) return `ob${byPrice.level}` as SlipCategory;
    const byName = t.match(/ob[- ]?(?:ersättning|tillägg)?\s*([1-4])\b/);
    return byName ? (`ob${byName[1]}` as SlipCategory) : 'obUnknown';
  }
  if (t.includes('helglön')) return 'holidayPay';
  if (t.includes('semester')) return amount === undefined ? 'vacationDays' : 'vacationPay';
  if (/arbetstidskonto|tidbank/.test(t)) return amount === undefined ? 'timebankHours' : 'timebankPay';
  if (t.includes('permission')) return 'permission';
  if (t.includes('förskjut')) return 'shiftedTime';
  if (/timlön|^lön\b/.test(t)) return 'wage';
  return 'other';
}

function parseItemLine(line: TextItem[], hourlyRate?: number): SlipLine | null {
  if (line.length < 2 || !/^\d{3,5}$/.test(line[0].str.trim())) return null;
  const code = line[0].str.trim();
  const textParts: string[] = [];
  const before: number[] = [];
  const after: number[] = [];
  let unit: string | undefined;
  let from: LocalDate | undefined;
  let to: LocalDate | undefined;
  for (const item of line.slice(1)) {
    const s = item.str.trim();
    const range = s.match(DATE_RANGE);
    if (range) {
      from = toIsoDate(range[1]);
      to = toIsoDate(range[2]);
    } else if (NUMBER.test(s)) {
      (unit ? after : before).push(parseSwedishNumber(s)!);
    } else if (UNIT.test(s) && !unit) {
      unit = s;
    } else if (before.length === 0 && !unit) {
      textParts.push(s);
    }
  }
  let quantity: number | undefined;
  let unitPrice: number | undefined;
  let amount: number | undefined;
  if (unit) {
    quantity = before[0];
    if (after.length >= 2) [unitPrice, amount] = after;
    else if (after.length === 1) amount = after[0];
  } else if (before.length >= 3) {
    [quantity, unitPrice, amount] = before;
  } else if (before.length === 2) {
    [quantity, amount] = before;
  } else if (before.length === 1) {
    amount = before[0];
  }
  const text = textParts.join(' ');
  return {
    code,
    text,
    from,
    to,
    quantity,
    unit,
    unitPrice,
    amount,
    category: classifyLine(text, amount, unitPrice, hourlyRate),
  };
}

/** Value printed to the right of a label on the same line. */
function valuesAfter(lines: TextItem[][], label: RegExp): { label: TextItem; value: string }[] {
  const found: { label: TextItem; value: string }[] = [];
  for (const line of lines) {
    line.forEach((item, i) => {
      if (!label.test(item.str.trim())) return;
      const next = line.slice(i + 1).find((n) => n.x > item.x + item.width - 1);
      if (next) found.push({ label: item, value: next.str.trim() });
    });
  }
  return found;
}

const rightmost = <T extends { label: TextItem }>(list: T[]) =>
  list.length ? list.reduce((a, b) => (b.label.x > a.label.x ? b : a)) : undefined;

export function parsePaySlip(items: TextItem[], hourlyRate?: number): PaySlip {
  const lines = groupLines(items);
  const slip: PaySlip = { lines: [], balances: {} };
  for (const line of lines) {
    const parsed = parseItemLine(line, hourlyRate);
    if (parsed) slip.lines.push(parsed);
  }

  slip.employer = lines[0]?.[0]?.str.trim();
  const period = valuesAfter(lines, /^Löneperiod$/i)[0]?.value.match(/(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})/);
  if (period) [, slip.periodStart, slip.periodEnd] = period;

  // "Utbetalas 2026-10-23" with the amount paid out further right.
  for (const line of lines) {
    const idx = line.findIndex((i) => /^Utbetalas\b/i.test(i.str.trim()));
    if (idx < 0) continue;
    const date = line[idx].str.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (date) slip.payDate = date;
    const amount = line.slice(idx + 1).find((i) => NUMBER.test(i.str.trim()));
    if (amount) slip.net = parseSwedishNumber(amount.str);
  }

  // Bruttolön/Skatt appear in several summary blocks; the payout block is rightmost.
  const gross = rightmost(valuesAfter(lines, /^Bruttolön$/i));
  if (gross) slip.gross = parseSwedishNumber(gross.value);
  const tax = rightmost(valuesAfter(lines, /^Skatt$/i));
  if (tax) slip.tax = parseSwedishNumber(tax.value);

  const balance = (label: RegExp) => {
    const v = valuesAfter(lines, label)[0]?.value;
    return v === undefined ? undefined : parseSwedishNumber(v.replace(/,$/, ''));
  };
  slip.balances = {
    vacationDaysPaid: balance(/^Betalda$/i),
    vacationDaysSaved: balance(/^Sparade$/i),
    compHours: balance(/^Komptid$/i),
    // Some slips misspell it "Artbetstidskonto".
    timeBankHours: balance(/^Ar?tbetstidskonto$|^Arbetstidskonto$/i),
  };
  return slip;
}
