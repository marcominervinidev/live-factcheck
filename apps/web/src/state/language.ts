import { create } from 'zustand';

export type Language = 'de' | 'en';
/** `system` follows the device language; a choice in the settings pins one (ADR 0020). */
export type LanguagePreference = Language | 'system';

const STORAGE_KEY = 'lfc.language';

/** localStorage can be missing or throw (private mode); the app then follows the device. */
function readPreference(): LanguagePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'de' || stored === 'en' ? stored : 'system';
  } catch {
    return 'system';
  }
}

function writePreference(preference: LanguagePreference): void {
  try {
    if (preference === 'system') window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Kept in memory for this tab only.
  }
}

/** German devices get German, everyone else English (jsdom reports en-US); an empty value
 * counts as German, the app's home audience. */
const systemLanguage = (): Language => {
  const device = window.navigator.language;
  if (typeof device !== 'string' || device === '') return 'de';
  return device.toLowerCase().startsWith('de') ? 'de' : 'en';
};

const resolve = (preference: LanguagePreference): Language =>
  preference === 'system' ? systemLanguage() : preference;

/** Assistive tech and hyphenation key on the document language (ADR 0020). */
function apply(language: Language): void {
  document.documentElement.lang = language;
}

interface LanguageStore {
  preference: LanguagePreference;
  language: Language;
  setPreference: (preference: LanguagePreference) => void;
}

export const useLanguage = create<LanguageStore>((set, get) => {
  const preference = readPreference();
  const language = resolve(preference);
  apply(language);
  window.addEventListener('languagechange', () => {
    if (get().preference !== 'system') return;
    const next = systemLanguage();
    apply(next);
    set({ language: next });
  });
  return {
    preference,
    language,
    setPreference: (next) => {
      writePreference(next);
      const resolved = resolve(next);
      apply(resolved);
      set({ preference: next, language: resolved });
    },
  };
});
