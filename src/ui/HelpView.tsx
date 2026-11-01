import { useEffect, useState } from 'react';
import { useApp } from '../app-context.ts';
import { install, isInstalled, useCanInstall } from '../install.ts';
import { makeAvailableOffline, offlineStatus, type OfflineStatus } from '../offline.ts';
import type { TextKey } from '../i18n.ts';
import { href, type HelpSection } from '../router.ts';
import { Card, Icon, Notice, Page } from './common.tsx';
import { Cited } from './Cited.tsx';
import { GuideArt } from './guideArt.tsx';

// Help and guides: a menu by topic, and each guide on a page of its own, so
// the one you need isn't buried among the others.

type GuideCategory = { title: TextKey; guides: HelpSection[] };

const CATEGORIES: GuideCategory[] = [
  { title: 'help.cat.clock', guides: ['forgot', 'scan'] },
  { title: 'help.cat.pay', guides: ['slips', 'komp', 'vacation', 'night'] },
  { title: 'help.cat.app', guides: ['install', 'offline', 'privacy'] },
];

const TITLES: Record<HelpSection, TextKey> = {
  forgot: 'forgot.title',
  scan: 'guide.scan.title',
  slips: 'guide.slips.title',
  komp: 'guide.komp.title',
  vacation: 'guide.vacation.title',
  night: 'guide.night.title',
  offline: 'offline.title',
  install: 'install.title',
  privacy: 'guide.privacy.title',
};

export function HelpView({ section }: { section?: HelpSection }) {
  const { t } = useApp();
  if (!section) {
    return (
      <Page title={t('help.title')}>
        <p className="muted">{t('help.intro')}</p>
        {CATEGORIES.map((category) => (
          <section key={category.title} className="help-category">
            <h2>{t(category.title)}</h2>
            <ul className="help-menu">
              {category.guides.map((guide) => (
                <li key={guide}>
                  <a href={href({ name: 'help', section: guide })}>
                    <span>
                      <strong>{t(TITLES[guide])}</strong>
                      <span className="muted small">{t(`guide.${guide}.summary`)}</span>
                    </span>
                    <Icon name="chevronRight" />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </Page>
    );
  }
  return (
    <Page title={t('help.title')}>
      <a className="help-back" href={href({ name: 'help' })}>
        <Icon name="chevronLeft" /> {t('help.all')}
      </a>
      <Guide section={section} />
    </Page>
  );
}

function Guide({ section }: { section: HelpSection }) {
  switch (section) {
    case 'forgot':
      return <ForgotStampGuide />;
    case 'offline':
      return <OfflineGuide />;
    case 'install':
      return <InstallGuide />;
    case 'privacy':
      return <PrivacyGuide />;
    case 'scan':
      return <StepsGuide section="scan" tip="guide.scan.tip" />;
    case 'slips':
      return <StepsGuide section="slips" tip="slips.privacy" />;
    case 'night':
      return <NightGuide />;
    default:
      return <StepsGuide section={section} />;
  }
}

/** A guide of four numbered steps, and an optional tip. */
function StepsGuide({ section, tip }: { section: 'scan' | 'slips' | 'komp' | 'vacation'; tip?: TextKey }) {
  const { t } = useApp();
  return (
    <Card title={t(TITLES[section])}>
      <p>{t(`guide.${section}.summary`)}</p>
      <ol className="picture-steps">
        {([1, 2, 3, 4] as const).map((n) => (
          <li key={n}>
            <GuideArt name={`${section}${n}`} />
            <span>
              <Cited text={t(`guide.${section}.${n}`)} />
            </span>
          </li>
        ))}
      </ol>
      {tip && <p className="small">{t(tip)}</p>}
    </Card>
  );
}

/** Shift and night work: the shorter week, and how it is paid. */
function NightGuide() {
  const { t } = useApp();
  return (
    <Card title={t('guide.night.title')}>
      <p>{t('guide.night.summary')}</p>
      <table className="table small">
        <tbody>
          {(['day', 'twoShift', 'threeShift', 'continuous', 'night'] as const).map((k) => (
            <tr key={k}>
              <td>{t(`guide.night.kind.${k}`)}</td>
              <td className="num">{t(`guide.night.hours.${k}`)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        <Cited text={t('guide.night.1')} />
      </p>
      <p>
        <Cited text={t('guide.night.2')} />
      </p>
      <p>
        <Cited text={t('guide.night.3')} />
      </p>
      <p className="small">{t('guide.night.4')}</p>
    </Card>
  );
}

function PrivacyGuide() {
  const { t } = useApp();
  return (
    <Card title={t('guide.privacy.title')}>
      <GuideArt name="privacy" />
      <p>{t('privacy.full')}</p>
      <p className="small">{t('slips.privacy')}</p>
    </Card>
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
      <ol className="picture-steps">
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
      <GuideArt name="offline" />
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
      <GuideArt name="install" />
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
