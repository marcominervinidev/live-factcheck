import { randomUUID } from 'node:crypto';

import { sessionEventsChannel } from '@lfc/contracts';
import type { Logger } from '@lfc/service-kit';
import type { Redis } from 'ioredis';

const key = (sessionId: string) => `session:v1:${sessionId}`;

/** Session records in Redis, so any gateway replica can accept requests for any session (ADR 0011). */
export function sessionStore(redis: Redis, ttlMs: number) {
  return {
    async create(): Promise<string> {
      const sessionId = randomUUID();
      await redis.set(key(sessionId), '1', 'PX', ttlMs);
      return sessionId;
    },
    async exists(sessionId: string): Promise<boolean> {
      return (await redis.exists(key(sessionId))) === 1;
    },
    async end(sessionId: string): Promise<void> {
      await redis.del(key(sessionId));
    },
  };
}

export type SessionStore = ReturnType<typeof sessionStore>;

/**
 * One Pub/Sub connection per gateway instance, multiplexed over the sessions whose WebSocket
 * this instance holds (brief 6.7: fan-out via Redis Pub/Sub, no session affinity needed).
 */
export function sessionHub(redis: Redis, logger: Logger) {
  const subscriber = redis.duplicate();
  const listeners = new Map<string, (message: string) => void>();
  subscriber.on('message', (channel: string, message: string) => {
    listeners.get(channel)?.(message);
  });
  subscriber.on('error', (error: Error) => {
    logger.warn({ err: error }, 'session hub connection error');
  });

  const ready = async (timeoutMs: number) => {
    if (subscriber.status === 'ready') return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        subscriber.off('ready', onReady);
        reject(new Error('session hub not connected'));
      }, timeoutMs);
      const onReady = () => {
        clearTimeout(timer);
        resolve();
      };
      subscriber.once('ready', onReady);
    });
  };

  return {
    async join(sessionId: string, onMessage: (message: string) => void): Promise<void> {
      await ready(5_000);
      const channel = sessionEventsChannel(sessionId);
      listeners.set(channel, onMessage);
      await subscriber.subscribe(channel);
    },
    async leave(sessionId: string): Promise<void> {
      const channel = sessionEventsChannel(sessionId);
      listeners.delete(channel);
      if (subscriber.status === 'ready') await subscriber.unsubscribe(channel);
    },
    close(): void {
      listeners.clear();
      subscriber.disconnect();
    },
  };
}

export type SessionHub = ReturnType<typeof sessionHub>;
