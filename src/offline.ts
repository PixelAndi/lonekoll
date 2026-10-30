import { requestPersistence } from './db.ts';
import { prepareRecognition } from './ocr/browser.ts';

// Making the app work without internet. The service worker (sw-template.js)
// saves the app's own files when it installs; text recognition for the
// scanner (about 7 MB) is saved the first time it is used. "Make available
// offline" uses it once, so it is saved straight away.

/** The service worker's cache for the text recognition files (sw-template.js). */
const OCR_CACHE = 'lonekoll-ocr-v1';

export type OfflineStatus = 'ready' | 'partial' | 'unsupported';

export async function offlineStatus(): Promise<OfflineStatus> {
  if (!('caches' in window) || !('serviceWorker' in navigator)) return 'unsupported';
  if (!navigator.serviceWorker.controller) return 'partial';
  try {
    const urls = (await (await caches.open(OCR_CACHE)).keys()).map((r) => r.url);
    const has = (part: string) => urls.some((u) => u.includes(part));
    return has('/ocr/worker') && has('/ocr/core/') && has('/ocr/lang/') ? 'ready' : 'partial';
  } catch {
    return 'unsupported';
  }
}

/** 'reload': the page isn't run by the service worker yet (first visit); open it again and retry. */
export async function makeAvailableOffline(): Promise<OfflineStatus | 'reload' | 'failed'> {
  if ((await offlineStatus()) === 'unsupported') return 'unsupported';
  if (!navigator.serviceWorker.controller) return 'reload';
  try {
    await prepareRecognition();
    // The pay slip reader is part of the app's saved files; loading it checks it is there.
    await import('./pdf/browser.ts');
  } catch {
    return 'failed';
  }
  void requestPersistence();
  return offlineStatus();
}
