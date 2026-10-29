import Dexie, { type Table } from 'dexie';
import { DEFAULT_SETTINGS, type DayRecord, type Settings } from './domain/model.ts';
import type { PaySlip } from './domain/payslip.ts';
import type { LocalDate } from './domain/time.ts';

// Everything is stored in the browser's IndexedDB on this device only.

export interface PhotoRecord {
  id: string;
  date: LocalDate;
  blob: Blob;
  createdAt: number;
}

export interface SlipRecord {
  id: string;
  fileName: string;
  importedAt: number;
  periodStart: string;
  slip: PaySlip;
  pdf: Blob;
}

interface SettingsRecord {
  id: 'settings';
  value: Settings;
}

class LonekollDB extends Dexie {
  days!: Table<DayRecord, string>;
  photos!: Table<PhotoRecord, string>;
  slips!: Table<SlipRecord, string>;
  settings!: Table<SettingsRecord, string>;

  constructor() {
    super('lonekoll');
    this.version(1).stores({
      days: 'date',
      photos: 'id, date',
      slips: 'id, periodStart',
      settings: 'id',
    });
  }
}

export const db = new LonekollDB();

export function newId(): string {
  return crypto.randomUUID();
}

export async function loadSettings(): Promise<Settings> {
  const record = await db.settings.get('settings');
  if (!record) {
    // First start: follow the phone's language.
    const sv = (navigator.language ?? '').toLowerCase().startsWith('sv');
    return { ...DEFAULT_SETTINGS, language: sv ? 'sv' : 'en' };
  }
  return { ...DEFAULT_SETTINGS, ...record.value };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const current = await loadSettings();
  await db.settings.put({ id: 'settings', value: { ...current, ...patch } });
}

export async function saveDay(day: DayRecord): Promise<void> {
  const empty = day.rows.length === 0 && !day.absence && !day.note && day.photoIds.length === 0;
  if (empty) await db.days.delete(day.date);
  else await db.days.put({ ...day, updatedAt: Date.now() });
  void requestPersistence();
}

export async function deleteDay(date: LocalDate): Promise<void> {
  await db.transaction('rw', db.days, db.photos, async () => {
    await db.photos.where('date').equals(date).delete();
    await db.days.delete(date);
  });
}

/** Ask the browser not to evict our data when space runs low. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function isPersisted(): Promise<boolean> {
  try {
    return (await navigator.storage?.persisted?.()) ?? false;
  } catch {
    return false;
  }
}
