import type { CardRecord, PhotoRecord, SlipRecord } from '../db.ts';

// Where each file goes in the user's Google Drive, sorted so it can be found
// by hand: Lönekoll / year / "2026-09 september" / what it is. Pure, so tested.

const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];

/** "Lönekoll" is the root; the app's own data for restoring is in "Lönekoll/Appdata". */
export const ROOT = 'Lönekoll';
export const APPDATA = 'Appdata';
export const DATA_FILE = 'lonekoll-data.json';

export interface DrivePlace {
  /** Folders below the root. */
  folders: string[];
  name: string;
  mime: string;
}

const monthFolders = (date: string) => {
  const ym = /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : 'utan datum';
  if (ym === 'utan datum') return [ym];
  return [ym.slice(0, 4), `${ym} ${MONTHS[Number(ym.slice(5, 7)) - 1]}`];
};
const short = (id: string) => id.replace(/-/g, '').slice(0, 6);
const isImage = (b: Blob) => /^image\//.test(b.type);

export function photoPlace(p: PhotoRecord): DrivePlace {
  // A day's rows cut from a timecard are only for the app (the whole card is in the month's folder).
  if (p.kind === 'timecard') return { folders: [APPDATA, 'Tidkortsrader'], name: `${p.date} ${short(p.id)}.jpg`, mime: 'image/jpeg' };
  return { folders: [...monthFolders(p.date), 'Stämpelklocka'], name: `${p.date} ${short(p.id)}.jpg`, mime: 'image/jpeg' };
}

export function cardPlace(c: CardRecord): DrivePlace {
  return { folders: [...monthFolders(`${c.month}-01`), 'Tidkort'], name: `Tidkort ${c.month} ${short(c.id)}.jpg`, mime: 'image/jpeg' };
}

export function slipPlace(s: SlipRecord): DrivePlace {
  const month = (s.periodStart || '').slice(0, 7);
  const photo = isImage(s.pdf);
  return {
    folders: monthFolders(s.periodStart || ''),
    name: `Lönebesked ${month || 'utan datum'} ${short(s.id)}.${photo ? 'jpg' : 'pdf'}`,
    mime: photo ? 'image/jpeg' : 'application/pdf',
  };
}

/** Whether an original kept in Drive is old enough to be replaced on the device by a preview. */
export function dueForReduce(createdAt: number, now: number, afterDays: number | null): boolean {
  return afterDays !== null && now - createdAt >= afterDays * 86_400_000;
}
