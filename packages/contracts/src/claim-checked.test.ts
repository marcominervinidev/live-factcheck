import { describe, expect, it } from 'vitest';

import { ClaimChecked, countSentences } from './claim-checked.js';
import { validChecked, validEvidence, validUncheckable } from './testing/fixtures.js';

const failurePaths = (input: unknown) =>
  ClaimChecked.safeParse(input).error?.issues.map((issue) => issue.path.join('.'));

const OTHER_EVIDENCE_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

describe('ClaimChecked v2 contract', () => {
  it('accepts the example verdict from the brief', () => {
    expect(ClaimChecked.parse(validChecked())).toEqual(validChecked());
  });

  it('accepts nicht_pruefbar with low confidence, a reason and no evidence', () => {
    expect(ClaimChecked.safeParse({ ...validUncheckable(), evidence: [] }).success).toBe(true);
  });

  it('accepts a cache hit with an existing fact check, an unknown cost and no publish date', () => {
    const input = {
      ...validChecked(),
      cacheHit: 'verdict_exact',
      existingFactCheck: {
        publisher: 'CORRECTIV',
        url: 'https://correctiv.org/faktencheck/example/',
        rating: 'Falsch',
      },
      usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: null },
    };
    expect(ClaimChecked.safeParse(input).success).toBe(true);
  });

  it('accepts nicht_pruefbar chosen by the classifier with medium confidence', () => {
    const input = {
      ...validUncheckable(),
      confidenceLevel: 'mittel',
      confidence: 0.6,
      reason: 'classified_unverifiable',
    };
    expect(ClaimChecked.safeParse(input).success).toBe(true);
  });

  describe('rules', () => {
    it('1: a verdict other than nicht_pruefbar needs evidence', () => {
      const { bestEvidenceId: _best, ...rest } = validChecked();
      expect(failurePaths({ ...rest, evidence: [] })).toEqual(['evidence']);
    });

    it('2: bestEvidenceId must reference an evidence item', () => {
      expect(failurePaths({ ...validChecked(), bestEvidenceId: OTHER_EVIDENCE_ID })).toEqual([
        'bestEvidenceId',
      ]);
    });

    it('3: nicht_pruefbar needs a reason, other verdicts must not have one', () => {
      const { reason: _reason, ...withoutReason } = validUncheckable();
      expect(failurePaths(withoutReason)).toEqual(['reason']);
      expect(failurePaths({ ...validChecked(), reason: 'no_evidence' })).toEqual(['reason']);
    });

    it('4: the verdict must be the most probable one', () => {
      expect(failurePaths({ ...validChecked(), verdict: 'stimmt' })).toEqual(['verdict']);
    });

    it('4: a verdict with confidenceLevel niedrig must be nicht_pruefbar', () => {
      expect(failurePaths({ ...validChecked(), confidenceLevel: 'niedrig' })).toEqual([
        'confidenceLevel',
      ]);
    });

    it('4: reason low_confidence requires confidenceLevel niedrig', () => {
      expect(failurePaths({ ...validUncheckable(), confidenceLevel: 'mittel' })).toEqual([
        'confidenceLevel',
      ]);
    });

    it('5: totalMs is at least every other timing', () => {
      const timings = { detectMs: 0, retrieveMs: 3_000, classifyMs: 10, totalMs: 2_000 };
      expect(failurePaths({ ...validChecked(), timings })).toEqual(['timings.totalMs']);
    });
  });

  it.each([
    ['schemaVersion', { schemaVersion: 1 }],
    ['verdict', { verdict: 'wahr' }],
    ['confidence', { confidence: 'hoch' }],
    ['confidence', { confidence: 1.2 }],
    ['confidenceLevel', { confidenceLevel: 'sehr hoch' }],
    ['cacheHit', { cacheHit: 'semantic' }],
    ['evidence.0.url', { evidence: [{ ...validEvidence(), url: 'file:///etc/passwd' }] }],
    ['evidence.0.tier', { evidence: [{ ...validEvidence(), tier: 'blog' }] }],
    ['evidence.0.snippet', { evidence: [{ ...validEvidence(), snippet: 'x'.repeat(301) }] }],
    ['evidence.0.publishedAt', { evidence: [{ ...validEvidence(), publishedAt: '2026-09-25' }] }],
    ['existingFactCheck.url', { existingFactCheck: { publisher: 'P', url: '/x', rating: 'R' } }],
    [
      'timings.retrieveMs',
      { timings: { detectMs: 0, retrieveMs: 1.5, classifyMs: 0, totalMs: 2 } },
    ],
    ['provider.embeddings', { provider: { classifier: 'llm', model: 'm', search: 's' } }],
    ['usage.inputTokens', { usage: { inputTokens: -1, outputTokens: 0, estimatedCostUsd: 0 } }],
    ['usage.estimatedCostUsd', { usage: { inputTokens: 1, outputTokens: 0 } }],
  ])('rejects an invalid %s', (path, override) => {
    expect(failurePaths({ ...validChecked(), ...override })).toContain(path);
  });

  it('rejects probabilities that do not sum to 1 or miss a verdict', () => {
    const probabilities = { ...validChecked().probabilities, falsch: 0.5 };
    expect(failurePaths({ ...validChecked(), probabilities })).toContain('probabilities');
    const { stimmt: _stimmt, ...missing } = validChecked().probabilities;
    expect(failurePaths({ ...validChecked(), probabilities: missing })).toContain(
      'probabilities.stimmt',
    );
  });

  it('rejects the removed v1 fields explanation and sources', () => {
    expect(failurePaths({ ...validChecked(), explanation: 'Das stimmt nicht.' })).toEqual(['']);
    expect(failurePaths({ ...validChecked(), sources: [] })).toEqual(['']);
  });

  it('rejects more than ten evidence items', () => {
    expect(
      failurePaths({ ...validChecked(), evidence: Array.from({ length: 11 }, validEvidence) }),
    ).toContain('evidence');
  });
});

describe('countSentences', () => {
  it.each([
    ['Der Zweite Weltkrieg endete 1945, also vor über 80 Jahren.', 1],
    ['Das stimmt nicht. Die Zahl ist höher.', 2],
    ['Er endete am 8. Mai 1945 in Europa.', 1],
    ['Das gilt z. B. für Berlin. Außerdem für Hamburg.', 2],
    ['Eins. Zwei. Drei.', 3],
    ['Stimmt das? Nein!', 2],
  ])('counts %j as %i', (value, expected) => {
    expect(countSentences(value)).toBe(expected);
  });
});
