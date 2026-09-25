import { Redis } from 'ioredis';

import type { ReadinessCheck } from './http.js';
import type { Logger } from './logger.js';

export interface CreateRedisOptions {
  /** `redis://host:port[/db]` without credentials; the password is a separate secret. */
  readonly url: string;
  readonly username?: string;
  readonly password: string;
  readonly logger: Logger;
}

export interface RedisConnection {
  readonly client: Redis;
  readonly readiness: ReadinessCheck;
  close(): Promise<void>;
}

/**
 * Redis client with fail-fast behaviour: commands are not queued while disconnected,
 * so readiness reflects the real connection state instead of hanging.
 */
export function createRedis(options: CreateRedisOptions): RedisConnection {
  const url = new URL(options.url);
  if (url.password !== '' || url.username !== '') {
    throw new Error('REDIS_URL must not contain credentials; use the password secret instead');
  }

  const client = new Redis(options.url, {
    ...(options.username === undefined ? {} : { username: options.username }),
    password: options.password,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
    retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
  });

  let lastError: string | undefined;
  client.on('error', (error: Error) => {
    // ioredis emits the same error on every retry; log only changes.
    if (error.message !== lastError) {
      lastError = error.message;
      options.logger.warn({ err: error }, 'redis connection error');
    }
  });
  client.on('ready', () => {
    lastError = undefined;
    options.logger.info('redis connection ready');
  });

  return {
    client,
    readiness: {
      name: 'redis',
      async check() {
        await client.ping();
      },
    },
    async close() {
      if (client.status === 'end') {
        return;
      }
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    },
  };
}
