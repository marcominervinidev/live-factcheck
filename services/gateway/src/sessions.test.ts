import { createLogger } from '@lfc/service-kit';
import { Redis } from 'ioredis';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sessionHub } from './sessions.js';

describe('sessionHub', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects join when the Pub/Sub connection does not come up in time', async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    const logger = createLogger({
      service: 'gateway',
      level: 'info',
      secretKeys: [],
      destination: { write: (line: string) => lines.push(line) },
    });
    // lazyConnect: the duplicate never connects, so the hub never becomes ready.
    const redis = new Redis({ lazyConnect: true });
    const hub = sessionHub(redis, logger);

    const joined = hub.join('4b0f3d4e-1c55-4a52-9d1b-2f1f7f0d2a11', () => undefined);
    const outcome = expect(joined).rejects.toThrow('session hub not connected');
    await vi.advanceTimersByTimeAsync(5_000);
    await outcome;

    // Leaving an unconnected hub does not touch Redis.
    await hub.leave('4b0f3d4e-1c55-4a52-9d1b-2f1f7f0d2a11');
    hub.close();
    redis.disconnect();
  });
});
