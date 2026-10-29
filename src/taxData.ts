import { useEffect, useState } from 'react';
import type { TaxRates, TaxTables } from './domain/tax.ts';

// Skatteverket's tables and municipal rates are bundled per year and only
// loaded when needed (src/domain/tax-data, made by scripts/fetch-tax-data.mjs).

const tableFiles = import.meta.glob<{ default: TaxTables }>('./domain/tax-data/tables-*.json');
const rateFiles = import.meta.glob<{ default: TaxRates }>('./domain/tax-data/rates-*.json');
const cache = new Map<string, Promise<unknown>>();

function load<T>(files: Record<string, () => Promise<{ default: T }>>, kind: string, year: number): Promise<T | null> {
  const key = `./domain/tax-data/${kind}-${year}.json`;
  if (!cache.has(key)) cache.set(key, files[key] ? files[key]().then((m) => m.default) : Promise.resolve(null));
  return cache.get(key) as Promise<T | null>;
}

export const loadTaxTables = (year: number) => load(tableFiles, 'tables', year);
export const loadTaxRates = (year: number) => load(rateFiles, 'rates', year);

/** Years with bundled municipal rates, newest first. */
export const RATE_YEARS = Object.keys(rateFiles)
  .map((f) => Number(f.match(/(\d{4})\.json$/)?.[1]))
  .sort((a, b) => b - a);

export interface TaxData {
  year: number;
  tables: TaxTables | null;
  rates: TaxRates | null;
  loading: boolean;
}

export function useTaxData(year: number): TaxData {
  const [data, setData] = useState<TaxData>({ year, tables: null, rates: null, loading: true });
  useEffect(() => {
    let alive = true;
    setData({ year, tables: null, rates: null, loading: true });
    void Promise.all([loadTaxTables(year), loadTaxRates(year)]).then(([tables, rates]) => {
      if (alive) setData({ year, tables, rates, loading: false });
    });
    return () => {
      alive = false;
    };
  }, [year]);
  return data;
}
