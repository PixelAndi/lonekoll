import { createContext, useContext } from 'react';
import type { DayRecord, Settings } from './domain/model.ts';
import type { Formatter } from './format.ts';
import type { Language, Translate } from './i18n.ts';

export interface AppData {
  settings: Settings;
  days: DayRecord[];
  lang: Language;
  t: Translate;
  fmt: Formatter;
}

export const AppContext = createContext<AppData | null>(null);

export function useApp(): AppData {
  const data = useContext(AppContext);
  if (!data) throw new Error('useApp outside AppContext');
  return data;
}
