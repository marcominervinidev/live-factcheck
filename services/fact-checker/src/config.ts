import {
  TYPESAFE_API_KEY,
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
    ...llmConfigShape('CHECKER'),
    ...classifierConfigShape('CHECKER'),
  })
  .superRefine(checkLlmConfig('CHECKER'))
  .superRefine(checkClassifierConfig('CHECKER'))
  .superRefine(
    checkPrivacyMode((config) => [llmUse('CHECKER', config), classifierUse('CHECKER', config)]),
  );

export const secretKeys = ['REDIS_PASSWORD', llmSecretKey('CHECKER'), TYPESAFE_API_KEY] as const;

export type Config = z.infer<typeof configSchema>;
