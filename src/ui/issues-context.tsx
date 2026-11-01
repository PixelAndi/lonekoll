import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useContext, type ReactNode } from 'react';
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
  /** Everything open. */
  count: number;
}

const IssuesContext = createContext<Issues | null>(null);

export function IssuesProvider({ children }: { children: ReactNode }) {
  const owed = useOwedComputed();
  const wages = useWagePatternsComputed();
  const night = useNightComputed();
  const toCheck = useLiveQuery(() => db.slips.filter(needsCheck).count(), []) ?? 0;
  const count = (owed ? owed.likely.length + owed.investigate.length : 0) + wages.open.length + (night ? 1 : 0) + toCheck;
  return <IssuesContext.Provider value={{ owed, wages, night, toCheck, count }}>{children}</IssuesContext.Provider>;
}

export function useIssues(): Issues {
  const v = useContext(IssuesContext);
  if (!v) throw new Error('useIssues outside IssuesProvider');
  return v;
}
