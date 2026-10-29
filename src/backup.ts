import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { db, type PhotoRecord, type SlipRecord } from './db.ts';
import type { DayRecord, Settings } from './domain/model.ts';

// A backup is a zip: data.json plus the photos and pay slip PDFs as files.

interface BackupData {
  app: 'lonekoll';
  version: 1;
  exportedAt: string;
  settings?: Settings;
  days: DayRecord[];
  photos: Omit<PhotoRecord, 'blob'>[];
  slips: Omit<SlipRecord, 'pdf'>[];
}

export async function exportBackup(): Promise<Blob> {
  const [settings, days, photos, slips] = await Promise.all([
    db.settings.get('settings'),
    db.days.toArray(),
    db.photos.toArray(),
    db.slips.toArray(),
  ]);
  const files: Record<string, Uint8Array> = {};
  for (const p of photos) files[`photos/${p.id}.jpg`] = new Uint8Array(await p.blob.arrayBuffer());
  for (const s of slips) files[`slips/${s.id}.pdf`] = new Uint8Array(await s.pdf.arrayBuffer());
  const data: BackupData = {
    app: 'lonekoll',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: settings?.value,
    days,
    photos: photos.map(({ blob: _blob, ...rest }) => rest),
    slips: slips.map(({ pdf: _pdf, ...rest }) => rest),
  };
  files['data.json'] = strToU8(JSON.stringify(data, null, 1));
  // Photos and PDFs are already compressed.
  const zip = zipSync(files, { level: 0 });
  return new Blob([zip as BlobPart], { type: 'application/zip' });
}

export async function importBackup(file: Blob): Promise<void> {
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  if (!files['data.json']) throw new Error('data.json missing');
  const data = JSON.parse(strFromU8(files['data.json'])) as BackupData;
  if (data.app !== 'lonekoll') throw new Error('not a Lönekoll backup');
  const photos: PhotoRecord[] = data.photos.map((p) => ({
    ...p,
    blob: new Blob([(files[`photos/${p.id}.jpg`] ?? new Uint8Array()) as BlobPart], { type: 'image/jpeg' }),
  }));
  const slips: SlipRecord[] = data.slips.map((s) => ({
    ...s,
    pdf: new Blob([(files[`slips/${s.id}.pdf`] ?? new Uint8Array()) as BlobPart], { type: 'application/pdf' }),
  }));
  await db.transaction('rw', [db.settings, db.days, db.photos, db.slips], async () => {
    await Promise.all([db.settings.clear(), db.days.clear(), db.photos.clear(), db.slips.clear()]);
    if (data.settings) await db.settings.put({ id: 'settings', value: data.settings });
    await db.days.bulkPut(data.days);
    await db.photos.bulkPut(photos);
    await db.slips.bulkPut(slips);
  });
}

export async function deleteEverything(): Promise<void> {
  await db.transaction('rw', [db.settings, db.days, db.photos, db.slips], async () => {
    await Promise.all([db.settings.clear(), db.days.clear(), db.photos.clear(), db.slips.clear()]);
  });
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
