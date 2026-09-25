import { describe, expect, it } from 'vitest';

import { EventEnvelope, STREAMS, sessionEventsChannel } from './envelope.js';
import { SESSION_ID, validChecked, validDetected, validSegment } from './testing/fixtures.js';

describe('EventEnvelope contract', () => {
  it.each([
    ['transcript.segment', validSegment()],
    ['claim.detected', validDetected()],
    ['claim.checked', validChecked()],
  ])('round-trips a %s event through JSON', (type, payload) => {
    const wire = JSON.stringify({ type, schemaVersion: 1, payload });
    expect(EventEnvelope.parse(JSON.parse(wire))).toEqual({ type, schemaVersion: 1, payload });
  });

  it('rejects a payload that does not match its type', () => {
    const result = EventEnvelope.safeParse({
      type: 'claim.checked',
      schemaVersion: 1,
      payload: validDetected(),
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown event type', () => {
    const result = EventEnvelope.safeParse({
      type: 'claim.deleted',
      schemaVersion: 1,
      payload: {},
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown envelope version', () => {
    const result = EventEnvelope.safeParse({
      type: 'transcript.segment',
      schemaVersion: 2,
      payload: validSegment(),
    });
    expect(result.success).toBe(false);
  });
});

describe('names', () => {
  it('matches the stream and channel names from the brief', () => {
    expect(Object.values(STREAMS)).toEqual([
      'transcript.segments',
      'claims.detected',
      'claims.checked',
    ]);
    expect(sessionEventsChannel(SESSION_ID)).toBe(`session:${SESSION_ID}:events`);
  });
});
