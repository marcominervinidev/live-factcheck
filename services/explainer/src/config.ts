import {
  budgetConfigShape,
  checkLlmConfig,
  checkPrivacyMode,
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
    ...llmConfigShape('EXPLAINER'),
    ...budgetConfigShape,
  })
  .superRefine(checkLlmConfig('EXPLAINER'))
  .superRefine(checkPrivacyMode((config) => [llmUse('EXPLAINER', config)]));

// Only the LLM key: the explainer never gets classifier or search keys (brief 15.1, ADR 0009).
export const secretKeys = ['REDIS_PASSWORD', llmSecretKey('EXPLAINER')] as const;

export type Config = z.infer<typeof configSchema>;
