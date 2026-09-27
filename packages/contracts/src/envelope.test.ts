import { describe, expect, it } from 'vitest';

import { EventEnvelope, STREAMS, sessionEventsChannel } from './envelope.js';
import {
  SESSION_ID,
  validChecked,
  validDetected,
  validExplained,
  validSegment,
  validTopic,
} from './testing/fixtures.js';

describe('EventEnvelope contract', () => {
  it.each([
    ['transcript.segment', validSegment()],
    ['claim.detected', validDetected()],
    ['claim.checked', validChecked()],
    ['claim.explained', validExplained()],
    ['topic.detected', validTopic()],
  ])('round-trips a %s event through JSON', (type, payload) => {
    const wire = JSON.stringify({ type, schemaVersion: 2, payload });
    expect(EventEnvelope.parse(JSON.parse(wire))).toEqual({ type, schemaVersion: 2, payload });
  });

  it('rejects a payload that does not match its type', () => {
    const result = EventEnvelope.safeParse({
      type: 'claim.checked',
      schemaVersion: 2,
      payload: validDetected(),
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown event type', () => {
    const result = EventEnvelope.safeParse({
      type: 'claim.deleted',
      schemaVersion: 2,
      payload: {},
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown envelope version, including the old v1', () => {
    for (const schemaVersion of [1, 3]) {
      const result = EventEnvelope.safeParse({
        type: 'transcript.segment',
        schemaVersion,
        payload: validSegment(),
      });
      expect(result.success).toBe(false);
    }
  });
});

describe('names', () => {
  it('matches the stream and channel names from the brief', () => {
    expect(Object.values(STREAMS)).toEqual([
      'transcript.segments',
      'claims.detected',
      'claims.checked',
      'claims.explained',
      'topics.detected',
    ]);
    expect(sessionEventsChannel(SESSION_ID)).toBe(`session:${SESSION_ID}:events`);
  });
});
