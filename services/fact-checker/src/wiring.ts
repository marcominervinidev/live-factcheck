import { readFileSync } from 'node:fs';

import type { ProviderStatus } from '@lfc/contracts';
import {
  classifierUse,
  createClassifier,
  createDailyBudget,
  createEmbeddingProvider,
  createLlmProvider,
  createSearchProvider,
  embeddingsUse,
  llmUse,
  loadPromptTemplate,
} from '@lfc/providers';
import {
  cachedFetcher,
  cachedSearch,
  createFactCheckSource,
  createRobotsPolicy,
  createSafeFetcher,
  createTierResolver,
  createWebSource,
  createWikidataSource,
  createWikipediaSource,
  parseSourceTiers,
  redisTextCache,
  researchClaim,
} from '@lfc/research';
import type { Redis } from 'ioredis';

import type { Config } from './config.js';
import { mockClassifier, mockLlm, mockResearch, mockSearch } from './mocks.js';
import type { PipelineDeps } from './pipeline.js';
import { loadQuestionTexts } from './questions.js';

const PRODUCT = 'live-factcheck';
const VERSION = '0.1.0';

/** Builds the pipeline from validated config. Everything external goes through an adapter. */
export function createPipelineDeps(config: Config, redis: Redis): PipelineDeps {
  const now = () => new Date();
  const cache = redisTextCache(redis);
  const llm = createLlmProvider('CHECKER', config, { mock: mockLlm });
  const classifier = createClassifier('CHECKER', config, { llm, mock: mockClassifier });
  const embeddings = createEmbeddingProvider(config);
  const search = cachedSearch(
    createSearchProvider(config, { mock: mockSearch }),
    cache,
    config.RESEARCH_SEARCH_CACHE_TTL_S,
  );
  const tiers = createTierResolver(
    parseSourceTiers(readFileSync(config.SOURCE_TIERS_FILE, 'utf8')),
  );

  let research: PipelineDeps['research'];
  if (config.CHECKER_RESEARCH_SOURCES === 'mock') {
    research = mockResearch(now);
  } else {
    const fetcher = cachedFetcher(
      createSafeFetcher({
        userAgent: `${PRODUCT}/${VERSION} (+${config.CHECKER_USER_AGENT_URL})`,
        timeoutMs: config.CHECKER_FETCH_TIMEOUT_MS,
        maxBytes: config.CHECKER_FETCH_MAX_BYTES,
      }),
      cache,
      config.RESEARCH_PAGE_CACHE_TTL_S,
    );
    const robots = createRobotsPolicy({
      fetcher,
      cache,
      productToken: PRODUCT,
      ttlSeconds: 24 * 3600,
    });
    const maxChars = config.CHECKER_MAX_SOURCE_CHARS;
    const apiKey = config.GOOGLE_FACTCHECK_API_KEY;
    const sources = {
      ...(apiKey === undefined
        ? {}
        : { factCheck: createFactCheckSource({ fetcher, apiKey, languageCode: 'de' }) }),
      wikipedia: createWikipediaSource({ fetcher, tiers, maxChars, now }),
      wikidata: createWikidataSource({ fetcher, tiers, now }),
      web: createWebSource({ search, fetcher, robots, tiers, maxChars, now }),
    };
    const limits = {
      timeoutMs: config.CHECKER_TIER_TIMEOUT_MS,
      factChecks: 3,
      wikipediaPages: 2,
      wikidataEntities: 2,
      resultsPerQuery: 5,
      webPages: config.CHECKER_WEB_PAGES,
    };
    research = (input, signal) => researchClaim(input, sources, limits, signal);
  }

  const cloud = llmUse('CHECKER', config).cloud || classifierUse('CHECKER', config).cloud;
  return {
    llm,
    classifier,
    thresholds: { high: config.CHECKER_CONFIDENCE_HIGH, low: config.CHECKER_CONFIDENCE_LOW },
    research,
    embeddings,
    searchName: search.name,
    verdictCache: cache,
    verdictCacheTtlS: config.CHECKER_VERDICT_CACHE_TTL_S,
    ...(cloud ? { budget: createDailyBudget(redis, config.CLOUD_DAILY_BUDGET_USD) } : {}),
    topK: config.CHECKER_TOP_K,
    queriesPrompt: loadPromptTemplate(new URL('../prompts/queries.md', import.meta.url)),
    questions: loadQuestionTexts(new URL('../prompts/questions.yaml', import.meta.url)),
    now,
    clock: () => performance.now(),
  };
}

/** What the settings page shows (brief 11, 15.6): providers and whether data leaves the network. */
export function providerStatus(config: Config): ProviderStatus['providers'] {
  const service = 'fact-checker';
  const live = config.CHECKER_RESEARCH_SOURCES === 'live';
  return [
    {
      service,
      role: 'llm',
      provider: config.CHECKER_LLM_PROVIDER,
      model: config.CHECKER_LLM_MODEL,
      cloud: llmUse('CHECKER', config).cloud,
    },
    {
      service,
      role: 'classifier',
      provider: config.CHECKER_CLASSIFIER_PROVIDER,
      ...(config.CHECKER_CLASSIFIER_MODEL === undefined
        ? {}
        : { model: config.CHECKER_CLASSIFIER_MODEL }),
      cloud: classifierUse('CHECKER', config).cloud,
    },
    {
      service,
      role: 'embeddings',
      provider: config.EMBEDDINGS_PROVIDER,
      model: config.EMBEDDINGS_MODEL,
      cloud: embeddingsUse(config).cloud,
    },
    { service, role: 'search', provider: live ? config.SEARCH_PROVIDER : 'mock', cloud: false },
    ...(live && config.GOOGLE_FACTCHECK_API_KEY !== undefined
      ? [{ service, role: 'factcheck' as const, provider: 'google-factcheck', cloud: true }]
      : []),
  ];
}
