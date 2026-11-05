// Handing files to another app the user picks (their own cloud, mail, …)
// through the phone's share sheet: only after a tap, only the files shown.
// And passing on the app itself: its address, nothing else.

export function canShareFiles(): boolean {
  try {
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([], 'x.pdf', { type: 'application/pdf' })] });
  } catch {
    return false;
  }
}

/** Opens the share sheet with these files; false if the user closed it. */
export const shareFiles = (files: File[], title: string): Promise<boolean> => openShareSheet({ files, title });

/**
 * The app's own address, for passing the app on to a colleague: the page it is running from, without
 * anything after it (no day, no slip – nothing of the user's).
 */
export function appAddress(): string {
  return `${location.origin}${location.pathname.replace(/index\.html$/, '')}`;
}

export const canShareLink = () => typeof navigator.share === 'function';

/** Opens the share sheet with the app's address; false if the user closed it. */
export const shareAppLink = (title: string, text: string): Promise<boolean> => openShareSheet({ title, text, url: appAddress() });

async function openShareSheet(data: ShareData): Promise<boolean> {
  try {
    await navigator.share(data);
    return true;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return false;
    throw e;
  }
}
