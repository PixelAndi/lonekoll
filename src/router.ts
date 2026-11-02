import { useEffect, useState } from 'react';

// Hash routes, so the phone's back button works and GitHub Pages needs no
// server rewrites.

export type Route =
  | { name: 'today' }
  | { name: 'days'; month?: string }
  | { name: 'day'; date: string }
  | { name: 'month'; month?: string }
  | { name: 'slips' }
  | { name: 'issues' }
  | { name: 'slip'; id: string }
  | { name: 'report'; id: string }
  | { name: 'settings' }
  | { name: 'help'; section?: HelpSection }
  | { name: 'timecard' }
  | { name: 'missing' };

/** The guides under Help, one page each. */
export const HELP_SECTIONS = ['forgot', 'scan', 'slips', 'komp', 'vacation', 'night', 'offline', 'install', 'privacy'] as const;
export type HelpSection = (typeof HELP_SECTIONS)[number];

export function parseHash(hash: string): Route {
  const [name, arg] = hash.replace(/^#\/?/, '').split('/');
  switch (name) {
    case 'day':
      if (arg) return { name: 'day', date: arg };
      break;
    case 'month':
      return { name: 'month', month: arg };
    case 'slips':
      return { name: 'slips' };
    case 'issues':
      return { name: 'issues' };
    case 'slip':
      if (arg) return { name: 'slip', id: arg };
      break;
    case 'report':
      if (arg) return { name: 'report', id: arg };
      break;
    case 'settings':
      return { name: 'settings' };
    case 'timecard':
      return { name: 'timecard' };
    case 'missing':
      return { name: 'missing' };
    case 'help':
      return { name: 'help', section: (HELP_SECTIONS as readonly string[]).includes(arg) ? (arg as HelpSection) : undefined };
    case 'days':
      return { name: 'days', month: arg };
    case 'today':
      return { name: 'today' };
  }
  return { name: 'today' };
}

export function href(route: Route): string {
  switch (route.name) {
    case 'day':
      return `#/day/${route.date}`;
    case 'slip':
    case 'report':
      return `#/${route.name}/${route.id}`;
    case 'days':
    case 'month':
      return route.month ? `#/${route.name}/${route.month}` : `#/${route.name}`;
    case 'help':
      return route.section ? `#/help/${route.section}` : '#/help';
    default:
      return `#/${route.name}`;
  }
}

export function navigate(route: Route, replace = false): void {
  if (replace) location.replace(href(route));
  else location.hash = href(route);
}

export function goBack(fallback: Route): void {
  if (history.length > 1) history.back();
  else navigate(fallback, true);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const update = () => {
      setRoute(parseHash(location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return route;
}
