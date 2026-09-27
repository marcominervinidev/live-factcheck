import {
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
    ...llmConfigShape('EXTRACTOR'),
  })
  .superRefine(checkLlmConfig('EXTRACTOR'))
  .superRefine(checkPrivacyMode((config) => [llmUse('EXTRACTOR', config)]));

export const secretKeys = ['REDIS_PASSWORD', llmSecretKey('EXTRACTOR')] as const;

export type Config = z.infer<typeof configSchema>;
