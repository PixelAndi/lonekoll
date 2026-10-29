import type { TaxSettings } from './model.ts';

// Preliminary tax (A-skatt) from Skatteverket's monthly tax tables.
// The data (tables and municipal tax rates) is generated from Skatteverket's
// open data by scripts/fetch-tax-data.mjs and bundled with the app.

/** [incomeFrom, incomeTo (0 = no upper limit), column 1, column 3] */
export type TaxRow = [number, number, number, number];

export interface TaxTables {
  year: number;
  /** Monthly pay: table number → rows with the tax in kronor. */
  tables: Record<string, TaxRow[]>;
  /** Higher incomes: table number → rows with the tax in percent. */
  percent: Record<string, TaxRow[]>;
}

/**
 * Column 1: wages for people under 66 at the start of the year.
 * Column 3: wages for people who were 66 or older at the start of the year.
 */
export type TaxColumn = 1 | 3;

export interface Municipality {
  name: string;
  /** Municipal + regional tax + burial fee, in percent (Skatteverket's "summa, exkl. kyrkoavgift"). */
  rate: number;
  /** Church fee per parish (Svenska kyrkan), in percent. */
  parishes: { name: string; fee: number }[];
}

export interface TaxRates {
  year: number;
  municipalities: Municipality[];
}

/** Skatteverket: round the rate to a whole number; 32.50 is table 32, 32.51 is table 33. */
export function tableNumber(rate: number): number {
  const whole = Math.floor(rate);
  return rate - whole > 0.5 + 1e-9 ? whole + 1 : whole;
}

const inRow = (kronor: number, [from, to]: TaxRow) => kronor >= from && (to === 0 || kronor <= to);

export function monthlyTax(tables: TaxTables, table: number, income: number, column: TaxColumn = 1): number | undefined {
  const rows = tables.tables[String(table)];
  if (!rows || rows.length === 0) return undefined;
  const kronor = Math.floor(income);
  if (kronor <= 0) return 0;
  const pick = (row: TaxRow) => (column === 1 ? row[2] : row[3]);
  const amount = rows.find((r) => inRow(kronor, r));
  if (amount) return pick(amount);
  const percent = (tables.percent[String(table)] ?? []).find((r) => inRow(kronor, r));
  return percent ? Math.floor((kronor * pick(percent)) / 100) : undefined;
}

/** Column 3 for those who had turned 66 when the year began (for 2026: born 1959 or earlier). */
export function taxColumn(birthDate: string | undefined, year: number): TaxColumn {
  return birthDate && Number(birthDate.slice(0, 4)) <= year - 67 ? 3 : 1;
}

export type TaxBasis =
  | { kind: 'table'; table: number; rate?: number; municipality?: string; parish?: string }
  | { kind: 'percent'; percent: number }
  | { kind: 'unknown'; reason: 'no-municipality' | 'no-rates' | 'unknown-municipality' };

/** Which table (or flat rate) applies, from the tax settings. */
export function taxBasis(settings: TaxSettings, rates: TaxRates | null): TaxBasis {
  if (settings.mode === 'percent') {
    return settings.percent ? { kind: 'percent', percent: settings.percent } : { kind: 'unknown', reason: 'no-municipality' };
  }
  if (settings.mode === 'table') {
    return settings.table ? { kind: 'table', table: settings.table } : { kind: 'unknown', reason: 'no-municipality' };
  }
  if (!settings.municipality) return { kind: 'unknown', reason: 'no-municipality' };
  if (!rates) return { kind: 'unknown', reason: 'no-rates' };
  const m = rates.municipalities.find((x) => x.name === settings.municipality);
  if (!m) return { kind: 'unknown', reason: 'unknown-municipality' };
  let rate = m.rate;
  let parish: string | undefined;
  if (settings.churchMember) {
    // Without a chosen parish, use the municipality's median church fee.
    const p = m.parishes.find((x) => x.name === settings.parish);
    const fees = m.parishes.map((x) => x.fee).sort((a, b) => a - b);
    const fee = p?.fee ?? fees[Math.floor(fees.length / 2)] ?? 0;
    rate += fee;
    parish = p?.name;
  }
  // The rates have three decimals; keep them (32.502 must give table 33).
  rate = Math.round(rate * 1000) / 1000;
  return { kind: 'table', table: tableNumber(rate), rate, municipality: m.name, parish };
}

/** Tax for a month's taxable pay, or undefined if the table isn't available. */
export function taxFor(basis: TaxBasis, tables: TaxTables | null, income: number, column: TaxColumn = 1): number | undefined {
  if (basis.kind === 'percent') return Math.floor((Math.floor(income) * basis.percent) / 100);
  if (basis.kind === 'table' && tables) return monthlyTax(tables, basis.table, income, column);
  return undefined;
}
