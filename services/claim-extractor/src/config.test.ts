import { describe, expect, it } from 'vitest';

import { configSchema, secretKeys } from './config.js';

const ENV = {
  PORT: '8080',
  REDIS_URL: 'redis://redis:6379',
  REDIS_PASSWORD: 'x',
  EXTRACTOR_LLM_PROVIDER: 'mock',
  EXTRACTOR_LLM_MODEL: 'mock',
} as const;

describe('claim-extractor config', () => {
  it('accepts a mock LLM and refuses a cloud LLM in local privacy mode', () => {
    expect(configSchema.safeParse(ENV).success).toBe(true);
    expect(
      configSchema.safeParse({
        ...ENV,
        PRIVACY_MODE: 'local',
        EXTRACTOR_LLM_PROVIDER: 'anthropic',
        EXTRACTOR_LLM_MODEL: 'claude-opus-5',
        EXTRACTOR_LLM_API_KEY: 'k'.repeat(20),
      }).success,
    ).toBe(false);
    expect(secretKeys).toEqual(['REDIS_PASSWORD', 'EXTRACTOR_LLM_API_KEY']);
  });
});
