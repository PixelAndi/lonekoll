// Handing files to another app the user picks (their own cloud, mail, …)
// through the phone's share sheet: only after a tap, only the files shown.

export function canShareFiles(): boolean {
  try {
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([], 'x.pdf', { type: 'application/pdf' })] });
  } catch {
    return false;
  }
}

/** Opens the share sheet with these files; false if the user closed it. */
export async function shareFiles(files: File[], title: string): Promise<boolean> {
  try {
    await navigator.share({ files, title });
    return true;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return false;
    throw e;
  }
}
