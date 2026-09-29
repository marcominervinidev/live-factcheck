import {
  STT_SECRET_KEYS,
  budgetConfigShape,
  checkPrivacyMode,
  checkSttConfig,
  privacyModeShape,
  sttConfigShape,
  sttUse,
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
    ...sttConfigShape,
    ...budgetConfigShape,
    /**
     * Audio waiting for the STT provider, beyond which a recording stops with `overloaded`
     * instead of piling up memory (ADR 0015). 256 KiB ≈ 8 s of audio.
     */
    STT_MAX_BUFFERED_BYTES: z.coerce
      .number()
      .int()
      .min(16 * 1024)
      .max(4 * 1024 * 1024)
      .default(256 * 1024),
  })
  .superRefine(checkSttConfig)
  .superRefine(checkPrivacyMode((config) => [sttUse(config)]));

// Only the STT keys: transcription never gets LLM, classifier or search keys (brief 15.1).
export const secretKeys = ['REDIS_PASSWORD', ...STT_SECRET_KEYS] as const;

export type Config = z.infer<typeof configSchema>;
