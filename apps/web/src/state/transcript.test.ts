import type { TranscriptSegment } from '@lfc/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import { SESSION_ID } from '../testing/fixtures';
import { useTranscript } from './transcript';

const segment = (
  segmentId: string,
  text: string,
  overrides: Partial<TranscriptSegment> = {},
): TranscriptSegment => ({
  schemaVersion: 1,
  sessionId: SESSION_ID,
  segmentId,
  speaker: 'A',
  text,
  startMs: 0,
  endMs: 1_000,
  isFinal: true,
  language: 'de',
  ...overrides,
});

const ids = {
  a: '11111111-1111-4111-8111-111111111111',
  b: '22222222-2222-4222-8222-222222222222',
  c: '33333333-3333-4333-8333-333333333333',
};

const texts = () => {
  const { order, segments } = useTranscript.getState();
  return order.map((id) => segments[id]?.text);
};

describe('transcript store (ADR 0015)', () => {
  beforeEach(() => {
    useTranscript.getState().reset();
  });

  it('replaces the interim version of an utterance with the next one and then the final', () => {
    const { apply } = useTranscript.getState();
    apply(segment(ids.a, 'Der Zweite', { isFinal: false }));
    apply(segment(ids.a, 'Der Zweite Weltkrieg', { isFinal: false }));
    apply(segment(ids.a, 'Der Zweite Weltkrieg endete 1965.'));
    expect(texts()).toEqual(['Der Zweite Weltkrieg endete 1965.']);
    expect(useTranscript.getState().segments[ids.a]?.isFinal).toBe(true);
  });

  it('never lets a late interim overwrite the final text', () => {
    const { apply } = useTranscript.getState();
    apply(segment(ids.a, 'Final.'));
    apply(segment(ids.a, 'Fin', { isFinal: false }));
    expect(texts()).toEqual(['Final.']);
  });

  it('orders segments by start time, also when they arrive out of order', () => {
    const { apply } = useTranscript.getState();
    apply(segment(ids.b, 'zwei', { startMs: 2_000 }));
    apply(segment(ids.c, 'drei', { startMs: 3_000 }));
    apply(segment(ids.a, 'eins', { startMs: 1_000 }));
    expect(texts()).toEqual(['eins', 'zwei', 'drei']);
  });

  it('keeps a later recording below the earlier one although its clock restarts at zero', () => {
    const { apply, beginEpoch } = useTranscript.getState();
    beginEpoch();
    apply(segment(ids.a, 'erste Aufnahme', { startMs: 90_000 }));
    beginEpoch();
    apply(segment(ids.b, 'zweite Aufnahme', { startMs: 0 }));
    apply(segment(ids.c, 'zweite Aufnahme, zweiter Satz', { startMs: 5_000 }));
    expect(texts()).toEqual(['erste Aufnahme', 'zweite Aufnahme', 'zweite Aufnahme, zweiter Satz']);

    // A late final of the first recording still replaces its sentence in place.
    apply(segment(ids.a, 'erste Aufnahme, korrigiert', { startMs: 90_000 }));
    expect(texts()).toEqual([
      'erste Aufnahme, korrigiert',
      'zweite Aufnahme',
      'zweite Aufnahme, zweiter Satz',
    ]);
  });
});
