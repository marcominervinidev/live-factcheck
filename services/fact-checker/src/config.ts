import {
  TYPESAFE_API_KEY,
  budgetConfigShape,
  checkClassifierConfig,
  checkEmbeddingsConfig,
  checkLlmConfig,
  checkPrivacyMode,
  checkSearchConfig,
  classifierConfigShape,
  classifierUse,
  embeddingsConfigShape,
  embeddingsUse,
  llmConfigShape,
  llmSecretKey,
  llmUse,
  privacyModeShape,
  searchConfigShape,
} from '@lfc/providers';
import { baseConfigSchema } from '@lfc/service-kit';
import { z } from 'zod';

const ms = (fallback: number) => z.coerce.number().int().positive().default(fallback);
const count = (fallback: number, max: number) =>
  z.coerce.number().int().min(1).max(max).default(fallback);
const seconds = (fallback: number) => z.coerce.number().int().positive().default(fallback);

export const configSchema = baseConfigSchema
  .extend({
    /** `redis://host:port` without credentials. */
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    /** ACL user; omit to use Redis' default user. */
    REDIS_USERNAME: z.string().min(1).optional(),
    REDIS_PASSWORD: z.string().min(1),
    ...privacyModeShape,
    ...llmConfigShape('CHECKER'),
    ...classifierConfigShape('CHECKER'),
    ...searchConfigShape,
    ...embeddingsConfigShape,
    ...budgetConfigShape,
    /**
     * `live`: the three source tiers on the internet (brief 9.1). `mock`: a fixed local corpus,
     * for tests and CI, which must not reach external networks (brief 13.1).
     */
    CHECKER_RESEARCH_SOURCES: z.enum(['live', 'mock']),
    /** Tier 1; the tier is skipped when no key is configured. Secret. */
    GOOGLE_FACTCHECK_API_KEY: z.string().min(1).optional(),
    /** `config/source-tiers.yaml` inside the image (brief 9.1: tiers are data). */
    SOURCE_TIERS_FILE: z.string().min(1),
    /** Contact URL in our User-Agent (Wikimedia policy, brief 9.6). */
    CHECKER_USER_AGENT_URL: z.url({ protocol: /^https$/ }),
    CHECKER_FETCH_TIMEOUT_MS: ms(8_000),
    // Capped: jsdom parses synchronously (security review finding 6).
    CHECKER_FETCH_MAX_BYTES: z.coerce.number().int().positive().max(5_000_000).default(2_000_000),
    CHECKER_MAX_SOURCE_CHARS: z.coerce.number().int().positive().default(20_000),
    CHECKER_TIER_TIMEOUT_MS: ms(9_000),
    CHECKER_WEB_PAGES: count(4, 10),
    CHECKER_TOP_K: count(6, 10),
    CHECKER_VERDICT_CACHE_TTL_S: seconds(7 * 24 * 3600),
    RESEARCH_SEARCH_CACHE_TTL_S: seconds(3600),
    RESEARCH_PAGE_CACHE_TTL_S: seconds(24 * 3600),
  })
  .superRefine(checkLlmConfig('CHECKER'))
  .superRefine(checkClassifierConfig('CHECKER'))
  .superRefine(checkSearchConfig)
  .superRefine(checkEmbeddingsConfig)
  .superRefine(
    checkPrivacyMode((config) => [
      llmUse('CHECKER', config),
      classifierUse('CHECKER', config),
      embeddingsUse(config),
      {
        setting: 'CHECKER_RESEARCH_SOURCES=live with GOOGLE_FACTCHECK_API_KEY',
        cloud:
          config.CHECKER_RESEARCH_SOURCES === 'live' &&
          config.GOOGLE_FACTCHECK_API_KEY !== undefined,
      },
    ]),
  );

export const secretKeys = [
  'REDIS_PASSWORD',
  llmSecretKey('CHECKER'),
  TYPESAFE_API_KEY,
  'EMBEDDINGS_API_KEY',
  'GOOGLE_FACTCHECK_API_KEY',
] as const;

export type Config = z.infer<typeof configSchema>;
