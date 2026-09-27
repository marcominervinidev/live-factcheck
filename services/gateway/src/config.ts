import { baseConfigSchema } from '@lfc/service-kit';
import { z } from 'zod';

export const configSchema = baseConfigSchema.extend({
  /** `redis://host:port` without credentials. */
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  /** ACL user; omit to use Redis' default user. */
  REDIS_USERNAME: z.string().min(1).optional(),
  REDIS_PASSWORD: z.string().min(1),
  /** Shared access token for REST and WebSocket (ADR 0011). Secret; at least 32 characters. */
  GATEWAY_TOKEN: z.string().min(32),
  /** Shown on the settings page; the workers enforce it (brief 15.6). */
  PRIVACY_MODE: z.enum(['cloud', 'local']).default('cloud'),
  WS_AUTH_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  /** Maximum session duration (brief 15.5); also the TTL of the session record in Redis. */
  MAX_SESSION_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(2 * 60 * 60 * 1_000),
  /** Text-mode checks per minute, shared by all replicas (brief 15.5). */
  RATE_LIMIT_CHECKS_PER_MINUTE: z.coerce.number().int().positive().default(20),
});

export const secretKeys = ['REDIS_PASSWORD', 'GATEWAY_TOKEN'] as const;

export type Config = z.infer<typeof configSchema>;
