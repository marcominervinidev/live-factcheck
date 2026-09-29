import {
  TYPESAFE_API_KEY,
  budgetConfigShape,
  checkClassifierConfig,
  checkLlmConfig,
  checkPrivacyMode,
  classifierConfigShape,
  classifierUse,
  llmConfigShape,
  llmSecretKey,
  llmUse,
  privacyModeShape,
} from '@lfc/providers';
import { baseConfigSchema } from '@lfc/service-kit';
import { z } from 'zod';

export const configSchema = baseConfigSchema
  .extend({
    /** `redis://host:port` without credentials. */
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    /** ACL user; omit to use Redis' default user. */
    REDIS_USERNAME: z.string().min(1).optional(),
    REDIS_PASSWORD: z.string().min(1),
    ...privacyModeShape,
    // The standalone formulation and, for DETECTOR_CLASSIFIER_PROVIDER=llm, the classifier.
    ...llmConfigShape('EXTRACTOR'),
    ...classifierConfigShape('DETECTOR'),
    ...budgetConfigShape,
    /** Final segments kept per session as context (ADR 0017). */
    DETECTOR_WINDOW_SEGMENTS: z.coerce.number().int().min(1).max(30).default(6),
    /** Shorter segments are dropped by the pre-filter. */
    DETECTOR_MIN_WORDS: z.coerce.number().int().min(1).max(20).default(5),
    /** Minimum checkworthiness on the 1–5 scale. */
    DETECTOR_MIN_SCORE: z.coerce.number().int().min(1).max(5).default(3),
    /** Earlier claims of the session compared for duplicates. */
    DETECTOR_DEDUP_CANDIDATES: z.coerce.number().int().min(0).max(50).default(10),
    /** Time budget per segment (classifier, formulation and duplicate check together). */
    EXTRACTOR_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(600_000).default(30_000),
    /** Window and claim memory live as long as a session (gateway MAX_SESSION_MS). */
    SESSION_TTL_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(2 * 60 * 60 * 1_000),
  })
  .superRefine(checkLlmConfig('EXTRACTOR'))
  .superRefine(checkClassifierConfig('DETECTOR'))
  .superRefine(
    checkPrivacyMode((config) => [llmUse('EXTRACTOR', config), classifierUse('DETECTOR', config)]),
  );

export const secretKeys = ['REDIS_PASSWORD', llmSecretKey('EXTRACTOR'), TYPESAFE_API_KEY] as const;

export type Config = z.infer<typeof configSchema>;
