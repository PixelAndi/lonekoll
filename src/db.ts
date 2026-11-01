import Dexie, { type Table } from 'dexie';
import { DEFAULT_SETTINGS, type DayRecord, type Settings } from './domain/model.ts';
import type { PaySlip } from './domain/payslip.ts';
import { EMPTY_MEMORY, learn, type DigitMemory, type LearnMaterial } from './ocr/glyphs.ts';
import type { LocalDate } from './domain/time.ts';

// Everything is stored in the browser's IndexedDB on this device only.

export interface PhotoRecord {
  id: string;
  date: LocalDate;
  blob: Blob;
  createdAt: number;
  /** A photo of the clock (the default), or the day's rows cut from a timecard (see cardId). */
  kind?: 'clock' | 'timecard';
  /** The timecard picture the rows were cut from. */
  cardId?: string;
  /** The original is in Google Drive; `blob` is a small preview of it. */
  archived?: boolean;
}

/** A picture of a printed timecard, kept as the source of the days read from it. */
export interface CardRecord {
  id: string;
  /** "2026-03". */
  month: string;
  from?: string;
  to?: string;
  takenAt: number;
  blob: Blob;
  /** The original is in Google Drive; `blob` is a small preview of it. */
  archived?: boolean;
}

/** A file copied to Google Drive: which, where, and when ("photo:<id>", "card:<id>", "slip:<id>"). */
export interface CloudFileRecord {
  key: string;
  driveId: string;
  size: number;
  at: number;
}

export interface SlipRecord {
  id: string;
  fileName: string;
  importedAt: number;
  periodStart: string;
  slip: PaySlip;
  /** The PDF (or photo) of the slip; a small preview when `archived`. */
  pdf: Blob;
  /** The original is in Google Drive (everything the app needs from it was read into `slip`). */
  archived?: boolean;
}

/** What the scanner has learned of the clock's digits (see ocr/glyphs.ts). */
export interface LearningRecord extends DigitMemory {
  id: 'digits';
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
  learning!: Table<LearningRecord, string>;
  cards!: Table<CardRecord, string>;
  cloud!: Table<CloudFileRecord, string>;

  constructor() {
    super('lonekoll');
    this.version(1).stores({
      days: 'date',
      photos: 'id, date',
      slips: 'id, periodStart',
      settings: 'id',
    });
    this.version(2).stores({ learning: 'id' });
    this.version(3).stores({ cards: 'id, month' });
    this.version(4).stores({ cloud: 'key' });
  }
}

export const db = new LonekollDB();

export function newId(): string {
  return crypto.randomUUID();
}

const OLD_DEFAULT_SHIFT = 9 * 60 + 15;

export async function loadSettings(): Promise<Settings> {
  const record = await db.settings.get('settings');
  if (!record) {
    // First start: follow the phone's language.
    const phone = (navigator.language ?? '').toLowerCase();
    // Dari is close enough to Persian that a phone set to either gets Dari.
    const language = phone.startsWith('sv') ? 'sv' : phone.startsWith('pl') ? 'pl' : phone.startsWith('prs') || phone.startsWith('fa') ? 'prs' : 'en';
    return { ...DEFAULT_SETTINGS, language };
  }
  // Nested settings are merged too, so fields added in later versions get defaults.
  const value = record.value;
  // The first versions saved the agreement's 9:15 as the default shift length;
  // unless the user chose it themselves, the default is now 8:00.
  const ordinaryShift = !value.ordinaryShiftChosen && value.ordinaryShiftMinutes === OLD_DEFAULT_SHIFT ? { ordinaryShiftMinutes: DEFAULT_SETTINGS.ordinaryShiftMinutes } : {};
  return {
    ...DEFAULT_SETTINGS,
    ...value,
    ...ordinaryShift,
    supplements: { ...DEFAULT_SETTINGS.supplements, ...value.supplements },
    tax: { ...DEFAULT_SETTINGS.tax, ...value.tax },
    schedule: value.schedule ?? DEFAULT_SETTINGS.schedule,
  };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const current = await loadSettings();
  await db.settings.put({ id: 'settings', value: { ...current, ...patch } });
}

export async function loadDigitMemory(): Promise<DigitMemory> {
  return (await db.learning.get('digits')) ?? EMPTY_MEMORY;
}

/** Learns the clock's digits from a saved scan: the times as saved, corrections included. */
export async function learnDigits(material: LearnMaterial, saved: { in: string | null; out: string | null }[]): Promise<void> {
  const before = await loadDigitMemory();
  const after = learn(before, material, saved);
  if (after !== before) await db.learning.put({ ...after, id: 'digits' });
}

export async function forgetDigits(): Promise<void> {
  await db.learning.clear();
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
