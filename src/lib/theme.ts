// Light / dark theme.
//
// The resolved theme lives on <html data-theme="light|dark">. An inline script
// in Base.astro sets it before the first paint (no flash). The visitor's
// explicit choice is stored in localStorage; without one we follow the OS.
// Scripts that draw their own colours (three.js scenes) subscribe with
// onThemeChange().

export type Theme = 'light' | 'dark';

export const THEME_KEY = 'rimba.theme';
export const THEME_EVENT = 'rimba:themechange';
/** <meta name="theme-color"> per theme (browser UI colour on phones). */
export const THEME_COLOR: Record<Theme, string> = { dark: '#07170f', light: '#f2f7f3' };

export function getTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function systemTheme(): Theme {
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function storedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (root.dataset.theme === theme) return;
  root.dataset.theme = theme;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
  window.dispatchEvent(new CustomEvent<Theme>(THEME_EVENT, { detail: theme }));
}

/** Save an explicit choice (or null to follow the OS again) and apply it. */
export function setTheme(theme: Theme | null) {
  try {
    if (theme) localStorage.setItem(THEME_KEY, theme);
    else localStorage.removeItem(THEME_KEY);
  } catch {}
  applyTheme(theme ?? systemTheme());
}

export function onThemeChange(cb: (theme: Theme) => void) {
  const handler = (e: Event) => cb((e as CustomEvent<Theme>).detail);
  window.addEventListener(THEME_EVENT, handler);
  return () => window.removeEventListener(THEME_EVENT, handler);
}

/** Header button + following OS changes while the visitor has not chosen. */
export function initThemeControls() {
  document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]').forEach((btn) => {
    const sync = () => {
      const next = getTheme() === 'dark' ? 'light' : 'dark';
      btn.setAttribute('aria-label', (next === 'light' ? btn.dataset.labelLight : btn.dataset.labelDark) ?? '');
      btn.title = btn.getAttribute('aria-label') ?? '';
    };
    sync();
    btn.addEventListener('click', () => setTheme(getTheme() === 'dark' ? 'light' : 'dark'));
    onThemeChange(sync);
  });
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (!storedTheme()) applyTheme(systemTheme());
  });
}
