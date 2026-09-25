import { z } from 'zod';

import { IsoDateTimeUtc, Speaker, Uuid, text } from './common.js';

/**
 * A checkable factual claim found in the transcript or typed in text mode.
 * `sourceSegmentIds` is empty for text-mode claims (brief 6.8).
 */
export const ClaimDetected = z.strictObject({
  schemaVersion: z.literal(1),
  sessionId: Uuid,
  claimId: Uuid,
  speaker: Speaker,
  text: text(1_000),
  normalizedText: text(1_000),
  sourceSegmentIds: z.array(Uuid).max(100),
  detectedAt: IsoDateTimeUtc,
});

export type ClaimDetected = z.infer<typeof ClaimDetected>;
