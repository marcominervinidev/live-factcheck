import { describe, expect, it } from 'vitest';

import { configSchema, secretKeys } from './config.js';

describe('transcription config', () => {
  it('needs Redis with a password and nothing else yet (STT adapters arrive in phase 2)', () => {
    expect(
      configSchema.safeParse({ PORT: '8080', REDIS_URL: 'redis://redis:6379', REDIS_PASSWORD: 'x' })
        .success,
    ).toBe(true);
    expect(configSchema.safeParse({ PORT: '8080', REDIS_URL: 'http://redis:6379' }).success).toBe(
      false,
    );
    expect(secretKeys).toEqual(['REDIS_PASSWORD']);
  });
});
