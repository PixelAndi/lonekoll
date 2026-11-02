import { useSyncExternalStore } from 'react';
import { db, loadSettings, saveSettings, type CardRecord, type CloudFileRecord, type PhotoRecord, type SlipRecord } from '../db.ts';
import { DEFAULT_CLOUD, type CloudSettings } from '../domain/model.ts';
import { askToSignIn, type SignInReason } from './signInAsk.ts';
import * as drive from './google.ts';
import { mergeFromCloud, type CloudData } from './merge.ts';
import { APPDATA, cardPlace, DATA_FILE, dueForReduce, photoPlace, ROOT, slipPlace, type DrivePlace } from './paths.ts';

// Keeping a copy in the user's Google Drive: files sorted by month for them to
// find, and the app's data for restoring or a second phone. Originals that are
// safely in Drive and older than the chosen number of days are replaced on the
// phone by small previews; the original is fetched when asked for.

export interface SyncStatus {
  phase: 'idle' | 'syncing' | 'needs-sign-in' | 'error' | 'waiting-for-wifi';
  /** Files not yet in Drive. */
  pending?: number;
  done?: number;
  error?: string;
}

let status: SyncStatus = { phase: 'idle' };
const listeners = new Set<() => void>();
function setStatus(next: SyncStatus) {
  status = next;
  for (const l of listeners) l();
}
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
}

export async function cloudSettings(): Promise<CloudSettings> {
  return { ...DEFAULT_CLOUD, ...(await loadSettings()).cloud };
}
export async function saveCloud(patch: Partial<CloudSettings>): Promise<void> {
  await saveSettings({ cloud: { ...(await cloudSettings()), ...patch } });
}

type Item =
  | { kind: 'photo'; record: PhotoRecord }
  | { kind: 'card'; record: CardRecord }
  | { kind: 'slip'; record: SlipRecord };

const keyOf = (i: Item) => `${i.kind}:${i.record.id}`;
const blobOf = (i: Item) => (i.kind === 'slip' ? i.record.pdf : i.record.blob);
const placeOf = (i: Item): DrivePlace => (i.kind === 'photo' ? photoPlace(i.record) : i.kind === 'card' ? cardPlace(i.record) : slipPlace(i.record));
const placeText = (p: DrivePlace) => [...p.folders, p.name].join('/');
const createdOf = (i: Item) => (i.kind === 'photo' ? i.record.createdAt : i.kind === 'card' ? i.record.takenAt : i.record.importedAt);

async function allItems(): Promise<Item[]> {
  const [photos, cards, slips] = await Promise.all([db.photos.toArray(), db.cards.toArray(), db.slips.toArray()]);
  return [
    ...photos.map((record) => ({ kind: 'photo' as const, record })),
    ...cards.map((record) => ({ kind: 'card' as const, record })),
    ...slips.map((record) => ({ kind: 'slip' as const, record })),
  ];
}

/** Files on this phone not yet in Drive. */
export async function pendingCount(): Promise<number> {
  const [items, done] = await Promise.all([allItems(), db.cloud.toArray()]);
  const inDrive = new Set(done.map((d) => d.key));
  return items.filter((i) => !i.record.archived && !inDrive.has(keyOf(i))).length;
}

const onCellular = () => (navigator as Navigator & { connection?: { type?: string } }).connection?.type === 'cellular';

let running: Promise<void> | undefined;

/**
 * Syncs now. `byUser`: started by a tap (may show Google's sign-in, and
 * uploads on mobile data too).
 */
export function syncNow(byUser = false): Promise<void> {
  running ??= (async () => {
    try {
      const cloud = await cloudSettings();
      if (cloud.mode !== 'drive') return;
      if (!drive.isSignedIn()) {
        if (!byUser) return setStatus({ phase: 'needs-sign-in', pending: await pendingCount() });
        await drive.signIn();
      }
      if (cloud.wifiOnly && !byUser && onCellular()) return setStatus({ phase: 'waiting-for-wifi', pending: await pendingCount() });
      await run(cloud);
      setStatus({ phase: 'idle', pending: await pendingCount() });
    } catch (e) {
      if (e instanceof drive.NeedsSignIn) setStatus({ phase: 'needs-sign-in', pending: await pendingCount() });
      else setStatus({ phase: 'error', error: e instanceof Error ? e.message : String(e), pending: await pendingCount() });
    } finally {
      running = undefined;
    }
  })();
  return running;
}

