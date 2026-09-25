import { describe, expect, it } from 'vitest';

import { createRedis } from './redis.js';
import { silentLogger } from './testing/silent-logger.js';

describe('createRedis', () => {
  it('refuses a URL with embedded credentials so the password cannot leak via the URL', () => {
    expect(() =>
      createRedis({ url: 'redis://:pw@redis:6379', password: 'pw', logger: silentLogger() }),
    ).toThrow('REDIS_URL must not contain credentials');
  });
});
