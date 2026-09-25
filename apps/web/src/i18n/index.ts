import de from './de.json';

/** All UI texts live in the message catalogue (brief 1: German UI, i18n-ready). */
export type MessageKey = keyof typeof de;

const messages: Record<MessageKey, string> = de;

export function t(key: MessageKey): string {
  return messages[key];
}
