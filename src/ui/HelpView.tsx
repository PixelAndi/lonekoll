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
      <ForgotCase stamp="out" />
      <ForgotCase stamp="in" />
      <p className="small">
        <strong>{t('forgot.dont')}</strong>
      </p>
      <p className="small">{t('forgot.after')}</p>
    </Card>
  );
}

type Button = 'in' | 'out';

/**
 * Stamping with the button that isn't lit: as it looks, after one press (now
 * lit), and the second press that stamps.
 */
function ForgotCase({ stamp }: { stamp: Button }) {
  const { t } = useApp();
  const other: Button = stamp === 'in' ? 'out' : 'in';
  const steps = [
    { lit: other, taps: 0, text: t(`forgot.${stamp}1`) },
    { lit: other, taps: 1, text: t(`forgot.${stamp}2`) },
    { lit: stamp, taps: 2, text: t(`forgot.${stamp}3`) },
  ];
  return (
    <section className="forgot-case">
      <h3>{t(stamp === 'out' ? 'forgot.outTitle' : 'forgot.inTitle')}</h3>
      <ol className="forgot-steps">
        {steps.map((step, i) => (
          <li key={i}>
            <ClockButtons lit={step.lit} press={step.taps ? stamp : undefined} count={step.taps} label={step.text} />
            <span>{step.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * The clock's two buttons as they look on its screen: In (an arrow into a
 * bracket) and Out (an arrow out of one), the lit one green or red, the other
 * grey. `press` marks the button being pressed, with how many times so far.
 */
function ClockButtons({ lit, press, count, label }: { lit: Button; press?: Button; count: number; label: string }) {
  const { t } = useApp();
  // Pressing the grey button once lights it up; the picture shows the result.
  const shown: Button = press && count >= 1 ? press : lit;
  return (
    <svg className="clock-buttons" viewBox="0 0 240 150" role="img" aria-label={label} direction="ltr">
      {(['in', 'out'] as const).map((button, i) => {
        const x = 10 + i * 120;
        const on = button === shown;
        return (
          <g key={button} transform={`translate(${x} 10)`} className={`clock-button clock-button-${button}${on ? ' is-lit' : ''}`}>
            <rect className="clock-button-frame" x="4" y="4" width="92" height="92" rx="10" />
            {button === 'in' ? (
              <>
                {/* ⊐ with an arrow going in */}
                <path className="clock-icon" d="M40 26 H70 V74 H40 V64 H60 V36 H40 Z" />
                <path className="clock-icon" d="M22 45 H42 V37 L56 50 L42 63 V55 H22 Z" />
              </>
            ) : (
              <>
                {/* ⊏ with an arrow going out */}
                <path className="clock-icon" d="M60 26 H30 V74 H60 V64 H40 V36 H60 Z" />
                <path className="clock-icon" d="M46 45 H64 V37 L78 50 L64 63 V55 H46 Z" />
              </>
            )}
            <text x="50" y="122" textAnchor="middle" className="clock-button-name">
              {t(button === 'in' ? 'forgot.inButton' : 'forgot.outButton')}
            </text>
            {press === button && count > 0 && (
              <g className="clock-press">
                <circle cx="74" cy="78" r="16" />
                <text x="74" y="84" textAnchor="middle">
                  {count}
                </text>
              </g>
            )}
          </g>
        );
      })}
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
