import { baseConfigSchema } from '@lfc/service-kit';
import { z } from 'zod';

export const configSchema = baseConfigSchema.extend({
  /** `redis://host:port` without credentials. */
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  /** ACL user; omit to use Redis' default user. */
  REDIS_USERNAME: z.string().min(1).optional(),
  REDIS_PASSWORD: z.string().min(1),
});

export const secretKeys = ['REDIS_PASSWORD'] as const;

export type Config = z.infer<typeof configSchema>;
