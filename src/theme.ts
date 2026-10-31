import type { Theme } from './domain/model.ts';

// Light or dark look. The choice is also kept in the browser's own storage so
// the page starts in it, before the settings have loaded from the database.

const KEY = 'lonekoll-theme';
const COLORS = { light: '#1d5c87', dark: '#15171a' };

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = theme;
  const dark = theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? COLORS.dark : COLORS.light);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Storage blocked: the theme still applies once the settings have loaded.
  }
}

/** The last chosen theme, applied at start-up. */
export function applySavedTheme(): void {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'auto') applyTheme(saved);
  } catch {
    // Nothing saved, or storage blocked.
  }
}
