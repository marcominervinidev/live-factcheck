import { z } from 'zod';

import { ClaimChecked } from './claim-checked.js';
import { ClaimDetected } from './claim-detected.js';
import { ClaimExplained } from './claim-explained.js';
import { TopicDetected } from './topic-detected.js';
import { TranscriptSegment } from './transcript-segment.js';

/** Redis stream names (brief 6). */
export const STREAMS = {
  transcriptSegments: 'transcript.segments',
  claimsDetected: 'claims.detected',
  claimsChecked: 'claims.checked',
  claimsExplained: 'claims.explained',
  topicsDetected: 'topics.detected',
} as const;

/** Pub/Sub channel for all client-relevant events of one session (brief 6.7). */
export function sessionEventsChannel(sessionId: string): `session:${string}:events` {
  return `session:${sessionId}:events`;
}

// Envelope v2 (ADR 0010): same wrapper shape as v1, new event types and payload versions.
const envelope = <T extends string, P extends z.ZodType>(type: T, payload: P) =>
  z.strictObject({
    type: z.literal(type),
    schemaVersion: z.literal(2),
    payload,
  });

export const TranscriptSegmentEvent = envelope('transcript.segment', TranscriptSegment);
export const ClaimDetectedEvent = envelope('claim.detected', ClaimDetected);
export const ClaimCheckedEvent = envelope('claim.checked', ClaimChecked);
export const ClaimExplainedEvent = envelope('claim.explained', ClaimExplained);
export const TopicDetectedEvent = envelope('topic.detected', TopicDetected);

/** Every event on a stream or the session channel. Dispatch on `type`. */
export const EventEnvelope = z.discriminatedUnion('type', [
  TranscriptSegmentEvent,
  ClaimDetectedEvent,
  ClaimCheckedEvent,
  ClaimExplainedEvent,
  TopicDetectedEvent,
]);

export type EventEnvelope = z.infer<typeof EventEnvelope>;
export type EventType = EventEnvelope['type'];
