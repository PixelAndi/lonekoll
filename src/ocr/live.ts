import { downscale, estimateTilt, locateTable, LOOSE, straighten, type RGBAImage } from './image.ts';
import type { ClockReading } from './pipeline.ts';

// Checks camera frames while scanning: is the clock's table in the guide,
// close enough and straight? Steadiness is judged across frames. Runs a few
// times a second on a small copy of the frame, so it only locates the table
// and never runs OCR.

/** Width of the analysed copy of each frame. */
export const ANALYSIS_WIDTH = 640;

/**
 * The guide drawn on the camera view, in frame pixels: a wide box centred in
 * the frame, with the coloured date bar along its top.
 */
export function guideBox(width: number, height: number) {
  const w = width * 0.9;
  const h = Math.min(height * 0.8, w * 0.4);
  const left = (width - w) / 2;
  const top = (height - h) / 2;
  return { left, top, width: w, height: h, barY: top + h * 0.17 };
}

export type FrameStatus =
  /** No table in view. */
  | 'searching'
  /** The table is too small: move closer. */
  | 'closer'
  /** The table runs off the edge of the frame: move back. */
  | 'further'
  /** Tilted: hold the phone level with the screen. */
  | 'straighten'
  /** Not in the guide. */
  | 'center'
  | 'ok';

export interface FrameCheck {
  status: FrameStatus;
  /** The date bar, in the coordinates of the image that was checked. */
  bar?: { left: number; right: number; top: number; bottom: number; angle: number };
}

type Bar = NonNullable<FrameCheck['bar']>;

/** The table hardly moved between two checks (a moving phone gives blurred photos). */
export function isSteady(previous: Bar | undefined, current: Bar | undefined): boolean {
  if (!previous || !current) return false;
  const width = current.right - current.left;
  const moved = Math.max(Math.abs(previous.left - current.left), Math.abs(previous.right - current.right), Math.abs(previous.top - current.top));
  return moved < width * 0.02;
}

/** Share of the image in the date bar's colours. */
function barColorShare(img: RGBAImage): number {
  let n = 0;
  for (let i = 0; i < img.data.length; i += 4) if (LOOSE.bar(img.data[i], img.data[i + 1], img.data[i + 2])) n++;
  return n / (img.width * img.height);
}

export function checkFrame(frame: RGBAImage): FrameCheck {
  const img = downscale(frame, ANALYSIS_WIDTH);
  const loc = locateTable(img) ?? locateTable(img, LOOSE);
  if (!loc) {
    // A strongly tilted table isn't found row by row; say so if that's why.
    const tilt = estimateTilt(img);
    const straight = Math.abs(tilt) > 0.04 ? straighten(img, tilt) : null;
    if (straight && (locateTable(straight) ?? locateTable(straight, LOOSE))) return { status: 'straighten' };
    // The bar's colour is in view but too small to find: probably too far away.
    return { status: barColorShare(img) > 0.001 ? 'closer' : 'searching' };
  }
  const bar = { left: loc.left, right: loc.right, top: loc.barTop, bottom: loc.barBottom, angle: loc.angle };
  const guide = guideBox(img.width, img.height);
  const width = loc.right - loc.left;
  const result = (status: FrameStatus): FrameCheck => ({ status, bar });

  if (loc.left <= 2 || loc.right >= img.width - 3) return result('further');
  // Camera frames have fewer pixels than photos: the bar must nearly fill the guide to be readable.
  if (width < guide.width * 0.8) return result('closer');
  if (Math.abs(loc.angle) > 0.04) return result('straighten');
  const barY = (loc.barTop + loc.barBottom) / 2;
  const barX = (loc.left + loc.right) / 2;
  if (Math.abs(barY - guide.barY) > guide.height * 0.15 || Math.abs(barX - img.width / 2) > img.width * 0.08) return result('center');
  return result('ok');
}

/** A reading good enough to accept without another try: date, times, nothing doubtful. */
export function readingComplete(reading: ClockReading): boolean {
  return (
    reading.date !== null &&
    reading.rows.length > 0 &&
    reading.issues.length === 0 &&
    !reading.rows.some((r) => r.inUncertain || r.outUncertain)
  );
}
