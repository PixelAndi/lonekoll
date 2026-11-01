import { useEffect, useState } from 'react';
import { DEFAULT_CLOUD, type CloudSettings } from '../domain/model.ts';
import { openOriginal, syncNow } from './sync.ts';

/** Syncs by itself as the user chose: when the app is opened (or comes back), or every 15 or 60 minutes while open. */
export function useAutoSync(settings: CloudSettings | undefined) {
  const { mode, interval } = { ...DEFAULT_CLOUD, ...settings };
  useEffect(() => {
    if (mode !== 'drive' || interval === 'manual') return;
    void syncNow();
    const onShow = () => document.visibilityState === 'visible' && void syncNow();
    document.addEventListener('visibilitychange', onShow);
    const timer = interval === 'open' ? undefined : setInterval(() => void syncNow(), Number(interval) * 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onShow);
      if (timer) clearInterval(timer);
    };
  }, [mode, interval]);
}

/** The original of a file kept only as a preview, fetched from Drive on a tap. */
export function useOriginal(key: string) {
  const [state, setState] = useState<{ blob?: Blob; busy?: boolean; error?: string }>({});
  useEffect(() => setState({}), [key]);
  const load = async () => {
    setState({ busy: true });
    try {
      setState({ blob: await openOriginal(key) });
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : String(e) });
    }
  };
  return { ...state, load };
}
