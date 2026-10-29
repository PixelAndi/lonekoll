import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { AppContext, type AppData } from './app-context.ts';
import { db, loadSettings } from './db.ts';
import { formatter } from './format.ts';
import { translator } from './i18n.ts';
import { href, useRoute, type Route } from './router.ts';
import { CompareView } from './ui/CompareView.tsx';
import { Icon, Spinner } from './ui/common.tsx';
import { DayEditor } from './ui/DayEditor.tsx';
import { DaysView } from './ui/DaysView.tsx';
import { MonthView } from './ui/MonthView.tsx';
import { ReportView } from './ui/ReportView.tsx';
import { SettingsView } from './ui/SettingsView.tsx';
import { SlipsView } from './ui/SlipsView.tsx';

const TABS = [
  { route: { name: 'days' }, icon: 'days', label: 'nav.days', match: ['days', 'day'] },
  { route: { name: 'month' }, icon: 'month', label: 'nav.month', match: ['month'] },
  { route: { name: 'slips' }, icon: 'slips', label: 'nav.slips', match: ['slips', 'slip'] },
  { route: { name: 'settings' }, icon: 'settings', label: 'nav.settings', match: ['settings'] },
] as const;

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
    if (data) document.documentElement.lang = data.lang;
  }, [data]);

  if (!data) return <Spinner />;
  const { t } = data;
  const isReport = route.name === 'report';
  return (
    <AppContext.Provider value={data}>
      <div className={isReport ? 'app app-report' : 'app'}>
        {!isReport && (
          <header className="app-header no-print">
            <a href={href({ name: 'days' })} className="app-title">
              {t('app.title')}
            </a>
            <span className="app-tagline">{t('app.tagline')}</span>
          </header>
        )}
        <UpdateBanner text={t('update.available')} action={t('update.reload')} />
        <Screen route={route} />
        {!isReport && (
          <nav className="tabbar no-print">
            {TABS.map((tab) => (
              <a key={tab.label} href={href(tab.route)} className={(tab.match as readonly string[]).includes(route.name) ? 'active' : ''}>
                <Icon name={tab.icon} />
                <span>{t(tab.label)}</span>
              </a>
            ))}
          </nav>
        )}
      </div>
    </AppContext.Provider>
  );
}
