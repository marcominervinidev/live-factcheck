// Example events for frontend tests (the backend is the system boundary; brief 13.1).
import type { ClaimChecked, ClaimDetected, ClaimExplained } from '@lfc/contracts';

export const SESSION_ID = '6f1c1e9a-3b1f-4c55-9a53-2f4a9c1d7e10';
export const CLAIM_ID = '0e9d8c7b-6a5f-4e3d-8c1b-0a9f8e7d6c5b';
export const EVIDENCE_ID = '5c4b3a29-1807-4f6e-9d5c-4b3a29180716';

export const detected = (overrides: Partial<ClaimDetected> = {}): ClaimDetected => ({
  schemaVersion: 2,
  sessionId: SESSION_ID,
  claimId: CLAIM_ID,
  speaker: 'A',
  originalText: 'Der Zweite Weltkrieg ist erst 20 Jahre vorbei.',
  standaloneText: 'Der Zweite Weltkrieg ist erst 20 Jahre vorbei.',
  normalizedText: 'der zweite weltkrieg ist erst 20 jahre vorbei',
  checkworthiness: 1,
  sourceSegmentIds: [],
  detectedAt: '2026-09-26T10:00:00.000Z',
  provider: { classifier: 'text-mode', model: 'none' },
  ...overrides,
});

export const checked = (overrides: Partial<ClaimChecked> = {}): ClaimChecked => ({
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
  evidence: [
    {
      evidenceId: EVIDENCE_ID,
      title: 'Zweiter Weltkrieg',
      url: 'https://de.wikipedia.org/wiki/Zweiter_Weltkrieg',
      publisher: 'Wikipedia',
      publishedAt: '2025-05-08T07:00:00.000Z',
      retrievedAt: '2026-09-26T10:00:05.000Z',
      tier: 'referenz',
      snippet: 'Der Zweite Weltkrieg endete am 2. September 1945.',
    },
  ],
  bestEvidenceId: EVIDENCE_ID,
  cacheHit: 'none',
  existingFactCheck: {
    publisher: 'CORRECTIV',
    url: 'https://correctiv.org/faktencheck/x',
    rating: 'Falsch',
  },
  timings: { detectMs: 0, retrieveMs: 2_000, classifyMs: 300, totalMs: 2_400 },
  checkedAt: '2026-09-26T10:00:06.000Z',
  provider: { classifier: 'mock', model: 'mock', search: 'mock', embeddings: 'mock' },
  usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
  ...overrides,
});

export const explained = (overrides: Partial<ClaimExplained> = {}): ClaimExplained => ({
  schemaVersion: 1,
  sessionId: SESSION_ID,
  claimId: CLAIM_ID,
  explanation: 'Der Zweite Weltkrieg endete 1945, also vor über 80 Jahren.',
  provider: { llm: 'mock', model: 'mock' },
  ...overrides,
});
