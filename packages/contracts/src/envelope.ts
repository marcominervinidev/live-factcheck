import { z } from 'zod';

import { ClaimChecked } from './claim-checked.js';
import { ClaimDetected } from './claim-detected.js';
import { TranscriptSegment } from './transcript-segment.js';

/** Redis stream names (brief 6). */
export const STREAMS = {
  transcriptSegments: 'transcript.segments',
  claimsDetected: 'claims.detected',
  claimsChecked: 'claims.checked',
} as const;

/** Pub/Sub channel for all client-relevant events of one session (brief 6.7). */
export function sessionEventsChannel(sessionId: string): `session:${string}:events` {
  return `session:${sessionId}:events`;
}

const envelope = <T extends string, P extends z.ZodType>(type: T, payload: P) =>
  z.strictObject({
    type: z.literal(type),
    schemaVersion: z.literal(1),
    payload,
  });

export const TranscriptSegmentEvent = envelope('transcript.segment', TranscriptSegment);
export const ClaimDetectedEvent = envelope('claim.detected', ClaimDetected);
export const ClaimCheckedEvent = envelope('claim.checked', ClaimChecked);

/** Every event on a stream or the session channel. Dispatch on `type`. */
export const EventEnvelope = z.discriminatedUnion('type', [
  TranscriptSegmentEvent,
  ClaimDetectedEvent,
  ClaimCheckedEvent,
]);

export type EventEnvelope = z.infer<typeof EventEnvelope>;
export type EventType = EventEnvelope['type'];
