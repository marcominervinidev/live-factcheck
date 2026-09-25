import { z } from 'zod';

import { LanguageTag, OffsetMs, Speaker, Uuid, text } from './common.js';

/** A transcribed piece of speech. Only final segments enter the pipeline (brief 6.4). */
export const TranscriptSegment = z
  .strictObject({
    schemaVersion: z.literal(1),
    sessionId: Uuid,
    segmentId: Uuid,
    speaker: Speaker,
    text: text(10_000),
    startMs: OffsetMs,
    endMs: OffsetMs,
    isFinal: z.boolean(),
    language: LanguageTag,
  })
  .refine((segment) => segment.endMs >= segment.startMs, {
    message: 'endMs must not be before startMs',
    path: ['endMs'],
  });

export type TranscriptSegment = z.infer<typeof TranscriptSegment>;
