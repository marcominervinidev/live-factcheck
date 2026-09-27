// Shared by the config and wiring unit tests: a valid all-mock environment.
import { fileURLToPath } from 'node:url';

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
  SOURCE_TIERS_FILE: fileURLToPath(
    new URL('../../../../config/source-tiers.yaml', import.meta.url),
  ),
  CHECKER_USER_AGENT_URL: 'https://github.com/marcominervinidev/live-factcheck',
} as const;
