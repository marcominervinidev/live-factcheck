import { z } from 'zod';

import { IsoDateTimeUtc, Speaker, Uuid, text } from './common.js';

/**
 * A check-worthy factual claim found in the transcript or typed in text mode (ADR 0010).
 * Text-mode claims (brief 6.8): `originalText = standaloneText`, `checkworthiness: 1`,
 * `provider: { classifier: 'text-mode', model: 'none' }` and no `sourceSegmentIds`.
 */
export const ClaimDetected = z.strictObject({
  schemaVersion: z.literal(2),
  sessionId: Uuid,
  claimId: Uuid,
  speaker: Speaker,
  /** The words as said or typed. */
  originalText: text(1_000),
  /** Rewritten as a self-contained statement: pronouns and references resolved. */
  standaloneText: text(1_000),
  /** Normalised `standaloneText`; the key for deduplication and the exact verdict cache. */
  normalizedText: text(1_000),
  /** Probability that this is a check-worthy factual claim (brief 8.1). */
  checkworthiness: z.number().min(0).max(1),
  sourceSegmentIds: z.array(Uuid).max(100),
  detectedAt: IsoDateTimeUtc,
  provider: z.strictObject({ classifier: text(64), model: text(128) }),
});

export type ClaimDetected = z.infer<typeof ClaimDetected>;
