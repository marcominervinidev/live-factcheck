import { randomUUID } from 'node:crypto';

import type { ClaimDetected } from '@lfc/contracts';
import { ClaimChecked } from '@lfc/contracts';
import type {
  ClassifierProvider,
  DailyBudget,
  LlmProvider,
  MockClassifierHandler,
} from '@lfc/providers';
import {
  BudgetExceededError,
  ClassifierError,
  LlmError,
  checkClassifierConfig,
  classifierConfigShape,
  createClassifier,
  createEmbeddingProvider,
  loadPromptTemplate,
} from '@lfc/providers';
import type { ResearchResult, TextCache } from '@lfc/research';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { mockClassifier, mockLlm, mockResearch } from './mocks.js';
import type { PipelineDeps } from './pipeline.js';
import { checkClaim, verdictCacheKey } from './pipeline.js';
import { loadQuestionTexts } from './questions.js';

const now = () => new Date('2026-09-26T10:00:00.000Z');
let tick = 0;
const clock = () => (tick += 10);

function memoryCache(): TextCache & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    get: (key) => Promise.resolve(values.get(key) ?? null),
    set: (key, value) => {
      values.set(key, value);
      return Promise.resolve();
    },
  };
}

const classifierConfig = z
  .object(classifierConfigShape('CHECKER'))
  .superRefine(checkClassifierConfig('CHECKER'));
const llm: LlmProvider = {
  name: 'mock',
  model: 'mock',
  generateStructured: (request) =>
    Promise.resolve({
      value: request.schema.parse(mockLlm(request)),
      usage: { inputTokens: 0, outputTokens: 0 },
      model: 'mock',
      provider: 'mock',
    }),
};
const classifierWith = (handler: MockClassifierHandler): ClassifierProvider =>
  createClassifier('CHECKER', classifierConfig.parse({ CHECKER_CLASSIFIER_PROVIDER: 'mock' }), {
    llm,
    mock: handler,
  });

function deps(overrides: Partial<PipelineDeps> = {}): PipelineDeps & { researchCalls: number } {
  const research = mockResearch(now);
  const state = { researchCalls: 0 };
  return Object.assign(state, {
    llm,
    classifier: classifierWith(mockClassifier),
    thresholds: { high: 0.75, low: 0.45 },
    research: (input: { claim: string; queries: readonly string[] }) => {
      state.researchCalls++;
      return research(input);
    },
    embeddings: createEmbeddingProvider({
      EMBEDDINGS_PROVIDER: 'mock',
      EMBEDDINGS_MODEL: 'mock',
      EMBEDDINGS_TIMEOUT_MS: 1_000,
    }),
    searchName: 'mock',
    verdictCache: memoryCache(),
    verdictCacheTtlS: 60,
    topK: 6,
    queriesPrompt: loadPromptTemplate(new URL('../prompts/queries.md', import.meta.url)),
    questions: loadQuestionTexts(new URL('../prompts/questions.yaml', import.meta.url)),
    now,
    clock,
    ...overrides,
  });
}

const claim = (text: string): ClaimDetected => ({
  schemaVersion: 2,
  sessionId: randomUUID(),
  claimId: randomUUID(),
  speaker: 'A',
  originalText: text,
  standaloneText: text,
  normalizedText: text.toLowerCase().replace(/[.!?]+$/, ''),
  checkworthiness: 1,
  sourceSegmentIds: [],
  detectedAt: now().toISOString(),
  provider: { classifier: 'text-mode', model: 'none' },
});

