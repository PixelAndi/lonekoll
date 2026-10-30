import { useSyncExternalStore } from 'react';

// Adding the app to the home screen. Chrome and Edge offer it through an
// event the page can keep and use for an "Install" button; Safari has no such
// event, so the guide explains the share menu instead.

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Called once at start-up, before the browser fires the event. */
export function listenForInstall(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPrompt;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

export const isInstalled = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Whether the browser can show its install dialog now. */
export function useCanInstall(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => deferred !== null,
  );
}

export async function install(): Promise<boolean> {
  const prompt = deferred;
  if (!prompt) return false;
  await prompt.prompt();
  const choice = await prompt.userChoice;
  deferred = null;
  notify();
  return choice.outcome === 'accepted';
}
