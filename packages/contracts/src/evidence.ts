import { z } from 'zod';

import { HttpUrl, IsoDateTimeUtc, Uuid, text } from './common.js';

/** Source tiers (brief 9.1); the domain mapping lives in `config/source-tiers.yaml`. */
export const SourceTier = z.enum(['faktencheck', 'amtlich', 'referenz', 'presse', 'sonstige']);
export type SourceTier = z.infer<typeof SourceTier>;

/** Events and the UI carry short excerpts only, never whole texts (brief 9.2). */
export const MAX_SNIPPET_LENGTH = 300;

/**
 * One piece of evidence for a claim (brief 7). Embedded in `ClaimChecked`; it has no
 * `schemaVersion` of its own, so a change here bumps every schema that embeds it (ADR 0010).
 */
export const Evidence = z.strictObject({
  evidenceId: Uuid,
  title: text(300),
  url: HttpUrl,
  publisher: text(200),
  publishedAt: IsoDateTimeUtc.optional(),
  retrievedAt: IsoDateTimeUtc,
  tier: SourceTier,
  snippet: text(MAX_SNIPPET_LENGTH),
});

export type Evidence = z.infer<typeof Evidence>;
