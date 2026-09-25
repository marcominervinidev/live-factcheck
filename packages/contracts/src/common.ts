import { z } from 'zod';

/** UUID v4, generated with `crypto.randomUUID()`. */
export const Uuid = z.uuidv4();

/** ISO 8601 date-time in UTC with `Z` suffix, e.g. `2026-09-25T10:00:00.000Z`. */
export const IsoDateTimeUtc = z.iso.datetime();

/** BCP 47 language tag in the forms used here: `de`, `de-DE`, `zh-Hant-TW`. */
export const LanguageTag = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|\d{3}))?$/, 'Expected a BCP 47 tag like "de-DE"');

/** Diarization label such as `A`; display names live only in the UI. */
export const Speaker = z.string().min(1).max(64);

/** Non-blank text with an upper bound. */
export const text = (max: number) => z.string().max(max).regex(/\S/, 'Must not be blank');

/** Absolute http(s) URL. */
export const HttpUrl = z.url({ protocol: /^https?$/ });

/** Non-negative integer milliseconds since session start. */
export const OffsetMs = z.int().nonnegative();
