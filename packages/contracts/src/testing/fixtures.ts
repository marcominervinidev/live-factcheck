// Valid example payloads for contract tests. Not exported from the package.
import type { ClaimChecked } from '../claim-checked.js';
import type { ClaimDetected } from '../claim-detected.js';
import type { TranscriptSegment } from '../transcript-segment.js';

export const SESSION_ID = '6f1c1e9a-3b1f-4c55-9a53-2f4a9c1d7e10';
export const SEGMENT_ID = 'b2d7c1a4-8e0f-4a6b-9d3c-1e5f7a9b0c2d';
export const CLAIM_ID = '0e9d8c7b-6a5f-4e3d-8c1b-0a9f8e7d6c5b';

export const validSegment = (): TranscriptSegment => ({
  schemaVersion: 1,
  sessionId: SESSION_ID,
  segmentId: SEGMENT_ID,
  speaker: 'A',
  text: 'Der Zweite Weltkrieg ist erst 20 Jahre vorbei.',
  startMs: 1_200,
  endMs: 3_900,
  isFinal: true,
  language: 'de-DE',
});

export const validDetected = (): ClaimDetected => ({
  schemaVersion: 1,
  sessionId: SESSION_ID,
  claimId: CLAIM_ID,
  speaker: 'A',
  text: 'Der Zweite Weltkrieg ist erst 20 Jahre vorbei.',
  normalizedText: 'zweiter weltkrieg ist erst 20 jahre vorbei',
  sourceSegmentIds: [SEGMENT_ID],
  detectedAt: '2026-09-25T10:00:04.000Z',
});

export const validChecked = (): ClaimChecked => ({
  schemaVersion: 1,
  sessionId: SESSION_ID,
  claimId: CLAIM_ID,
  speaker: 'A',
  claim: 'Der Zweite Weltkrieg ist erst 20 Jahre vorbei.',
  verdict: 'falsch',
  confidence: 'hoch',
  explanation: 'Der Zweite Weltkrieg endete 1945, also vor über 80 Jahren.',
  sources: [
    {
      title: 'Zweiter Weltkrieg – Wikipedia',
      url: 'https://de.wikipedia.org/wiki/Zweiter_Weltkrieg',
      snippet: 'Der Zweite Weltkrieg war vom 1. September 1939 bis zum 2. September 1945 …',
    },
  ],
  checkedAt: '2026-09-25T10:00:09.000Z',
  provider: { llm: 'anthropic', model: 'example-model', search: 'searxng' },
});
