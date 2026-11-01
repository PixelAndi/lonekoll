import type { CardRecord, PhotoRecord, SlipRecord } from '../db.ts';
import type { DayRecord, Settings } from '../domain/model.ts';

// What is kept in Drive for restoring and for a second phone: everything
// except the files themselves, which are in Drive on their own (`files`).

export interface CloudData {
  app: 'lonekoll';
  version: 1;
  deviceId: string;
  savedAt: number;
  settings?: Settings;
  days: DayRecord[];
  photos: Omit<PhotoRecord, 'blob'>[];
  slips: Omit<SlipRecord, 'pdf'>[];
  cards: Omit<CardRecord, 'blob'>[];
  /** Drive's id of each file ("photo:<id>", "card:<id>", "slip:<id>"). */
  files: Record<string, string>;
}

export interface Local {
  days: DayRecord[];
  photos: { id: string }[];
  slips: { id: string }[];
  cards: { id: string }[];
}

export interface Merge {
  /** Days that are new, or newer in Drive. */
  days: DayRecord[];
  /** Records this phone lacks; their files are fetched from Drive. */
  photos: Omit<PhotoRecord, 'blob'>[];
  slips: Omit<SlipRecord, 'pdf'>[];
  cards: Omit<CardRecord, 'blob'>[];
}

/**
 * What to take from Drive's copy into this phone's: what was added on another
 * phone (or before a restore). Nothing on this phone is removed, and a day
 * changed on both is kept as last changed.
 */
export function mergeFromCloud(local: Local, remote: CloudData): Merge {
  const days = new Map(local.days.map((d) => [d.date, d]));
  const has = (list: { id: string }[]) => new Set(list.map((r) => r.id));
  const [photos, slips, cards] = [has(local.photos), has(local.slips), has(local.cards)];
  return {
    days: remote.days.filter((d) => {
      const mine = days.get(d.date);
      return !mine || (d.updatedAt ?? 0) > (mine.updatedAt ?? 0);
    }),
    photos: remote.photos.filter((p) => !photos.has(p.id) && remote.files[`photo:${p.id}`]),
    slips: remote.slips.filter((s) => !slips.has(s.id) && remote.files[`slip:${s.id}`]),
    cards: remote.cards.filter((c) => !cards.has(c.id) && remote.files[`card:${c.id}`]),
  };
}
