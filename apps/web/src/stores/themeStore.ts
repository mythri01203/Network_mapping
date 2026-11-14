import { create } from 'zustand';

/**
 * Light or dark look for the whole app, chosen with the sun/moon button in the top bar and kept on
 * this device. Dark is the default (the app's own look). Only colours change (see `index.css`).
 */
export type Theme = 'dark' | 'light';

const KEY = 'fibergis.theme';

function read(): Theme {
  try {
    return window.localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function apply(theme: Theme) {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme;
}

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>()((set, get) => {
  const initial = typeof window === 'undefined' ? 'dark' : read();
  apply(initial);
  const setTheme = (theme: Theme) => {
    apply(theme);
    try {
      window.localStorage.setItem(KEY, theme);
    } catch {
      // Private window or blocked storage: the choice lasts until the page is closed.
    }
    set({ theme });
  };
  return {
    theme: initial,
    setTheme,
    toggle: () => setTheme(get().theme === 'dark' ? 'light' : 'dark'),
  };
});
