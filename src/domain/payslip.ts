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
  | 'kompHours'
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
  /**
   * Where the period came from when it was not read as printed: worked out
   * from the dates of the pay lines or the pay day ('guessed'), or printed but
   * its year read differently from every other date on the slip ('yearFixed').
   * Either way the user is asked to check it.
   */
  periodDoubt?: 'guessed' | 'yearFixed';
  /** The user has looked at the period and the main figures and confirmed them. */
  checked?: boolean;
  payDate?: LocalDate;
  lines: SlipLine[];
  gross?: number;
  tax?: number;
  net?: number;
  /** "Skatt beräknad på": the tax table the employer used and the pay it was applied to. */
  taxTable?: number;
  taxBase?: number;
  oneTimeTaxPercent?: number;
  otherDeductions?: number;
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

const isRealDate = (y: number, m: number, d: number) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  return y >= 2000 && y <= 2099 && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};

/** The dates in a text, as read from a PDF or (with stray spaces or dots) from a photo: "2026-09-01", "2026 -09-01", "2026.09.01", "20260901". */
export function datesIn(text: string): LocalDate[] {
  const out: LocalDate[] = [];
  for (const m of text.matchAll(/(?<!\d)(20\d{2})\s*[-–.]?\s*(\d{2})\s*[-–.]?\s*(\d{2})(?!\d)/g)) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (isRealDate(y, mo, d)) out.push(`${m[1]}-${m[2]}-${m[3]}`);
  }
  return out;
}

const daysBetween = (a: LocalDate, b: LocalDate) => (Date.parse(b) - Date.parse(a)) / 86_400_000;
const lastOfMonth = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
const previousMonth = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

/**
 * The pay period: printed after (or under) "Löneperiod". A photo can misread
 * a digit, so its year is checked against the slip's other dates (the pay
 * lines' and the pay day); when it is not printed or not readable, it is
 * worked out from those dates and marked as a guess.
 */
