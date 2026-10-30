import { downloadBlob } from '../backup.ts';
import type { FoundTable } from '../ocr/pipeline.ts';

// Scanner diagnostics, when turned on in the settings: the latest camera
// frames exactly as the scanner read them, and a line per frame on what it
// made of them, kept in memory until the next scan. The user can share them
// (for example with whoever helps tune the scanner); nothing leaves the
// phone otherwise.

/** Frames kept: the latest ones, which show where the scanner got stuck or what it read. */
const MAX_FRAMES = 20;

interface Frame {
  name: string;
  blob: Blob;
}

let frames: Frame[] = [];
let lines: string[] = [];
let started = 0;
let count = 0;

export function startScanLog(video: { width: number; height: number }): void {
  frames = [];
  lines = [`Lönekoll scanner ${new Date().toISOString()}`, navigator.userAgent, `video ${video.width}×${video.height}`, ''];
  started = performance.now();
  count = 0;
}

export const hasScanLog = () => frames.length > 0;

const n = (v: number | undefined, digits = 0) => (v === undefined ? '-' : v.toFixed(digits));

/** One read frame: the canvas as the scanner read it, and what it made of it. */
export function logFrame(
  canvas: HTMLCanvasElement,
  info: { mode: string; ms: number; hint: string; found: FoundTable | null; aim?: { dx: number; dy: number; scale: number } | null; votes: number; agreed: boolean },
): void {
  count++;
  const name = `f${String(count).padStart(3, '0')}.jpg`;
  const { found, aim } = info;
  const loc = found?.loc;
  lines.push(
    [
      name,
      `t=${n((performance.now() - started) / 1000, 1)}s`,
      `${info.mode} ${n(info.ms)}ms`,
      `hint=${info.hint}`,
      found ? `date=${found.date ?? '-'} rows=${found.rows.map((r) => `${r.in ?? '?'}-${r.out ?? '?'}`).join(',') || '-'} confirmed=${found.confirmed}` : 'not found',
      loc ? `loc=${n(loc.left)},${n(loc.barTop)}–${n(loc.right)},${n(loc.barBottom)} angle=${n(loc.angle, 3)} bar=${n(found.barHeight, 1)}` : '',
      aim ? `aim dx=${n(aim.dx, 2)} dy=${n(aim.dy, 2)} scale=${n(aim.scale, 2)}` : '',
      `votes=${info.votes}${info.agreed ? ' AGREED' : ''}`,
    ]
      .filter(Boolean)
      .join(' '),
  );
  canvas.toBlob(
    (blob) => {
      if (!blob) return;
      frames = [...frames, { name, blob }].slice(-MAX_FRAMES);
    },
    'image/jpeg',
    0.92,
  );
}

export function noteScanLog(text: string): void {
  lines.push(`t=${n((performance.now() - started) / 1000, 1)}s ${text}`);
}

/** The log as a picture too, so it travels with the frames where only images can be sent. */
async function logImage(): Promise<Blob | null> {
  const wrapped = lines.flatMap((l) => l.match(/.{1,110}/g) ?? ['']);
  const canvas = document.createElement('canvas');
  canvas.width = 1400;
  canvas.height = 40 + wrapped.length * 22;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.font = '16px monospace';
  wrapped.forEach((l, i) => ctx.fillText(l, 20, 30 + i * 22));
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/** Shares the frames and the log (or saves them as a zip where sharing files isn't possible). */
export async function shareScanLog(): Promise<'shared' | 'saved' | 'cancelled'> {
  const text = lines.join('\n');
  const picture = await logImage();
  const images = [
    ...(picture ? [new File([picture], 'logg.png', { type: 'image/png' })] : []),
    ...frames.map((f) => new File([f.blob], f.name, { type: 'image/jpeg' })),
  ];
  const all = [...images, new File([text], 'logg.txt', { type: 'text/plain' })];
  for (const files of [all, images]) {
    if (!navigator.canShare?.({ files })) continue;
    try {
      await navigator.share({ files, title: 'Lönekoll', text });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    }
  }
  const { zipSync, strToU8 } = await import('fflate');
  const entries: Record<string, Uint8Array> = { 'logg.txt': strToU8(text) };
  for (const f of frames) entries[f.name] = new Uint8Array(await f.blob.arrayBuffer());
  downloadBlob(new Blob([zipSync(entries, { level: 0 }) as BlobPart], { type: 'application/zip' }), `lonekoll-skanner-${Date.now()}.zip`);
  return 'saved';
}
