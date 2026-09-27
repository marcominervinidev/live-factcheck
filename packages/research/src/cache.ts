import { createHash } from 'node:crypto';

/** A string cache with TTL; in the services it is Redis (ADR 0008 level 3). */
export interface TextCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

/** The Redis commands the cache needs; an ioredis client fits this shape. */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
}

export function redisTextCache(client: RedisLike): TextCache {
  return {
    get: (key) => client.get(key),
    async set(key, value, ttlSeconds) {
      await client.set(key, value, 'EX', ttlSeconds);
    },
  };
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
