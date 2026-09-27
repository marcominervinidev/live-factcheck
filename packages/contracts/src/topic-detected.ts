import { z } from 'zod';

import { IsoDateTimeUtc, Uuid, text } from './common.js';

/** The current conversation topic, used for evidence prefetch from phase 4 (brief 9.4; ADR 0010). */
export const TopicDetected = z.strictObject({
  schemaVersion: z.literal(1),
  sessionId: Uuid,
  topicId: Uuid,
  label: text(120),
  keywords: z.array(text(64)).max(20),
  detectedAt: IsoDateTimeUtc,
});

export type TopicDetected = z.infer<typeof TopicDetected>;
