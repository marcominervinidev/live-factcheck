import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';

import { configSchema } from './config.js';
import { MOCK_CONFIG_ENV } from './testing/mock-env.js';
import { createPipelineDeps, providerStatus } from './wiring.js';

// lazyConnect: building the pipeline must not touch Redis or the network.
const redis = new Redis({ lazyConnect: true });

const LIVE_ENV = {
  ...MOCK_CONFIG_ENV,
  CHECKER_LLM_PROVIDER: 'anthropic',
  CHECKER_LLM_MODEL: 'claude-opus-5',
  CHECKER_LLM_API_KEY: 'k'.repeat(20),
  CHECKER_CLASSIFIER_PROVIDER: 'llm',
  SEARCH_PROVIDER: 'searxng',
  SEARXNG_URL: 'http://searxng:8080',
  CHECKER_RESEARCH_SOURCES: 'live',
  GOOGLE_FACTCHECK_API_KEY: 'g'.repeat(20),
};

describe('fact-checker wiring', () => {
  afterAll(() => {
    redis.disconnect();
  });

  it('builds an all-mock pipeline without a budget and with the mock corpus', async () => {
    const deps = createPipelineDeps(configSchema.parse(MOCK_CONFIG_ENV), redis);
    expect(deps).toMatchObject({
      searchName: 'mock',
      topK: 6,
      thresholds: { high: 0.75, low: 0.45 },
    });
    expect(deps.budget).toBeUndefined();
    expect(deps.questions).toBeDefined();
    const result = await deps.research({
      claim: 'Der Zweite Weltkrieg endete 1945.',
      queries: ['Weltkrieg Ende'],
    });
    expect(result.documents.length).toBeGreaterThan(0);
  });

  it('builds the live research stack and a budget when a cloud model is configured', () => {
    const deps = createPipelineDeps(configSchema.parse(LIVE_ENV), redis);
    expect(deps.searchName).toBe('searxng');
    expect(deps.budget).toBeDefined();
  });

  it('reports providers without keys and marks cloud use (brief 11, 15.6)', () => {
    expect(providerStatus(configSchema.parse(MOCK_CONFIG_ENV))).toEqual([
      { service: 'fact-checker', role: 'llm', provider: 'mock', model: 'mock', cloud: false },
      { service: 'fact-checker', role: 'classifier', provider: 'mock', cloud: false },
      {
        service: 'fact-checker',
        role: 'embeddings',
        provider: 'mock',
        model: 'mock',
        cloud: false,
      },
      { service: 'fact-checker', role: 'search', provider: 'mock', cloud: false },
    ]);

    const live = providerStatus(configSchema.parse(LIVE_ENV));
    expect(live.map((p) => [p.role, p.provider, p.cloud])).toEqual([
      ['llm', 'anthropic', true],
      ['classifier', 'llm', true],
      ['embeddings', 'mock', false],
      ['search', 'searxng', false],
      ['factcheck', 'google-factcheck', true],
    ]);
    expect(JSON.stringify(live)).not.toContain('k'.repeat(20));
    expect(JSON.stringify(live)).not.toContain('g'.repeat(20));
  });
});
