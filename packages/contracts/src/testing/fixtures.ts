// Valid example payloads for contract tests. Not exported from the package.
import type { ClaimChecked } from '../claim-checked.js';
import type { ClaimDetected } from '../claim-detected.js';
import type { ClaimExplained } from '../claim-explained.js';
import type { Evidence } from '../evidence.js';
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
  schemaVersion: 2,
  sessionId: SESSION_ID,
  claimId: CLAIM_ID,
  speaker: 'A',
  originalText: 'Der ist doch erst 20 Jahre vorbei.',
  standaloneText: 'Der Zweite Weltkrieg ist erst 20 Jahre vorbei.',
  normalizedText: 'der zweite weltkrieg ist erst 20 jahre vorbei',
  checkworthiness: 0.93,
  sourceSegmentIds: [SEGMENT_ID],
  detectedAt: '2026-09-25T10:00:04.000Z',
  provider: { classifier: 'llm', model: 'example-model' },
});

/** A claim typed in text mode (brief 6.8, ADR 0010). */
export const validTextModeDetected = (): ClaimDetected => ({
  ...validDetected(),
  originalText: 'Der Zweite Weltkrieg ist erst 20 Jahre vorbei.',
  checkworthiness: 1,
  sourceSegmentIds: [],
  provider: { classifier: 'text-mode', model: 'none' },
});

export const EVIDENCE_ID = '5c4b3a29-1807-4f6e-9d5c-4b3a29180716';

export const validEvidence = (): Evidence => ({
  evidenceId: EVIDENCE_ID,
  title: 'Zweiter Weltkrieg',
  url: 'https://de.wikipedia.org/wiki/Zweiter_Weltkrieg',
  publisher: 'Wikipedia',
  retrievedAt: '2026-09-25T10:00:06.000Z',
  tier: 'referenz',
  snippet: 'Der Zweite Weltkrieg war vom 1. September 1939 bis zum 2. September 1945 …',
});

/** The example verdict from brief 2: false, high confidence, evidence from Wikipedia. */
export const validChecked = (): ClaimChecked => ({
  schemaVersion: 2,
  sessionId: SESSION_ID,
  claimId: CLAIM_ID,
  speaker: 'A',
  claim: 'Der Zweite Weltkrieg ist erst 20 Jahre vorbei.',
  verdict: 'falsch',
  probabilities: {
    stimmt: 0.01,
    groesstenteils_richtig: 0.01,
    uebertrieben: 0.03,
    falsch: 0.93,
    nicht_pruefbar: 0.02,
  },
  confidence: 0.91,
  confidenceLevel: 'hoch',
  evidence: [validEvidence()],
  bestEvidenceId: EVIDENCE_ID,
  cacheHit: 'none',
  timings: { detectMs: 0, retrieveMs: 2_400, classifyMs: 380, totalMs: 2_900 },
  checkedAt: '2026-09-25T10:00:09.000Z',
  provider: { classifier: 'llm', model: 'example-model', search: 'searxng', embeddings: 'mock' },
  usage: { inputTokens: 3_120, outputTokens: 96, estimatedCostUsd: 0.0162 },
});

/** No verdict because the classifier was not confident enough (ADR 0007 thresholds). */
export const validUncheckable = (): ClaimChecked => {
  const { bestEvidenceId: _best, ...rest } = validChecked();
  return {
    ...rest,
    verdict: 'nicht_pruefbar',
    confidence: 0.3,
    confidenceLevel: 'niedrig',
    reason: 'low_confidence',
  };
};

export const validExplained = (): ClaimExplained => ({
  schemaVersion: 1,
  sessionId: SESSION_ID,
  claimId: CLAIM_ID,
  explanation: 'Der Zweite Weltkrieg endete 1945, also vor über 80 Jahren.',
  provider: { llm: 'anthropic', model: 'example-model' },
});
