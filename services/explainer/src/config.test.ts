import { describe, expect, it } from 'vitest';

import { configSchema, secretKeys } from './config.js';

const ENV = {
  PORT: '8080',
  REDIS_URL: 'redis://redis:6379',
  REDIS_PASSWORD: 'x'.repeat(16),
  EXPLAINER_LLM_PROVIDER: 'mock',
  EXPLAINER_LLM_MODEL: 'mock',
} as const;

describe('explainer config', () => {
  it('accepts a mock LLM with the default privacy mode', () => {
    expect(configSchema.parse(ENV)).toMatchObject({ PRIVACY_MODE: 'cloud' });
  });

  it('refuses a cloud LLM in local privacy mode, but accepts a local endpoint', () => {
    const cloud = {
      ...ENV,
      PRIVACY_MODE: 'local',
      EXPLAINER_LLM_PROVIDER: 'openai-compatible',
      EXPLAINER_LLM_MODEL: 'qwen3',
      EXPLAINER_LLM_BASE_URL: 'https://api.example.com/v1',
    };
    expect(configSchema.safeParse(cloud).success).toBe(false);
    expect(
      configSchema.safeParse({
        ...cloud,
        EXPLAINER_LLM_BASE_URL: 'http://host.docker.internal:1234/v1',
      }).success,
    ).toBe(true);
  });

  it('bounds the explanation time budget (default 45 s)', () => {
    expect(configSchema.parse(ENV).EXPLAINER_TIMEOUT_MS).toBe(45_000);
    expect(
      configSchema.parse({ ...ENV, EXPLAINER_TIMEOUT_MS: '180000' }).EXPLAINER_TIMEOUT_MS,
    ).toBe(180_000);
    expect(configSchema.safeParse({ ...ENV, EXPLAINER_TIMEOUT_MS: '600001' }).success).toBe(false);
  });

  it('gets only its own LLM key, never classifier or search keys (ADR 0009)', () => {
    expect(secretKeys).toEqual(['REDIS_PASSWORD', 'EXPLAINER_LLM_API_KEY']);
  });
});