function findPeriod(lines: TextItem[][], slip: PaySlip) {
  // OCR can read the ö or the e wrong.
  const label = /^l.n.?period:?$/i;
  let printed: [LocalDate, LocalDate] | undefined;
  lines.forEach((line, n) => {
    line.forEach((item, i) => {
      if (printed) return;
      const own = item.str.trim();
      const startsWithLabel = /^l.n.?period\b/i.test(own);
      if (!label.test(own) && !startsWithLabel) return;
      const right = line.slice(i + 1).filter((x) => x.x > item.x + item.width - 1);
      // The dates on the same line, or (a slip with the value under its heading) on the next.
      const below = (lines[n + 1] ?? []).filter((x) => x.x > item.x - 30 && x.x < item.x + 250);
      for (const texts of [[own, ...right.map((x) => x.str)], below.map((x) => x.str)]) {
        const dates = datesIn(texts.join(' '));
        if (dates.length >= 2 && dates[0] <= dates[1] && daysBetween(dates[0], dates[1]) <= 62) {
          printed = [dates[0], dates[1]];
          return;
        }
      }
    });
  });

  // The other dates on the slip: the pay lines' and the pay day.
  const others = [...slip.lines.flatMap((l) => [l.from, l.to]), slip.payDate].filter((d): d is LocalDate => !!d);
  if (printed) {
    const [start, end] = printed;
    const year = start.slice(0, 4);
    const years = new Set(others.map((d) => d.slice(0, 4)));
    // Every other date says another year (a misread digit): theirs, unless the period is near the turn of the year.
    if (others.length >= 2 && !years.has(year) && years.size === 1) {
      const theirs = [...years][0];
      const crossesYear = others.every((d) => Math.abs(daysBetween(`${theirs}${start.slice(4)}`, d)) <= 70);
      if (crossesYear) {
        slip.periodStart = `${theirs}${start.slice(4)}`;
        slip.periodEnd = `${theirs}${end.slice(4)}`;
        slip.periodDoubt = 'yearFixed';
        return;
      }
    }
    [slip.periodStart, slip.periodEnd] = printed;
    return;
  }
  // Not printed or not readable: the month most of the pay lines are in, or the month before the pay day.
  const lineDates = slip.lines.map((l) => l.from).filter((d): d is LocalDate => !!d);
  const counts = new Map<string, number>();
  for (const d of lineDates) counts.set(d.slice(0, 7), (counts.get(d.slice(0, 7)) ?? 0) + 1);
  const month = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? (slip.payDate ? previousMonth(slip.payDate.slice(0, 7)) : undefined);
  if (!month) return;
  slip.periodStart = `${month}-01`;
  slip.periodEnd = lastOfMonth(month);
  slip.periodDoubt = 'guessed';
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
  // Monthly salary (Bilaga F): the salary, and deductions from it for sick leave, vacation and other absence.
  if (/månadslön|mån\.?\s*lön|grundlön/.test(t)) return 'monthlySalary';
  const negative = amount !== undefined && amount < 0;
  if (t.includes('sjuk') && (/avdrag|frånvaro/.test(t) || (negative && !t.includes('sjuklön')))) return 'sickDeduction';
  if (t.includes('semester') && (t.includes('avdrag') || negative)) return 'vacationDeduction';
  if (/tjänstledig|föräldraledig|\bvab\b|vård av barn|frånvaroavdrag|frånvaro|löneavdrag|ledig utan lön/.test(t)) return 'absenceDeduction';
  if (t.includes('sjuklön')) return 'sickPay';
  if (t.includes('sjuk')) return amount === undefined ? 'sickHours' : 'sickPay';
  // Komptid taken (paid time off); komp lines about overtime are its supplement, read as overtime below.
  if (/komp/.test(t) && !/övertid|ötid/.test(t)) return amount === undefined ? 'kompHours' : 'kompPay';
  // "Timlön vid övertid": the hourly wage for the overtime hours, printed apart from
  // the supplement ("Övertid …, 50%"). The calculation counts those hours as wage too.
  if (/timlön\s+(vid|för|på)\s+(övertid|ötid)/.test(t)) return 'wage';
  if (/övertid|ötid/.test(t)) {
    if (/100|kval/.test(t)) return 'ot100';
    if (/50|enkel/.test(t)) return 'ot50';
    if (unitPrice && hourlyRate) {
      // The supplement alone (hourly pay), or the whole hour with it (monthly salary, Bilaga F §3).
      const ratio = unitPrice / hourlyRate;
      if (Math.abs(ratio - 0.5) < 0.02 || Math.abs(ratio - 1.5) < 0.02) return 'ot50';
      if (Math.abs(ratio - 1) < 0.02 || Math.abs(ratio - 2) < 0.02) return 'ot100';
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
  if (/skiftform|skifttillägg/.test(t)) return 'shiftForm';
  if (/timlön|^lön\b/.test(t)) return 'wage';
  return 'other';
}

/** Where a slip's À-pris and Belopp columns end (right edges, in points), from the lines that have both. */
interface Columns {
  price?: number;
  amount?: number;
}

const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : undefined);
const right = (i: TextItem) => i.x + i.width;
/** A figure as a photo may read it: "1198.,76" for "1198,76". */
const tidyFigure = (s: string) => s.replace(/(\d)[.,]{2,}(\d)/, '$1,$2');

function findColumns(lines: TextItem[][]): Columns {
  const prices: number[] = [];
  const amounts: number[] = [];
  for (const line of lines) {
    if (!/^\d{3,5}$/.test(line[0]?.str.trim() ?? '')) continue;
    const u = line.findIndex((i) => UNIT.test(i.str.trim()));
    if (u < 0) continue;
    const figures = line.slice(u + 1).filter((i) => NUMBER.test(tidyFigure(i.str.trim())));
    if (figures.length < 2) continue;
    prices.push(right(figures[figures.length - 2]));
    amounts.push(right(figures[figures.length - 1]));
  }
  return { price: median(prices), amount: median(amounts) };
}

function parseItemLine(line: TextItem[], hourlyRate?: number, columns: Columns = {}): SlipLine | null {
  if (line.length < 2 || !/^\d{3,5}$/.test(line[0].str.trim())) return null;
  const code = line[0].str.trim();
  const textParts: string[] = [];
  const before: number[] = [];
  const after: { value: number; item: TextItem }[] = [];
  /** After the unit: whole numbers that may be an amount whose comma wasn't seen, and text that couldn't be read. */
  const bare: { digits: string; item: TextItem }[] = [];
  let unreadable = false;
  let unit: string | undefined;
  let from: LocalDate | undefined;
  let to: LocalDate | undefined;
  for (const item of line.slice(1)) {
    const s = tidyFigure(item.str.trim());
    const range = s.match(DATE_RANGE);
    if (range) {
      from = toIsoDate(range[1]);
      to = toIsoDate(range[2]);
    } else if (NUMBER.test(s)) {
      if (unit) after.push({ value: parseSwedishNumber(s)!, item });
      else before.push(parseSwedishNumber(s)!);
    } else if (UNIT.test(s) && !unit) {
      unit = s;
    } else if (unit && /^\d[\d ]{2,8}$/.test(s)) {
      bare.push({ digits: s.replace(/\s/g, ''), item });
    } else if (unit) {
      unreadable = true;
    } else if (before.length === 0) {
      textParts.push(s);
    }
  }
  let quantity: number | undefined;
  let unitPrice: number | undefined;
  let amount: number | undefined;
  if (unit) {
    quantity = before[0];
    if (after.length >= 2) [unitPrice, amount] = [after[0].value, after[after.length - 1].value];
    else if (after.length === 1) {
      // One figure after the unit: the À-pris or the Belopp column, whichever it is under.
      const x = right(after[0].item);
      const isPrice = columns.price !== undefined && columns.amount !== undefined ? Math.abs(x - columns.price) < Math.abs(x - columns.amount) : quantity === 0;
      if (isPrice) unitPrice = after[0].value;
      else amount = after[0].value;
    }
    // An amount read without its comma ("126927"): it is the hours times the price.
    if (amount === undefined && quantity !== undefined && unitPrice !== undefined) {
      const expected = Math.round(quantity * unitPrice * 100) / 100;
      const fits = bare.find((b) => Math.abs(Number(b.digits) / 100 - expected) <= 0.02);
      if (fits) amount = Number(fits.digits) / 100;
      // Unreadable where the amount is printed (a smudge on a photo): the hours times the price.
      else if (unreadable || bare.length) amount = expected;
    }
  } else if (before.length >= 3) {
    [quantity, unitPrice, amount] = before;
  } else if (before.length === 2) {
    [quantity, amount] = before;
  } else if (before.length === 1) {
    amount = before[0];
  }
  const text = textParts.join(' ');
  // No figures and no dates: not a pay line (e.g. a postcode in the address of a photographed slip).
  if (quantity === undefined && amount === undefined && unitPrice === undefined && !from) return null;
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

/**
 * A price misread on a photo ("160,00" among lines at "150,00"): when the
 * line's hours times the price its other lines share give its amount, that
 * price is the one printed.
 */
function fixMisreadPrices(lines: SlipLine[]) {
  for (const line of lines) {
    const { quantity: q, unitPrice: p, amount: a } = line;
    if (!q || p === undefined || a === undefined || Math.abs(q * p - a) <= 0.05) continue;
    const shared = lines.filter((o) => o !== line && o.code === line.code && o.unitPrice !== undefined).map((o) => o.unitPrice!);
    const price = shared.find((x) => shared.filter((y) => y === x).length >= 2 && Math.abs(q * x - a) <= 0.05);
    if (price !== undefined) line.unitPrice = price;
  }
}

/**
 * A photographed slip, tilted or curved, can put a line's code and name a
 * little above or below its figures, as two rows. Each such row of code and
 * name is joined with the row of figures (without a code of its own) nearest
 * to it, if that is less than a line away.
 */
function joinSplitRows(lines: TextItem[][]): TextItem[][] {
  const isCode = (l: TextItem[]) => /^\d{3,5}$/.test(l[0]?.str.trim() ?? '');
  const figure = (i: TextItem) => DATE_RANGE.test(i.str.trim()) || NUMBER.test(tidyFigure(i.str.trim()));
  const codeOnly = (l: TextItem[]) => isCode(l) && !l.slice(1).some(figure);
  const figuresOnly = (l: TextItem[]) => !isCode(l) && l.some(figure) && l.every((i) => figure(i) || UNIT.test(i.str.trim()) || /^[\d\s.,]+$/.test(i.str.trim()) || i.str.trim().length <= 8);
  // The usual distance between rows, to know what "less than a line" is.
  const gaps = lines.slice(1).map((l, i) => lines[i][0].y - l[0].y).filter((g) => g > 0);
  const pitch = median(gaps) ?? 12;
  const used = new Set<number>();
  const joined = new Map<number, TextItem[]>();
  lines.forEach((line, i) => {
    if (!codeOnly(line)) return;
    const near = [i - 1, i + 1]
      .filter((j) => lines[j] && !used.has(j) && figuresOnly(lines[j]) && lines[j][0].x > line[0].x)
      .map((j) => ({ j, dy: Math.abs(lines[j][0].y - line[0].y) }))
      .filter((c) => c.dy < pitch * 0.8)
      .sort((a, b) => a.dy - b.dy)[0];
    if (!near) return;
    used.add(near.j);
    joined.set(i, [...line, ...lines[near.j]].sort((a, b) => a.x - b.x));
  });
  return lines.flatMap((line, i) => (used.has(i) ? [] : [joined.get(i) ?? line]));
}

/** Value printed to the right of a label on the same line. */
function valuesAfter(lines: TextItem[][], label: RegExp): { label: TextItem; value: string }[] {
  const found: { label: TextItem; value: string }[] = [];
  for (const line of lines) {
    line.forEach((item, i) => {
      // "Löneperiod:" on some slips.
      if (!label.test(item.str.trim().replace(/:$/, ''))) return;
      const next = line.slice(i + 1).find((n) => n.x > item.x + item.width - 1);
      if (next) found.push({ label: item, value: next.str.trim() });
    });
  }
  return found;
}

const rightmost = <T extends { label: TextItem }>(list: T[]) =>
  list.length ? list.reduce((a, b) => (b.label.x > a.label.x ? b : a)) : undefined;

/**
 * A photo can lose the word "Utbetalas" on its grey bar, or misread its year
 * ("2006-10-23" for 2026-10-23). The pay day is then the slip's one date shortly after the
 * period ends (1–62 days); a year misread is put right when the month and day
 * still fit. The check card shows it for the user to confirm.
 */
function payDateWithoutLabel(lines: TextItem[][], slip: PaySlip): LocalDate | undefined {
  const end = slip.periodEnd;
  if (!end) return undefined;
  const fits = (d: LocalDate) => daysBetween(end, d) >= 1 && daysBetween(end, d) <= 62;
  const year = Number(end.slice(0, 4));
  // From the bottom of the page up: the pay day is printed last.
  for (const line of [...lines].reverse()) {
    for (const item of line) {
      for (const d of datesIn(item.str)) {
        if (fits(d)) return d;
        const fixed = [year, year + 1].map((y) => `${y}${d.slice(4)}`).find(fits);
        if (fixed) return fixed;
      }
    }
  }
  return undefined;
}

export function parsePaySlip(items: TextItem[], hourlyRate?: number): PaySlip {
  const lines = joinSplitRows(groupLines(items));
  const slip: PaySlip = { lines: [], balances: {} };
  const columns = findColumns(lines);
  for (const line of lines) {
    const parsed = parseItemLine(line, hourlyRate, columns);
    if (parsed) slip.lines.push(parsed);
  }

  fixMisreadPrices(slip.lines);
  slip.employer = lines[0]?.[0]?.str.trim();

  // "Utbetalas 2026-10-23" with the amount paid out further right. On a photo the word is
  // printed on a grey bar and often misread ("uuUibgjalas"): its ending or middle will do, with a date.
  const misread = (s: string) => /^\S*(alas|betal\S*)\b/i.test(s);
  for (const line of lines) {
    const dated = (k: number) => datesIn(line[k].str).length > 0 || (!!line[k + 1] && datesIn(line[k + 1].str).length > 0);
    const idx = line.findIndex((i, k) => /^Utbetalas\b/i.test(i.str.trim()) || (misread(i.str.trim()) && dated(k)));
    if (idx < 0) continue;
    // The date in the same text, or (a photographed slip) the next cell.
    const date = datesIn(line[idx].str)[0] ?? (line[idx + 1] && datesIn(line[idx + 1].str)[0]);
    if (date) slip.payDate = date;
    const amount = line.slice(idx + 1).find((i) => NUMBER.test(i.str.trim()));
    if (amount) slip.net = parseSwedishNumber(amount.str);
  }

  findPeriod(lines, slip);
  if (!slip.payDate) slip.payDate = payDateWithoutLabel(lines, slip);

  // Bruttolön/Skatt appear in several summary blocks; the payout block is rightmost.
  const gross = rightmost(valuesAfter(lines, /^Bruttolön$/i));
  if (gross) slip.gross = parseSwedishNumber(gross.value);
  // A dash in the summary means nothing (e.g. no tax on a small extra payout).
  const figure = (v: string) => (/^[-–—]$/.test(v) ? 0 : parseSwedishNumber(v));
  const tax = rightmost(valuesAfter(lines, /^Skatt$/i));
  if (tax) slip.tax = figure(tax.value);

  // The "Skatt beräknad på" block: its Bruttolön is the taxed pay.
  const taxBlock = lines.flat().find((i) => /^Skatt beräknad på$/i.test(i.str.trim()));
  if (taxBlock) {
    const base = valuesAfter(lines, /^Bruttolön$/i).find((v) => Math.abs(v.label.x - taxBlock.x) < 5);
    if (base) slip.taxBase = parseSwedishNumber(base.value);
  }
  const table = valuesAfter(lines, /^Tabell$/i)[0];
  if (table) slip.taxTable = parseSwedishNumber(table.value);
  const oneTime = valuesAfter(lines, /^Engångsskatt\s*%?$/i)[0];
  if (oneTime) slip.oneTimeTaxPercent = parseSwedishNumber(oneTime.value);
  const deductions = valuesAfter(lines, /^Övriga avdrag$/i)[0];
  if (deductions) slip.otherDeductions = figure(deductions.value);

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
