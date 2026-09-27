import de from './de.json';

/** All UI texts live in the message catalogue (brief 1: German UI, i18n-ready). */
export type MessageKey = keyof typeof de;

const messages: Record<MessageKey, string> = de;

/** A message with `{name}` placeholders filled in; unknown placeholders stay visible. */
export function t(key: MessageKey, params: Readonly<Record<string, string>> = {}): string {
  return messages[key].replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match);
}
