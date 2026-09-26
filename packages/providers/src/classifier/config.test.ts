import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  checkClassifierConfig,
  classifierConfigShape,
  describeClassifierConfig,
} from './config.js';

const schema = z
  .object(classifierConfigShape('CHECKER'))
  .superRefine(checkClassifierConfig('CHECKER'));

const failures = (env: Record<string, string>) =>
  schema.safeParse(env).error?.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) ??
  [];

describe('classifier config per task', () => {
  it('accepts the llm classifier without model or key and applies the ADR thresholds', () => {
    const config = schema.parse({ CHECKER_CLASSIFIER_PROVIDER: 'llm' });
    expect(config.CHECKER_CONFIDENCE_HIGH).toBe(0.75);
    expect(config.CHECKER_CONFIDENCE_LOW).toBe(0.45);
  });

  it('requires a pinned model and the API key for typesafe', () => {
    expect(failures({ CHECKER_CLASSIFIER_PROVIDER: 'typesafe' })).toEqual([
      'CHECKER_CLASSIFIER_MODEL: required when CHECKER_CLASSIFIER_PROVIDER=typesafe (pin a version such as jev-1.13.0)',
      'TYPESAFE_API_KEY: required when CHECKER_CLASSIFIER_PROVIDER=typesafe',
    ]);
    expect(
      failures({
        CHECKER_CLASSIFIER_PROVIDER: 'typesafe',
        CHECKER_CLASSIFIER_MODEL: 'jev-1.13.0',
        TYPESAFE_API_KEY: 'ts-key',
      }),
    ).toEqual([]);
  });

  it('rejects thresholds outside (0, 1) and a high threshold not above the low one', () => {
    expect(
      failures({ CHECKER_CLASSIFIER_PROVIDER: 'mock', CHECKER_CONFIDENCE_HIGH: '1' }).map(
        (f) => f.split(':')[0],
      ),
    ).toEqual(['CHECKER_CONFIDENCE_HIGH']);
    expect(
      failures({
        CHECKER_CLASSIFIER_PROVIDER: 'mock',
        CHECKER_CONFIDENCE_HIGH: '0.4',
        CHECKER_CONFIDENCE_LOW: '0.4',
      }),
    ).toEqual(['CHECKER_CONFIDENCE_HIGH: must be greater than CHECKER_CONFIDENCE_LOW']);
  });

  it('rejects unknown providers', () => {
    expect(failures({ CHECKER_CLASSIFIER_PROVIDER: 'jev' }).map((f) => f.split(':')[0])).toEqual([
      'CHECKER_CLASSIFIER_PROVIDER',
    ]);
  });

  it('describes the config for logs without the key', () => {
    const config = schema.parse({
      CHECKER_CLASSIFIER_PROVIDER: 'typesafe',
      CHECKER_CLASSIFIER_MODEL: 'jev-1.13.0',
      TYPESAFE_API_KEY: 'ts-secret-key',
    });
    const description = describeClassifierConfig('CHECKER', config);
    expect(description).toEqual({
      provider: 'typesafe',
      model: 'jev-1.13.0',
      high: 0.75,
      low: 0.45,
    });
    expect(JSON.stringify(description)).not.toContain('ts-secret-key');
  });
});
