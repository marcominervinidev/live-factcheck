// Shared by the config and wiring unit tests: a valid all-mock environment.
import { repoSourceTiersPath } from '@lfc/service-kit/testing';

export const MOCK_CONFIG_ENV = {
  PORT: '8080',
  REDIS_URL: 'redis://redis:6379',
  REDIS_PASSWORD: 'x'.repeat(16),
  CHECKER_LLM_PROVIDER: 'mock',
  CHECKER_LLM_MODEL: 'mock',
  CHECKER_CLASSIFIER_PROVIDER: 'mock',
  SEARCH_PROVIDER: 'mock',
  EMBEDDINGS_PROVIDER: 'mock',
  EMBEDDINGS_MODEL: 'mock',
  CHECKER_RESEARCH_SOURCES: 'mock',
  // Walks up to the repo root, so Stryker's sandbox (two levels deeper) works too.
  SOURCE_TIERS_FILE: repoSourceTiersPath(),
  CHECKER_USER_AGENT_URL: 'https://github.com/marcominervinidev/live-factcheck',
} as const;
