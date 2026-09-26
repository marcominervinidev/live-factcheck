import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createMockLlmProvider } from '../llm/mock.js';
import { checkClassifierConfig, classifierConfigShape } from './config.js';
import { confidenceLevel, createClassifier } from './factory.js';

const schema = z
  .object(classifierConfigShape('CHECKER'))
  .superRefine(checkClassifierConfig('CHECKER'));
const llm = createMockLlmProvider('local-llm', () => ({}));

describe('createClassifier', () => {
  it('builds llm, typesafe and mock classifiers', () => {
    expect(
      createClassifier('CHECKER', schema.parse({ CHECKER_CLASSIFIER_PROVIDER: 'llm' }), { llm }),
    ).toMatchObject({ name: 'llm', model: 'local-llm' });
    expect(
      createClassifier(
        'CHECKER',
        schema.parse({
          CHECKER_CLASSIFIER_PROVIDER: 'typesafe',
          CHECKER_CLASSIFIER_MODEL: 'jev-1.13.0',
          TYPESAFE_API_KEY: 'k',
        }),
        { llm },
      ),
    ).toMatchObject({ name: 'typesafe', model: 'jev-1.13.0' });
    expect(
      createClassifier('CHECKER', schema.parse({ CHECKER_CLASSIFIER_PROVIDER: 'mock' }), {
        llm,
        mock: () => ({}),
      }),
    ).toMatchObject({ name: 'mock', model: 'mock' });
  });

  it('requires mock answers for provider mock', () => {
    expect(() =>
      createClassifier('CHECKER', schema.parse({ CHECKER_CLASSIFIER_PROVIDER: 'mock' }), { llm }),
    ).toThrow('needs mock answers');
  });
});

describe('confidenceLevel (ADR 0007 thresholds)', () => {
  const thresholds = { high: 0.75, low: 0.45 };
  it.each([
    [0.9, 'hoch'],
    [0.75, 'hoch'],
    [0.74, 'mittel'],
    [0.45, 'mittel'],
    [0.44, 'niedrig'],
    [0, 'niedrig'],
  ] as const)('%d → %s', (confidence, level) => {
    expect(confidenceLevel(confidence, thresholds)).toBe(level);
  });
});
