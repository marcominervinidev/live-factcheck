import { useLanguage } from '../state/language';

import de from './de.json';
import en from './en.json';

/** All UI texts live in the message catalogues (brief 1; ADR 0020: English UI now). */
export type MessageKey = keyof typeof de;

// `en` typed against the German key set: a missing key fails the typecheck, the i18n unit
// test additionally proves equal key sets and placeholders at runtime.
const catalogues: Record<'de' | 'en', Record<MessageKey, string>> = { de, en };

/**
 * A message in the active language with `{name}` placeholders filled in; unknown placeholders
 * stay visible. Components re-render on a language switch because App subscribes to the store.
 */
export function t(key: MessageKey, params: Readonly<Record<string, string>> = {}): string {
  const language = useLanguage.getState().language;
  return catalogues[language][key].replace(
    /\{(\w+)\}/g,
    (match, name: string) => params[name] ?? match,
  );
}