async function run(cloud: CloudSettings) {
  const deviceId = cloud.deviceId ?? crypto.randomUUID();
  const appdata = await drive.folder([ROOT, APPDATA]);
  const dataId = await drive.findFile(appdata, DATA_FILE);

  // 1. What another phone (or this one before a reset) put in Drive.
  if (dataId) {
    const remote = JSON.parse(await (await drive.download(dataId)).text()) as CloudData;
    if (remote.app === 'lonekoll' && remote.deviceId !== deviceId && remote.savedAt > (cloud.lastSync ?? 0)) await takeIn(remote, cloud);
  }

  // 2. Files not yet in Drive.
  const done = new Map((await db.cloud.toArray()).map((d) => [d.key, d]));
  const items = await allItems();
  const todo = items.filter((i) => !i.record.archived && !done.has(keyOf(i)));
  let count = 0;
  setStatus({ phase: 'syncing', pending: todo.length, done: 0 });
  for (const item of todo) {
    const place = placeOf(item);
    const blob = blobOf(item);
    const parent = await drive.folder([ROOT, ...place.folders]);
    const sent = await drive.upload({ parent, name: place.name, mime: place.mime, blob });
    if (sent.size !== blob.size) throw new Error(`${place.name}: Drive stored ${sent.size} of ${blob.size} bytes`);
    const record: CloudFileRecord = { key: keyOf(item), driveId: sent.id, size: sent.size, at: Date.now(), place: placeText(place) };
    await db.cloud.put(record);
    done.set(record.key, record);
    setStatus({ phase: 'syncing', pending: todo.length - ++count, done: count });
  }

  // Files whose place changed (a pay slip's period corrected): moved to where they now belong.
  for (const item of items) {
    const copy = done.get(keyOf(item));
    if (!copy || item.kind !== 'slip') continue;
    const place = placeOf(item);
    if (copy.place === placeText(place)) continue;
    await drive.move(copy.driveId, await drive.folder([ROOT, ...place.folders]), place.name);
    const moved = { ...copy, place: placeText(place) };
    await db.cloud.put(moved);
    done.set(moved.key, moved);
  }

  // 3. The app's data, for restoring.
  const [settings, days] = await Promise.all([loadSettings(), db.days.toArray()]);
  const data: CloudData = {
    app: 'lonekoll',
    version: 1,
    deviceId,
    savedAt: Date.now(),
    settings,
    days,
    photos: items.filter((i) => i.kind === 'photo').map((i) => strip(i.record as PhotoRecord, 'blob')),
    slips: items.filter((i) => i.kind === 'slip').map((i) => strip(i.record as SlipRecord, 'pdf')),
    cards: items.filter((i) => i.kind === 'card').map((i) => strip(i.record as CardRecord, 'blob')),
    files: Object.fromEntries([...done.values()].map((d) => [d.key, d.driveId])),
  };
  await drive.upload({ parent: appdata, name: DATA_FILE, mime: 'application/json', blob: new Blob([JSON.stringify(data)]), id: dataId });

  // 4. Old originals safely in Drive: keep only a preview on the phone.
  const now = Date.now();
  for (const item of items) {
    const copy = done.get(keyOf(item));
    if (item.record.archived || !copy || item.kind === 'photo' && item.record.kind === 'timecard') continue;
    if (!dueForReduce(createdOf(item), now, cloud.reduceAfterDays)) continue;
    const there = await drive.stat(copy.driveId);
    if (!there || there.size !== copy.size) {
      // Gone from Drive (deleted by the user): sent again next time.
      await db.cloud.delete(copy.key);
      continue;
    }
    await reduce(item);
  }

  await saveCloud({ deviceId, lastSync: Date.now(), email: cloud.email ?? (await drive.accountEmail().catch(() => undefined)) });
}

function strip<T extends object, K extends keyof T>(record: T, key: K): Omit<T, K> {
  const { [key]: _drop, ...rest } = record;
  return rest;
}