describe('checkClaim (brief 9.6)', () => {
  it('judges the brief example false with high confidence, evidence and the existing fact check', async () => {
    const detected = claim('Der Zweite Weltkrieg ist erst 20 Jahre vorbei.');
    const result = await checkClaim(detected, deps());

    expect(ClaimChecked.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({
      claimId: detected.claimId,
      verdict: 'falsch',
      confidenceLevel: 'hoch',
      cacheHit: 'none',
      existingFactCheck: { publisher: 'Beispiel-Faktencheck', rating: 'Falsch' },
      provider: { classifier: 'mock', search: 'mock', embeddings: 'mock' },
    });
    expect(result.evidence.map((e) => e.tier)).toContain('faktencheck');
    expect(result.evidence.map((e) => e.evidenceId)).toContain(result.bestEvidenceId);
    for (const e of result.evidence) expect(e.snippet.length).toBeLessThanOrEqual(300);
    expect(result.timings.totalMs).toBeGreaterThanOrEqual(result.timings.retrieveMs);
  });

  it.each([
    ['Der Zweite Weltkrieg endete 1945.', 'stimmt', 'hoch', undefined],
    ['Berlin hat 3,9 Millionen Einwohner.', 'groesstenteils_richtig', 'mittel', undefined],
    [
      'Ich finde, Berlin ist die schönste Stadt.',
      'nicht_pruefbar',
      'hoch',
      'classified_unverifiable',
    ],
  ])('%s → %s (%s)', async (text, verdict, level, reason) => {
    const result = await checkClaim(claim(text), deps());
    expect(result.verdict).toBe(verdict);
    expect(result.confidenceLevel).toBe(level);
    expect(result.reason).toBe(reason);
  });

  it('answers a repeated claim from the exact verdict cache without research', async () => {
    const d = deps();
    const first = await checkClaim(claim('Der Zweite Weltkrieg endete 1945.'), d);
    const again = claim('Der Zweite Weltkrieg endete 1945.');
    const second = await checkClaim(again, d);

    expect(d.researchCalls).toBe(1);
    expect(second).toMatchObject({
      cacheHit: 'verdict_exact',
      verdict: first.verdict,
      claimId: again.claimId,
    });
    expect(second.usage).toEqual({ inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 });
  });

  it('does not share the cache between claims that differ only in a number', async () => {
    const d = deps();
    await checkClaim(claim('Der Zweite Weltkrieg endete 1945.'), d);
    const other = await checkClaim(claim('Der Zweite Weltkrieg endete 1965.'), d);
    expect(other.cacheHit).toBe('none');
    expect(other.verdict).toBe('falsch');
    expect(verdictCacheKey('endete 1945')).not.toBe(verdictCacheKey('endete 1965'));
  });

  it('does not cache uncheckable results', async () => {
    const d = deps();
    await checkClaim(claim('Ich finde, Berlin ist die schönste Stadt.'), d);
    expect((d.verdictCache as ReturnType<typeof memoryCache>).values.size).toBe(0);
  });

  it('turns low confidence into nicht_pruefbar with reason low_confidence', async () => {
    const flat: MockClassifierHandler = (state, questions) => ({
      ...mockClassifier(state, questions),
      verdict: {
        stimmt: 0.3,
        falsch: 0.3,
        groesstenteils_richtig: 0.2,
        uebertrieben: 0.1,
        nicht_pruefbar: 0.1,
      },
    });
    const result = await checkClaim(
      claim('Der Zweite Weltkrieg endete 1945.'),
      deps({ classifier: classifierWith(flat) }),
    );
    expect(result).toMatchObject({
      verdict: 'nicht_pruefbar',
      confidenceLevel: 'niedrig',
      reason: 'low_confidence',
    });
  });

  it('answers nicht_pruefbar (no_evidence) when nothing was found', async () => {
    const empty = (): Promise<ResearchResult> =>
      Promise.resolve({ documents: [], factChecks: [], failures: [] });
    const result = await checkClaim(
      claim('Der Zweite Weltkrieg endete 1945.'),
      deps({ research: empty }),
    );
    expect(result).toMatchObject({
      verdict: 'nicht_pruefbar',
      reason: 'no_evidence',
      evidence: [],
    });
  });

  it('answers nicht_pruefbar (no_evidence) when the snippets do not suffice', async () => {
    const insufficient: MockClassifierHandler = (state, questions) => ({
      ...mockClassifier(state, questions),
      sufficient: 0.2,
    });
    const result = await checkClaim(
      claim('Der Zweite Weltkrieg endete 1945.'),
      deps({ classifier: classifierWith(insufficient) }),
    );
    expect(result).toMatchObject({ verdict: 'nicht_pruefbar', reason: 'no_evidence' });
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it('stops before any model call when the daily budget is exhausted', async () => {
    const budget: DailyBudget = {
      ensureAvailable: () => Promise.reject(new BudgetExceededError(2, 2)),
      record: () => Promise.resolve(),
    };
    const d = deps({ budget });
    const result = await checkClaim(claim('Der Zweite Weltkrieg endete 1945.'), d);
    expect(result).toMatchObject({ verdict: 'nicht_pruefbar', reason: 'budget_exceeded' });
    expect(d.researchCalls).toBe(0);
  });

  it('maps classifier failures to nicht_pruefbar instead of crashing', async () => {
    const failing = (kind: 'invalid_output' | 'provider_error'): ClassifierProvider => ({
      name: 'llm',
      model: 'm',
      ask: () =>
        Promise.reject(new ClassifierError(kind, 'boom', { inputTokens: 5, outputTokens: 1 })),
    });
    const invalid = await checkClaim(
      claim('Der Zweite Weltkrieg endete 1945.'),
      deps({ classifier: failing('invalid_output') }),
    );
    expect(invalid).toMatchObject({ verdict: 'nicht_pruefbar', reason: 'invalid_llm_output' });
    expect(invalid.usage.inputTokens).toBe(5);
    const down = await checkClaim(
      claim('Der Zweite Weltkrieg endete 1945.'),
      deps({ classifier: failing('provider_error') }),
    );
    expect(down.reason).toBe('provider_error');
  });

  it('falls back to the claim as search query when the query LLM fails', async () => {
    const queries: string[][] = [];
    const brokenLlm: LlmProvider = {
      ...llm,
      generateStructured: () => Promise.reject(new LlmError('invalid_output', 'x')),
    };
    await checkClaim(
      claim('Der Zweite Weltkrieg endete 1945.'),
      deps({
        llm: brokenLlm,
        research: (input) => {
          queries.push([...input.queries]);
          return mockResearch(now)(input);
        },
      }),
    );
    expect(queries).toEqual([['Der Zweite Weltkrieg endete 1945.']]);
  });

  it('records spend against the budget for every model call', async () => {
    const recorded: string[] = [];
    const budget: DailyBudget = {
      ensureAvailable: () => Promise.resolve(),
      record: (model) => {
        recorded.push(model);
        return Promise.resolve();
      },
    };
    await checkClaim(claim('Der Zweite Weltkrieg endete 1945.'), deps({ budget }));
    // queries (llm) + relevance + decision (classifier)
    expect(recorded).toEqual(['mock', 'mock', 'mock']);
  });
});
