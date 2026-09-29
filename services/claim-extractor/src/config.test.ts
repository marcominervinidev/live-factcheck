import { describe, expect, it } from 'vitest';

import { configSchema, secretKeys } from './config.js';

const ENV = {
  PORT: '8080',
  REDIS_URL: 'redis://redis:6379',
  REDIS_PASSWORD: 'x',
  EXTRACTOR_LLM_PROVIDER: 'mock',
  EXTRACTOR_LLM_MODEL: 'mock',
  DETECTOR_CLASSIFIER_PROVIDER: 'mock',
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
    expect(secretKeys).toEqual(['REDIS_PASSWORD', 'EXTRACTOR_LLM_API_KEY', 'TYPESAFE_API_KEY']);
  });

  it('refuses Jev as detector classifier in local privacy mode (brief 15.6)', () => {
    const issues = configSchema.safeParse({
      ...ENV,
      PRIVACY_MODE: 'local',
      DETECTOR_CLASSIFIER_PROVIDER: 'typesafe',
      DETECTOR_CLASSIFIER_MODEL: 'jev-1.13.0',
      TYPESAFE_API_KEY: 'ts-test-key-never-logged',
    }).error?.issues;
    expect(issues?.map((i) => i.message)).toEqual([
      'DETECTOR_CLASSIFIER_PROVIDER=typesafe sends data to a cloud service; not allowed when PRIVACY_MODE=local',
    ]);
  });

  it('applies the detection defaults of ADR 0017', () => {
    expect(configSchema.parse(ENV)).toMatchObject({
      DETECTOR_WINDOW_SEGMENTS: 6,
      DETECTOR_MIN_WORDS: 5,
      DETECTOR_MIN_SCORE: 3,
      DETECTOR_DEDUP_CANDIDATES: 10,
      DETECTOR_CONFIDENCE_HIGH: 0.75,
    });
  });
});