/** Adds what Drive has and this phone lacks; files older than the chosen days come as previews. */
async function takeIn(remote: CloudData, cloud: CloudSettings) {
  const local = { days: await db.days.toArray(), photos: await db.photos.toArray(), slips: await db.slips.toArray(), cards: await db.cards.toArray() };
  const fresh = !local.days.length && !local.photos.length && !local.slips.length && !local.cards.length;
  const merge = mergeFromCloud(local, remote);
  if (fresh && remote.settings) await saveSettings({ ...remote.settings, cloud: { ...cloud } });
  await db.days.bulkPut(merge.days);
  const now = Date.now();
  const total = merge.photos.length + merge.cards.length + merge.slips.length;
  let count = 0;
  const fetched = async (key: string, created: number) => {
    setStatus({ phase: 'syncing', pending: total - count, done: count++ });
    const driveId = remote.files[key];
    const blob = await drive.download(driveId);
    await db.cloud.put({ key, driveId, size: blob.size, at: now });
    if (!dueForReduce(created, now, cloud.reduceAfterDays)) return { blob, archived: false };
    return { blob: await preview(blob, key.startsWith('photo:') ? 480 : 900, /pdf/i.test(blob.type)), archived: true };
  };
  for (const p of merge.photos) {
    const { blob, archived } = p.kind === 'timecard' ? { blob: await drive.download(remote.files[`photo:${p.id}`]), archived: false } : await fetched(`photo:${p.id}`, p.createdAt);
    if (p.kind === 'timecard') await db.cloud.put({ key: `photo:${p.id}`, driveId: remote.files[`photo:${p.id}`], size: blob.size, at: now });
    await db.photos.put({ ...p, blob, archived });
  }
  for (const c of merge.cards) {
    const { blob, archived } = await fetched(`card:${c.id}`, c.takenAt);
    await db.cards.put({ ...c, blob, archived });
  }
  for (const s of merge.slips) {
    const { blob, archived } = await fetched(`slip:${s.id}`, s.importedAt);
    await db.slips.put({ ...s, pdf: blob, archived });
  }
}

async function reduce(item: Item) {
  if (item.kind === 'photo') await db.photos.update(item.record.id, { blob: await preview(item.record.blob, 480), archived: true });
  else if (item.kind === 'card') await db.cards.update(item.record.id, { blob: await preview(item.record.blob, 900), archived: true });
  else await db.slips.update(item.record.id, { pdf: await preview(item.record.pdf, 900, !/^image\//.test(item.record.pdf.type)), archived: true });
}

/** A small JPEG of a picture, or of a PDF's first page. */
async function preview(blob: Blob, width: number, pdf = false): Promise<Blob> {
  let canvas: HTMLCanvasElement;
  if (pdf) {
    canvas = (await (await import('../pdf/browser.ts')).renderPdfPages(blob, width))[0];
  } else {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, width / bitmap.width);
    canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
  }
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('preview failed'))), 'image/jpeg', 0.7));
}

/** Signed in to Drive, asking the user first (saying why) when not. */
async function signedInFor(reason: SignInReason): Promise<void> {
  if (!drive.isSignedIn()) await askToSignIn(reason, drive.signIn);
}

/** Something from Drive: asks to sign in first when needed, and once more if Google says the sign-in has run out. */
async function fromDrive<T>(reason: SignInReason, get: () => Promise<T>): Promise<T> {
  await signedInFor(reason);
  try {
    return await get();
  } catch (e) {
    if (!(e instanceof drive.NeedsSignIn)) throw e;
    await askToSignIn(reason, drive.signIn);
    return get();
  }
}

/** The original of a file kept in Drive (the user is asked to sign in when needed). */
export async function openOriginal(key: string): Promise<Blob> {
  const copy = await db.cloud.get(key);
  if (!copy) throw new Error('not in Drive');
  return fromDrive('original', () => drive.download(copy.driveId));
}

export async function signOutOfDrive(): Promise<void> {
  await drive.signOut();
  await saveCloud({ email: undefined });
  setStatus({ phase: 'idle' });
}

export async function signInToDrive(): Promise<void> {
  await drive.signIn();
}

export const signedIn = () => drive.isSignedIn();

/** Files on this phone kept only as previews (their originals in Drive). */
export async function archivedCount(): Promise<number> {
  const items = await allItems();
  return items.filter((i) => i.record.archived).length;
}

/** Brings every original back from Drive to the phone (e.g. before turning Drive off). */
export async function fetchAllOriginals(): Promise<void> {
  await signedInFor('fetchAll');
  const items = (await allItems()).filter((i) => i.record.archived);
  let count = 0;
  try {
    for (const item of items) {
      setStatus({ phase: 'syncing', pending: items.length - count, done: count++ });
      const copy = await db.cloud.get(keyOf(item));
      if (!copy) continue;
      const blob = await drive.download(copy.driveId);
      if (item.kind === 'photo') await db.photos.update(item.record.id, { blob, archived: false });
      else if (item.kind === 'card') await db.cards.update(item.record.id, { blob, archived: false });
      else await db.slips.update(item.record.id, { pdf: blob, archived: false });
    }
  } finally {
    setStatus({ phase: 'idle', pending: await pendingCount() });
  }
}
