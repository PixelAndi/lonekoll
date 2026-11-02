import { useEffect, useState } from 'react';
import { useApp } from '../../app-context.ts';
import { archivedCount, fetchAllOriginals, pendingCount, saveCloud, signedIn, signOutOfDrive, syncNow, useSyncStatus } from '../../cloud/sync.ts';
import { DEFAULT_CLOUD, type CloudSettings as Cloud } from '../../domain/model.ts';
import { Card, Field, Icon, Modal, Notice } from '../common.tsx';
import { useSignInAsk } from '../../cloud/signInAsk.ts';

const REDUCE_CHOICES = [7, 30, 90, 365] as const;

/** Where the data is kept: on this phone only, or also in the user's own Google Drive. */
export function CloudSettings() {
  const { t, fmt, settings } = useApp();
  const cloud: Cloud = { ...DEFAULT_CLOUD, ...settings.cloud };
  const status = useSyncStatus();
  const [counts, setCounts] = useState<{ pending: number; archived: number }>();
  const [error, setError] = useState<string>();
  const drive = cloud.mode === 'drive';

  useEffect(() => {
    void Promise.all([pendingCount(), archivedCount()]).then(([pending, archived]) => setCounts({ pending, archived }));
  }, [status, cloud.lastSync]);

  const act = async (work: () => Promise<void>) => {
    setError(undefined);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const turnOn = () =>
    act(async () => {
      await saveCloud({ mode: 'drive' });
      await syncNow(true);
    });
  const turnOff = () =>
    act(async () => {
      if (counts?.archived && confirm(t('cloud.offFetch', { n: counts.archived }))) await fetchAllOriginals();
      else if (counts?.archived && !confirm(t('cloud.offKeep'))) return;
      await saveCloud({ mode: 'local' });
    });

  const last = cloud.lastSync ? `${fmt.date(new Date(cloud.lastSync).toISOString().slice(0, 10))} ${new Date(cloud.lastSync).toTimeString().slice(0, 5)}` : undefined;

  return (
    <Card title={t('cloud.title')}>
      <div className="segmented" role="group" aria-label={t('cloud.title')}>
        <button type="button" className={!drive ? 'on' : ''} aria-pressed={!drive} onClick={() => drive && void turnOff()}>
          {t('cloud.local')}
        </button>
        <button type="button" className={drive ? 'on' : ''} aria-pressed={drive} onClick={() => !drive && void turnOn()}>
          {t('cloud.drive')}
        </button>
      </div>
      <p className="muted small">{t(drive ? 'cloud.driveText' : 'cloud.localText')}</p>
      {/* What choosing Drive means, where it is chosen. */}
      {!drive && <p className="muted small">{t('cloud.driveAbout')}</p>}
      <p className="small">
        <a href="privacy.html" target="_blank" rel="noopener noreferrer">
          {t('privacy.policyLink')}
        </a>
      </p>
      {error && <Notice kind="error">{error}</Notice>}

      {drive && (
        <>
          {status.phase === 'syncing' && <Notice>{t('cloud.syncing', { done: status.done ?? 0, n: (status.done ?? 0) + (status.pending ?? 0) })}</Notice>}
          {status.phase === 'needs-sign-in' && <Notice kind="warn">{t('cloud.needsSignIn')}</Notice>}
          {status.phase === 'waiting-for-wifi' && <Notice>{t('cloud.waitingForWifi', { n: status.pending ?? 0 })}</Notice>}
          {status.phase === 'error' && <Notice kind="error">{t('cloud.failed', { error: status.error ?? '' })}</Notice>}
          {status.phase === 'idle' && last && <Notice kind={counts?.pending ? 'info' : 'ok'}>{counts?.pending ? t('cloud.pending', { n: counts.pending, time: last }) : t('cloud.synced', { time: last })}</Notice>}
          {cloud.email && signedIn() && <p className="small">{t('cloud.account', { email: cloud.email })}</p>}
          <div className="button-row">
            <button type="button" className="button button-primary" disabled={status.phase === 'syncing'} onClick={() => void act(() => syncNow(true))}>
              {signedIn() ? t('cloud.syncNow') : t('cloud.signIn')}
            </button>
            {signedIn() && (
              <button type="button" className="button" onClick={() => void act(signOutOfDrive)}>
                {t('cloud.signOut')}
              </button>
            )}
          </div>

          <Field label={t('cloud.interval')}>
            <select value={cloud.interval} onChange={(e) => void saveCloud({ interval: e.target.value as Cloud['interval'] })}>
              {(['open', '15', '60', 'manual'] as const).map((i) => (
                <option key={i} value={i}>
                  {t(`cloud.interval.${i}`)}
                </option>
              ))}
            </select>
          </Field>
          <label className="checkbox">
            <input type="checkbox" checked={cloud.wifiOnly} onChange={(e) => void saveCloud({ wifiOnly: e.target.checked })} />
            {t('cloud.wifiOnly')}
          </label>
          <Field label={t('cloud.reduce')} hint={t('cloud.reduceHint')}>
            <select
              value={cloud.reduceAfterDays ?? 'never'}
              onChange={(e) => void saveCloud({ reduceAfterDays: e.target.value === 'never' ? null : Number(e.target.value) })}
            >
              {REDUCE_CHOICES.map((d) => (
                <option key={d} value={d}>
                  {t('cloud.reduceDays', { n: d })}
                </option>
              ))}
              <option value="never">{t('cloud.reduceNever')}</option>
            </select>
          </Field>
          {counts && counts.archived > 0 && (
            <p className="muted small">
              {t('cloud.archived', { n: counts.archived })}{' '}
              <button type="button" className="link-button" onClick={() => void act(fetchAllOriginals)}>
                {t('cloud.fetchAll')}
              </button>
            </p>
          )}
          <p className="muted small">{t('cloud.folders')}</p>
        </>
      )}
    </Card>
  );
}

/**
 * The Drive copy's state, small in the header: a cloud with how many files wait (to be signed in
 * for, on wifi, or being sent), ! when something went wrong, ✓ when all is in Drive. A tap syncs
 * now (signing in first when needed – it is a tap, so Google's window may open).
 */
export function CloudStatus() {
  const { t, settings } = useApp();
  const status = useSyncStatus();
  if (settings.cloud?.mode !== 'drive') return null;
  const n = status.pending ?? 0;
  const label =
    status.phase === 'syncing'
      ? t('cloud.statusSyncing')
      : status.phase === 'error'
        ? t('cloud.statusError')
        : status.phase === 'needs-sign-in'
          ? t('cloud.statusSignIn', { n })
          : status.phase === 'waiting-for-wifi'
            ? t('cloud.statusWifi', { n })
            : n
              ? t('cloud.statusPending', { n })
              : t('cloud.statusSynced');
  const mark = status.phase === 'syncing' ? '…' : status.phase === 'error' ? '!' : n ? (n > 99 ? '99+' : String(n)) : '✓';
  const attention = status.phase === 'error' || status.phase === 'needs-sign-in';
  return (
    <button
      type="button"
      className={`app-cloud ${attention ? 'app-cloud-attention' : ''} ${status.phase === 'syncing' ? 'app-cloud-busy' : ''}`}
      aria-label={label}
      title={label}
      disabled={status.phase === 'syncing'}
      onClick={() => void syncNow(true)}
    >
      <Icon name="cloud" />
      <span className="app-cloud-mark">{mark}</span>
    </button>
  );
}

/** The question when the app needs something from Drive and isn't signed in: why, and the button that signs in. */
export function SignInAsk() {
  const { t } = useApp();
  const ask = useSignInAsk();
  const [busy, setBusy] = useState(false);
  if (!ask) return null;
  return (
    <Modal
      title={t('signInAsk.title')}
      onClose={ask.cancel}
      footer={
        <>
          <button type="button" className="button" onClick={ask.cancel}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void ask.signIn().finally(() => setBusy(false));
            }}
          >
            {t('cloud.signIn')}
          </button>
        </>
      }
    >
      <p>{t(ask.reason === 'fetchAll' ? 'signInAsk.fetchAll' : 'signInAsk.original')}</p>
      <p className="small muted">{t('signInAsk.why')}</p>
    </Modal>
  );
}
