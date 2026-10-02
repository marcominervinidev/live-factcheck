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
  EmbeddingError,
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

import { INJECTED_PAGE_URL, mockClassifier, mockLlm, mockResearch } from './mocks.js';
import type { PipelineDeps, ResearchSummary } from './pipeline.js';
import { checkClaim, fallbackQueries, verdictCacheKey } from './pipeline.js';
import { loadQuestionTexts } from './questions.js';

const now = () => new Date('2026-09-26T10:00:00.000Z');
/** A fresh fake clock per deps(), so timings never depend on test order. */
const fakeClock = () => {
  let tick = 0;
  return () => (tick += 10);
};

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
    clock: fakeClock(),
    ...overrides,
  });
}

const claim = (text: string, detectMs = 0): ClaimDetected => ({
  schemaVersion: 3,
  sessionId: randomUUID(),
  claimId: randomUUID(),
  speaker: 'A',
  originalText: text,
  standaloneText: text,
  normalizedText: text.toLowerCase().replace(/[.!?]+$/, ''),
  checkworthiness: 1,
  sourceSegmentIds: [],
  detectedAt: now().toISOString(),
  detectMs,
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

  it('counts the detection time into the latency from the end of the sentence', async () => {
    const d = deps();
    const fresh = await checkClaim(claim('Der Zweite Weltkrieg endete 1945.', 1_850), d);
    expect(fresh.timings.detectMs).toBe(1_850);
    expect(fresh.timings.totalMs).toBeGreaterThanOrEqual(1_850);

    const cached = await checkClaim(claim('Der Zweite Weltkrieg endete 1945.', 900), d);
    expect(cached.cacheHit).toBe('verdict_exact');
    expect(cached.timings).toMatchObject({ detectMs: 900, retrieveMs: 0, classifyMs: 0 });
    expect(cached.timings.totalMs).toBeGreaterThanOrEqual(900);
  });

  it('adds exactly the check time to the detection time on a cache hit', async () => {
    const d = deps();
    await checkClaim(claim('Der Zweite Weltkrieg endete 1945.'), d);

    // Frozen clock: the cache answer takes no time, so the total is the detection time.
    const instant = await checkClaim(
      claim('Der Zweite Weltkrieg endete 1945.', 900),
      deps({ verdictCache: d.verdictCache, clock: () => 5_000 }),
    );
    expect(instant.cacheHit).toBe('verdict_exact');
    expect(instant.timings).toEqual({ detectMs: 900, retrieveMs: 0, classifyMs: 0, totalMs: 900 });

    // A clock that advances 40 ms per reading: total = detection + the measured check time.
    let tick = 0;
    const slow = await checkClaim(
      claim('Der Zweite Weltkrieg endete 1945.', 900),
      deps({ verdictCache: d.verdictCache, clock: () => (tick += 40) }),
    );
    expect(slow.cacheHit).toBe('verdict_exact');
    const checkMs = slow.timings.totalMs - slow.timings.detectMs;
    expect(slow.timings.detectMs).toBe(900);
    expect(checkMs).toBeGreaterThanOrEqual(40);
    // Only whole clock steps: nothing but the measured check time is added.
    expect(checkMs % 40).toBe(0);
  });

  it('keeps the provider that produced a cached verdict', async () => {
    const d = deps();
    const first = await checkClaim(claim('Der Zweite Weltkrieg endete 1945.'), d);
    const other = await checkClaim(
      claim('Der Zweite Weltkrieg endete 1945.'),
      deps({ verdictCache: d.verdictCache, searchName: 'searxng' }),
    );
    expect(other.cacheHit).toBe('verdict_exact');
    expect(other.provider).toEqual(first.provider);
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
    expect(result).toMatchObject({
      verdict: 'nicht_pruefbar',
      reason: 'no_evidence',
      confidenceLevel: 'niedrig',
    });
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it('falls back to the claim plus its names and numbers as search queries', () => {
    expect(fallbackQueries('Der Zweite Weltkrieg endete 1945 in Europa.')).toEqual([
      'Der Zweite Weltkrieg endete 1945 in Europa.',
      'Zweite Weltkrieg 1945 Europa',
    ]);
    expect(fallbackQueries('Das stimmt so nicht.')).toEqual(['Das stimmt so nicht.']);
  });

  it('stops before any model call when the daily budget is exhausted', async () => {
    const budget: DailyBudget = {
      ensureAvailable: () => Promise.reject(new BudgetExceededError(2, 2)),
      recordUsd: () => Promise.resolve(),
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
    expect(queries).toEqual([['Der Zweite Weltkrieg endete 1945.', 'Zweite Weltkrieg 1945']]);
  });

  it('records spend against the budget for every model call', async () => {
    const recorded: string[] = [];
    const budget: DailyBudget = {
      ensureAvailable: () => Promise.resolve(),
      recordUsd: () => Promise.resolve(),
      record: (model) => {
        recorded.push(model);
        return Promise.resolve();
      },
    };
    await checkClaim(claim('Der Zweite Weltkrieg endete 1945.'), deps({ budget }));
    // queries (llm) + relevance + decision (classifier)
    expect(recorded).toEqual(['mock', 'mock', 'mock']);
  });

  it('ignores a corrupt verdict-cache entry and checks the claim again', async () => {
    const detected = claim('Der Zweite Weltkrieg endete 1945.');
    const cache = memoryCache();
    cache.values.set(verdictCacheKey(detected.normalizedText), '{not json');
    const d = deps({ verdictCache: cache });
    const result = await checkClaim(detected, d);
    expect(result).toMatchObject({ verdict: 'stimmt', cacheHit: 'none' });
    expect(d.researchCalls).toBe(1);
  });

  it('judges from fact checks alone when no page was found', async () => {
    const research = mockResearch(now);
    const onlyFactChecks = async (input: { claim: string; queries: readonly string[] }) => ({
      ...(await research(input)),
      documents: [],
    });
    const result = await checkClaim(
      claim('Der Zweite Weltkrieg ist erst 20 Jahre vorbei.'),
      deps({ research: onlyFactChecks }),
    );
    expect(ClaimChecked.safeParse(result).success).toBe(true);
    expect(result.evidence.map((e) => e.tier)).toEqual(['faktencheck']);
    expect(result.existingFactCheck).toBeDefined();
  });

  it('passes the abort signal to every external call', async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const controller = new AbortController();
    const classifier = classifierWith(mockClassifier);
    await checkClaim(
      claim('Der Zweite Weltkrieg endete 1945.'),
      deps({
        llm: {
          ...llm,
          generateStructured: (request, options) => {
            signals.push(options?.signal);
            return llm.generateStructured(request, options);
          },
        },
        classifier: {
          ...classifier,
          ask: (state, questions, options) => {
            signals.push(options?.signal);
            return classifier.ask(state, questions, options);
          },
        },
        research: (input, signal) => {
          signals.push(signal);
          return mockResearch(now)(input);
        },
      }),
      controller.signal,
    );
    // queries, research, relevance, decision
    expect(signals).toEqual([
      controller.signal,
      controller.signal,
      controller.signal,
      controller.signal,
    ]);
  });

  it('rethrows errors that are not budget, LLM or classifier errors (the consumer retries)', async () => {
    const text = claim('Der Zweite Weltkrieg endete 1945.');
    const budget: DailyBudget = {
      ensureAvailable: () => Promise.reject(new Error('redis down')),
      recordUsd: () => Promise.resolve(),
      record: () => Promise.resolve(),
    };
    await expect(checkClaim(text, deps({ budget }))).rejects.toThrow('redis down');

    const brokenLlm: LlmProvider = {
      ...llm,
      generateStructured: () => Promise.reject(new Error('bug in llm')),
    };
    await expect(checkClaim(text, deps({ llm: brokenLlm }))).rejects.toThrow('bug in llm');

    const classifier = classifierWith(mockClassifier);
    const brokenClassifier: ClassifierProvider = {
      ...classifier,
      ask: () => Promise.reject(new Error('bug in classifier')),
    };
    await expect(checkClaim(text, deps({ classifier: brokenClassifier }))).rejects.toThrow(
      'bug in classifier',
    );
  });

  it('answers provider_error instead of throwing when the embedding provider fails', async () => {
    const embeddings = deps().embeddings;
    const result = await checkClaim(
      claim('Der Zweite Weltkrieg endete 1945.'),
      deps({
        embeddings: {
          ...embeddings,
          embedQuery: () => Promise.reject(new EmbeddingError('LM Studio is not running')),
        },
      }),
    );
    expect(result).toMatchObject({ verdict: 'nicht_pruefbar', reason: 'provider_error' });
  });

  it('keeps the chosen fact check and bestEvidenceId when more than 10 items are relevant', async () => {
    const research = mockResearch(now);
    const many = async (input: { claim: string; queries: readonly string[] }) => {
      const base = await research(input);
      const template = base.documents[0];
      if (template === undefined) throw new Error('mock corpus is empty');
      return {
        ...base,
        documents: Array.from({ length: 12 }, (_, i) => ({
          ...template,
          url: `https://example.org/page-${String(i)}`,
          text: `Der Zweite Weltkrieg endete 1945. Absatz ${String(i)} mit weiteren Angaben.`,
        })),
      };
    };
    // Every snippet relevant; the best answer is the fact check F1.
    const classifier = classifierWith((state, questions) => {
      const answers = mockClassifier(state, questions);
      const best = questions['best'];
      if (best?.type !== 'choice') return answers;
      return {
        ...answers,
        best: Object.fromEntries(
          Object.keys(best.options).map((key) => [key, key === 'F1' ? 0.9 : 0.01]),
        ),
      };
    });
    const result = await checkClaim(
      claim('Der Zweite Weltkrieg ist erst 20 Jahre vorbei.'),
      deps({ research: many, classifier, topK: 10 }),
    );
    expect(ClaimChecked.safeParse(result).success).toBe(true);
    expect(result.evidence).toHaveLength(10);
    expect(result.evidence[0]?.tier).toBe('faktencheck');
    expect(result.evidence.map((e) => e.evidenceId)).toContain(result.bestEvidenceId);
  });

  it('serves the crafted red-team page only for moon-landing claims; it never leaks into the result', async () => {
    const research = mockResearch(now, { injectedPage: true });
    const moon = await research({ claim: 'Die Mondlandung fand 1975 statt.' });
    const other = await research({ claim: 'Der Mond ist 384.000 Kilometer entfernt.' });
    expect(moon.documents.map((d) => d.url)).toContain(INJECTED_PAGE_URL);
    expect(other.documents.map((d) => d.url)).not.toContain(INJECTED_PAGE_URL);
    // Off by default: evals and trials with the mock corpus never see the page.
    const off = await mockResearch(now)({ claim: 'Die Mondlandung fand 1975 statt.' });
    expect(off.documents.map((d) => d.url)).not.toContain(INJECTED_PAGE_URL);

    const result = await checkClaim(
      claim('Die Mondlandung fand 1975 statt.'),
      deps({ research: (input) => research(input) }),
    );
    expect(ClaimChecked.safeParse(result).success).toBe(true);
    // The page is a fetched source and may be quoted as text, but the link it pushes never
    // becomes a source (brief 15.5: cited URLs only from the fetched list).
    const urls = [...result.evidence.map((e) => e.url), result.existingFactCheck?.url];
    expect(urls.some((url) => url?.includes('evil.example'))).toBe(false);
  });
});

describe('research summary for the diagnose log (plan D1)', () => {
  const collect = () => {
    const summaries: { claimId: string; summary: ResearchSummary }[] = [];
    const onResearch = (detected: ClaimDetected, summary: ResearchSummary) => {
      summaries.push({ claimId: detected.claimId, summary });
    };
    return { summaries, onResearch };
  };

  it('counts what a judged check found and kept, without any text', async () => {
    const { summaries, onResearch } = collect();
    const detected = claim('Der Zweite Weltkrieg endete 1945.');
    await checkClaim(detected, deps({ onResearch }));

    expect(summaries).toHaveLength(1);
    const { claimId, summary } = summaries[0] ?? {};
    expect(claimId).toBe(detected.claimId);
    expect(summary).toMatchObject({ fallbackQueries: false, factChecks: 0, failedSources: [] });
    expect(summary?.queries).toBeGreaterThan(0);
    expect(summary?.snippets).toBeGreaterThan(0);
    expect(summary?.relevant).toBeGreaterThan(0);
    expect(summary?.sufficient).toBeGreaterThanOrEqual(0.5);
    expect(JSON.stringify(summary)).not.toMatch(/Weltkrieg|https?:/);
  });

  it('shows where a check without evidence lost it: tiers, failures and skipped pages', async () => {
    const { summaries, onResearch } = collect();
    const nothing = (): Promise<ResearchResult> =>
      Promise.resolve({
        documents: [],
        factChecks: [],
        perSource: { wikipedia: 0, web: 0 },
        failures: [
          {
            source: 'wikidata',
            reason: 'FetchFailedError: HTTP 429',
            error: 'FetchFailedError',
            status: 429,
          },
        ],
        web: { queries: 2, failedQueries: 0, results: 8, pages: 5, skipped: { http_403: 5 } },
      });
    const result = await checkClaim(
      claim('In Berlin sind die Mieten seit 2015 um 7000 Prozent gestiegen.'),
      deps({ research: nothing, onResearch }),
    );

    expect(result.reason).toBe('no_evidence');
    expect(summaries.map((s) => s.summary)).toEqual([
      {
        queries: expect.any(Number) as number,
        fallbackQueries: false,
        documents: { wikipedia: 0, web: 0 },
        factChecks: 0,
        failedSources: ['wikidata: FetchFailedError 429'],
        web: { queries: 2, failedQueries: 0, results: 8, pages: 5, skipped: { http_403: 5 } },
        snippets: 0,
        retrieveMs: expect.any(Number) as number,
        classifyMs: 0,
      },
    ]);
  });

  it('marks heuristic queries after a failed query step', async () => {
    const { summaries, onResearch } = collect();
    const brokenLlm: LlmProvider = {
      ...llm,
      generateStructured: () => Promise.reject(new LlmError('provider_error', 'down')),
    };
    await checkClaim(
      claim('Der Zweite Weltkrieg endete 1945.'),
      deps({ llm: brokenLlm, onResearch }),
    );
    expect(summaries[0]?.summary).toMatchObject({ queries: 2, fallbackQueries: true });
  });

  it('reports nothing for a cached verdict, which does no research', async () => {
    const { summaries, onResearch } = collect();
    const d = deps({ onResearch });
    await checkClaim(claim('Der Zweite Weltkrieg endete 1945.'), d);
    await checkClaim(claim('Der Zweite Weltkrieg endete 1945.'), d);
    expect(summaries).toHaveLength(1);
  });
});
