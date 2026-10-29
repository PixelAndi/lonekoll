import { describe, expect, it } from 'vitest';
import rates2026 from './tax-data/rates-2026.json';
import tables2026 from './tax-data/tables-2026.json';
import { monthlyTax, tableNumber, taxBasis, taxColumn, taxFor, type TaxRates, type TaxTables } from './tax.ts';

// Tiny made-up tables and rates; the real ones come from Skatteverket.
const tables: TaxTables = {
  year: 2026,
  tables: {
    '32': [
      [1, 2000, 0, 0],
      [2001, 33200, 6400, 3200],
      [33201, 33400, 6450, 3250],
    ],
  },
  percent: { '32': [[33401, 0, 30, 25]] },
};

const rates: TaxRates = {
  year: 2026,
  municipalities: [
    { name: 'Exempelby', rate: 31.96, parishes: [{ name: 'Exempelby församling', fee: 1.1 }, { name: 'Annan församling', fee: 0.9 }, { name: 'Tredje', fee: 1.0 }] },
    { name: 'Halvstad', rate: 32.5, parishes: [] },
  ],
};

describe('tableNumber', () => {
  it('rounds like Skatteverket: 32.50 is table 32, 32.51 is table 33', () => {
    expect(tableNumber(31.572)).toBe(32);
    expect(tableNumber(32.5)).toBe(32);
    expect(tableNumber(32.502)).toBe(33);
    expect(tableNumber(32.51)).toBe(33);
  });
});

describe('monthlyTax', () => {
  it('looks up the row for the income in whole kronor', () => {
    expect(monthlyTax(tables, 32, 33250.75)).toBe(6450);
    expect(monthlyTax(tables, 32, 33200.99)).toBe(6400);
    expect(monthlyTax(tables, 32, 1500)).toBe(0);
  });

  it('uses the percentage above the last row, column 3 for 66+, and knows when a table is missing', () => {
    expect(monthlyTax(tables, 32, 40000)).toBe(12000);
    expect(monthlyTax(tables, 32, 33250, 3)).toBe(3250);
    expect(monthlyTax(tables, 33, 30000)).toBeUndefined();
    expect(taxColumn('1959-12-31', 2026)).toBe(3);
    expect(taxColumn('1960-01-01', 2026)).toBe(1);
  });
});

describe('taxBasis', () => {
  it('finds the table from the municipality, with or without church fee', () => {
    expect(taxBasis({ mode: 'municipality', municipality: 'Exempelby', churchMember: false }, rates)).toMatchObject({ kind: 'table', table: 32, rate: 31.96 });
    // Parish chosen: 31.96 + 0.9 = 32.86 → 33.
    expect(taxBasis({ mode: 'municipality', municipality: 'Exempelby', churchMember: true, parish: 'Annan församling' }, rates)).toMatchObject({ table: 33, rate: 32.86 });
    // No parish chosen: the median fee (1.0) → 32.96 → 33.
    expect(taxBasis({ mode: 'municipality', municipality: 'Exempelby', churchMember: true }, rates)).toMatchObject({ table: 33 });
    expect(taxBasis({ mode: 'municipality', municipality: 'Halvstad', churchMember: false }, rates)).toMatchObject({ table: 32 });
  });

  it('supports a table you enter, a flat percentage, and missing data', () => {
    expect(taxBasis({ mode: 'table', table: 31, churchMember: false }, null)).toEqual({ kind: 'table', table: 31 });
    const flat = taxBasis({ mode: 'percent', percent: 30, churchMember: false }, null);
    expect(taxFor(flat, null, 10000.5)).toBe(3000);
    expect(taxBasis({ mode: 'municipality', municipality: 'Exempelby', churchMember: false }, null)).toEqual({ kind: 'unknown', reason: 'no-rates' });
    expect(taxBasis({ mode: 'municipality', churchMember: false }, rates)).toEqual({ kind: 'unknown', reason: 'no-municipality' });
  });
});

describe('Skatteverket 2026 data', () => {
  const real = { tables: tables2026 as unknown as TaxTables, rates: rates2026 as unknown as TaxRates };

  it('gives Stockholm table 31, or 32 with the church fee', () => {
    expect(taxBasis({ mode: 'municipality', municipality: 'Stockholm', churchMember: false }, real.rates)).toMatchObject({ table: 31, rate: 30.62 });
    expect(taxBasis({ mode: 'municipality', municipality: 'Stockholm', churchMember: true, parish: 'Adolf Fredriks församling' }, real.rates)).toMatchObject({ table: 32, rate: 31.8 });
  });

  it('matches Skatteverket’s API: table 31, 30 000 kr → 5 527 kr (column 3: 2 400 kr)', () => {
    expect(monthlyTax(real.tables, 31, 30000)).toBe(5527);
    expect(monthlyTax(real.tables, 31, 30000, 3)).toBe(2400);
  });

  it('has every table from 29 to 42 and all 290 municipalities', () => {
    expect(Object.keys(real.tables.tables).map(Number)).toEqual([29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42]);
    expect(real.rates.municipalities).toHaveLength(290);
  });
});
