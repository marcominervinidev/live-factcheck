import { create } from 'zustand';

export type Theme = 'light' | 'dark';
/** `system` follows the device; a tap on the toggle pins one theme. */
export type ThemePreference = Theme | 'system';

const STORAGE_KEY = 'lfc.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

/** localStorage can be missing or throw (private mode); the app then follows the system. */
function readPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

function writePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Kept in memory for this tab only.
  }
}

/** jsdom and old browsers have no matchMedia; then the system counts as light. */
const systemQuery = (): MediaQueryList | undefined =>
  typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : undefined;

const systemTheme = (): Theme => (systemQuery()?.matches === true ? 'dark' : 'light');

const resolve = (preference: ThemePreference): Theme =>
  preference === 'system' ? systemTheme() : preference;

/** The attribute the stylesheet's `dark` variant and tokens key on (styles.css). */
function apply(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme;
}

interface ThemeStore {
  preference: ThemePreference;
  theme: Theme;
  setPreference: (preference: ThemePreference) => void;
  /** Pins the opposite of what is shown now (the header button). */
  toggle: () => void;
}

export const useTheme = create<ThemeStore>((set, get) => {
  const preference = readPreference();
  const theme = resolve(preference);
  apply(theme);
  systemQuery()?.addEventListener('change', () => {
    if (get().preference !== 'system') return;
    const next = systemTheme();
    apply(next);
    set({ theme: next });
  });
  return {
    preference,
    theme,
    setPreference: (next) => {
      writePreference(next);
      const resolved = resolve(next);
      apply(resolved);
      set({ preference: next, theme: resolved });
    },
    toggle: () => {
      get().setPreference(get().theme === 'dark' ? 'light' : 'dark');
    },
  };
});
