import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { applyTheme } from './theme.ts';
import { AppContext, type AppData } from './app-context.ts';
import { db, loadSettings } from './db.ts';
import { useAutoSync } from './cloud/useCloud.ts';
import { CloudStatus, SignInAsk } from './ui/settings/CloudSettings.tsx';
import { formatter } from './format.ts';
import { isRightToLeft, LANGUAGE_TAGS, translator } from './i18n.ts';
import { href, useRoute, type Route } from './router.ts';
import { CompareView } from './ui/CompareView.tsx';
import { Icon, Spinner } from './ui/common.tsx';
import { DayEditor } from './ui/DayEditor.tsx';
import { DaysView } from './ui/DaysView.tsx';
import { MonthView } from './ui/MonthView.tsx';
import { ReportView } from './ui/ReportView.tsx';
import { SettingsView } from './ui/SettingsView.tsx';
import { HelpView } from './ui/HelpView.tsx';
import { ErrorBoundary } from './ui/ErrorBoundary.tsx';
import { TimecardImport } from './ui/TimecardImport.tsx';
import { MissingView } from './ui/MissingView.tsx';
import { SlipsView } from './ui/SlipsView.tsx';
import { IssuesView } from './ui/IssuesView.tsx';
import { TodayView } from './ui/TodayView.tsx';
import { ClockImportHost } from './ui/PhotoImport.tsx';
import { IssuesProvider, useIssues } from './ui/issues-context.tsx';

const TABS = [
  { route: { name: 'today' }, icon: 'today', label: 'nav.today', match: ['today', 'day', 'timecard'] },
  { route: { name: 'days' }, icon: 'days', label: 'nav.calendar', match: ['days', 'month'] },
  { route: { name: 'slips' }, icon: 'slips', label: 'nav.pay', match: ['slips', 'slip'] },
  { route: { name: 'issues' }, icon: 'issues', label: 'nav.issues', match: ['issues', 'missing'] },
  { route: { name: 'settings' }, icon: 'more', label: 'nav.more', match: ['settings', 'help'] },
] as const;

/** How many things are open in Ärenden, on its tab. */
function IssuesBadge() {
  const { count } = useIssues();
  return count ? <span className="tab-badge">{count > 99 ? '99+' : count}</span> : null;
}

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'day':
      return <DayEditor date={route.date} />;
    case 'month':
      return <MonthView month={route.month} />;
    case 'slips':
      return <SlipsView />;
    case 'slip':
      return <CompareView id={route.id} />;
    case 'report':
      return <ReportView id={route.id} />;
    case 'settings':
      return <SettingsView />;
    case 'help':
      return <HelpView section={route.section} />;
    case 'timecard':
      return <TimecardImport />;
    case 'missing':
      return <MissingView />;
    case 'issues':
      return <IssuesView />;
    case 'today':
      return <TodayView />;
    default:
      return <DaysView month={route.month} />;
  }
}

function UpdateBanner({ text, action }: { text: string; action: string }) {
  const [apply, setApply] = useState<(() => void) | null>(null);
  useEffect(() => {
    const onUpdate = (e: Event) => setApply(() => (e as CustomEvent<() => void>).detail);
    window.addEventListener('lonekoll:update', onUpdate);
    return () => window.removeEventListener('lonekoll:update', onUpdate);
  }, []);
  if (!apply) return null;
  return (
    <div className="update-banner no-print">
      <span>{text}</span>
      <button type="button" className="button button-small button-primary" onClick={apply}>
        {action}
      </button>
    </div>
  );
}

export function App() {
  const route = useRoute();
  const settings = useLiveQuery(loadSettings, []);
  const days = useLiveQuery(() => db.days.toArray(), []);

  const data = useMemo<AppData | null>(() => {
    if (!settings || !days) return null;
    return { settings, days, lang: settings.language, t: translator(settings.language), fmt: formatter(settings.language) };
  }, [settings, days]);

  useEffect(() => {
    if (!data) return;
    document.documentElement.lang = LANGUAGE_TAGS[data.lang];
    document.documentElement.dir = isRightToLeft(data.lang) ? 'rtl' : 'ltr';
  }, [data]);
  useAutoSync(data?.settings.cloud);
  // Once per start: slips an earlier version saved without a period or pay day are put right.
  useEffect(() => {
    void import('./pdf/browser.ts').then((m) => m.tidySavedSlips()).catch(() => undefined);
  }, []);
  const theme = data?.settings.theme;
  useEffect(() => {
    if (theme) applyTheme(theme);
  }, [theme]);

  if (!data) return <Spinner />;
  const { t } = data;
  const isReport = route.name === 'report';
  return (
    <AppContext.Provider value={data}>
      <div className={isReport ? 'app app-report' : 'app'}>
        {!isReport && (
          <header className="app-header no-print">
            <a href={href({ name: 'today' })} className="app-title">
              {t('app.title')}
            </a>
            <span className="app-tagline">{t('app.tagline')}</span>
            <CloudStatus />
            <a href={href({ name: 'help' })} className="app-help" aria-label={t('nav.help')}>
              <Icon name="help" />
            </a>
          </header>
        )}
        <UpdateBanner text={t('update.available')} action={t('update.reload')} />
        <IssuesProvider>
        <ErrorBoundary title={t('error.title')} text={t('error.text')} back={t('error.back')} details={t('error.details')} reload={t('error.reload')} resetKey={JSON.stringify(route)}>
          <Screen route={route} />
        </ErrorBoundary>
        {!isReport && (
          <nav className="tabbar no-print">
            {TABS.map((tab) => (
              <a key={tab.label} href={href(tab.route)} className={(tab.match as readonly string[]).includes(route.name) ? 'active' : ''}>
                <Icon name={tab.icon} />
                {tab.route.name === 'issues' && <IssuesBadge />}
                <span>{t(tab.label)}</span>
              </a>
            ))}
          </nav>
        )}
        </IssuesProvider>
        <ClockImportHost />
        {/* Last, so it is above any other window it is asked from (e.g. a photo's "Visa original"). */}
        <SignInAsk />
      </div>
    </AppContext.Provider>
  );
}
