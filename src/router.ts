import { useEffect, useState } from 'react';

// Hash routes, so the phone's back button works and GitHub Pages needs no
// server rewrites.

export type Route =
  | { name: 'days'; month?: string }
  | { name: 'day'; date: string }
  | { name: 'month'; month?: string }
  | { name: 'slips' }
  | { name: 'slip'; id: string }
  | { name: 'report'; id: string }
  | { name: 'settings' };

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
    case 'slip':
      if (arg) return { name: 'slip', id: arg };
      break;
    case 'report':
      if (arg) return { name: 'report', id: arg };
      break;
    case 'settings':
      return { name: 'settings' };
    case 'days':
      return { name: 'days', month: arg };
  }
  return { name: 'days' };
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
