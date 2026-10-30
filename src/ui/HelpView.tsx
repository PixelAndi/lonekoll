import { useEffect, useState } from 'react';
import { useApp } from '../app-context.ts';
import { install, isInstalled, useCanInstall } from '../install.ts';
import { makeAvailableOffline, offlineStatus, type OfflineStatus } from '../offline.ts';
import { Card, Notice, Page } from './common.tsx';

// Guides: using the app without internet, putting it on the home screen, and
// stamping out on the clock after forgetting to stamp in.

export type HelpSection = 'offline' | 'install' | 'forgot';

export function HelpView({ section }: { section?: HelpSection }) {
  const { t } = useApp();
  useEffect(() => {
    if (section) document.getElementById(`help-${section}`)?.scrollIntoView();
  }, [section]);
  return (
    <Page title={t('help.title')}>
      <div id="help-forgot">
        <ForgotStampGuide />
      </div>
      <div id="help-offline">
        <OfflineGuide />
      </div>
      <div id="help-install">
        <InstallGuide />
      </div>
    </Page>
  );
}

export function ForgotStampGuide() {
  const { t } = useApp();
  return (
    <Card title={t('forgot.title')}>
      <p>{t('forgot.intro')}</p>
      <ClockButtonsSketch />
      <ol className="guide-steps">
        <li>{t('forgot.step1')}</li>
        <li>
          <strong>{t('forgot.step2')}</strong>
        </li>
        <li>{t('forgot.step3')}</li>
      </ol>
    </Card>
  );
}

/** The clock's two buttons: stamping in lit up, stamping out grey, and two taps on the grey one. */
function ClockButtonsSketch() {
  const { t } = useApp();
  return (
    <svg className="clock-buttons" viewBox="0 0 320 120" role="img" aria-label={t('forgot.step2')} direction="ltr">
      <rect x="20" y="25" width="120" height="70" rx="12" className="clock-button-in" />
      <text x="80" y="68" textAnchor="middle">
        In
      </text>
      <rect x="180" y="25" width="120" height="70" rx="12" className="clock-button-out" />
      <text x="240" y="68" textAnchor="middle">
        Ut
      </text>
      {/* Two taps on the grey button. */}
      <g className="clock-taps">
        <circle cx="262" cy="84" r="9" />
        <circle cx="262" cy="84" r="17" />
      </g>
      <text x="300" y="20" textAnchor="end" className="clock-taps-label">
        2 ×
      </text>
    </svg>
  );
}

function OfflineGuide() {
  const { t } = useApp();
  const [status, setStatus] = useState<OfflineStatus | 'working' | 'reload' | 'failed' | null>(null);
  useEffect(() => {
    void offlineStatus().then(setStatus);
  }, []);
  const run = async () => {
    setStatus('working');
    setStatus(await makeAvailableOffline());
  };
  return (
    <Card title={t('offline.title')}>
      <p>{t('offline.text')}</p>
      {status === 'ready' ? (
        <Notice kind="ok">{t('offline.ready')}</Notice>
      ) : status === 'unsupported' ? (
        <Notice kind="warn">{t('offline.unsupported')}</Notice>
      ) : (
        <>
          {status === 'reload' && <Notice kind="warn">{t('offline.reload')}</Notice>}
          {status === 'failed' && <Notice kind="error">{t('offline.failed')}</Notice>}
          <button type="button" className="button button-primary" disabled={status === 'working'} onClick={run}>
            {t(status === 'working' ? 'offline.working' : 'offline.button')}
          </button>
        </>
      )}
    </Card>
  );
}

function InstallGuide() {
  const { t } = useApp();
  const canInstall = useCanInstall();
  return (
    <Card title={t('install.title')}>
      <p>{t('install.text')}</p>
      {isInstalled() ? (
        <Notice kind="ok">{t('install.installed')}</Notice>
      ) : (
        <>
          {canInstall && (
            <button type="button" className="button button-primary" onClick={() => void install()}>
              {t('install.button')}
            </button>
          )}
          <ul className="guide-steps">
            <li>{t('install.android')}</li>
            <li>{t('install.iphone')}</li>
          </ul>
        </>
      )}
    </Card>
  );
}
