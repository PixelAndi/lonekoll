import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useApp } from '../app-context.ts';
import { todayLocal } from '../domain/time.ts';
import { vacationLedger, type VacationStep } from '../domain/vacationDays.ts';
import { applyOverrides } from './slipComparison.ts';
import { db } from '../db.ts';
import type { NightWork } from '../domain/night.ts';
import type { WagePattern } from '../domain/wageHistory.ts';
import { useNightComputed } from './NightWork.tsx';
import { useOwedComputed, type OwedWithIds } from './Owed.tsx';
import { needsCheck } from './SlipCheck.tsx';
import { useWagePatternsComputed } from './WageFromSlips.tsx';

// What the app has found to look at, worked out once for the whole app (the
// Ärenden page, its tab's badge and the line on the days page all read it).

export interface Issues {
  owed: OwedWithIds | null;
  wages: { patterns: WagePattern[]; open: WagePattern[] };
  night: NightWork | null;
  /** Slips whose reading should be checked. */
  toCheck: number;
  /** Slips read again with something new or missing, waiting for the user's choice. */
  readAgain: number;
  /** Vacation balances on the slips that don't follow from the days taken (not yet said to be right). */
  vacation: VacationStep[];
  /** Everything open. */
  count: number;
}

const IssuesContext = createContext<Issues | null>(null);

export function IssuesProvider({ children }: { children: ReactNode }) {
  const owed = useOwedComputed();
  const wages = useWagePatternsComputed();
  const night = useNightComputed();
  const toCheck = useLiveQuery(() => db.slips.filter(needsCheck).count(), []) ?? 0;
  const readAgain = useLiveQuery(() => db.slips.filter((r) => !!r.candidate).count(), []) ?? 0;
  const { settings } = useApp();
  const records = useLiveQuery(() => db.slips.toArray(), []);
  const vacation = useMemo(() => {
    try {
      const steps = vacationLedger((records ?? []).map((r) => applyOverrides(r.slip, settings.codeOverrides)), settings, todayLocal()).steps;
      return steps.filter((s) => s.mismatch && !(settings.checksOk ?? []).includes(vacationCheckKey(s)));
    } catch {
      return [];
    }
  }, [records, settings]);
  const count = (owed ? owed.likely.length + owed.investigate.length : 0) + wages.open.length + (night ? 1 : 0) + toCheck + readAgain + vacation.length;
  return <IssuesContext.Provider value={{ owed, wages, night, toCheck, readAgain, vacation, count }}>{children}</IssuesContext.Provider>;
}

export function useIssues(): Issues {
  const v = useContext(IssuesContext);
  if (!v) throw new Error('useIssues outside IssuesProvider');
  return v;
}

/** A vacation check's key, for "Det stämmer". */
export const vacationCheckKey = (s: VacationStep) => `vacation:${s.month}:${s.payDate ?? ''}`;
