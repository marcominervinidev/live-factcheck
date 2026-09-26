import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { checkClassifierConfig, classifierConfigShape } from './classifier/config.js';
import { checkLlmConfig, llmConfigShape } from './llm/config.js';
import {
  checkPrivacyMode,
  classifierUse,
  isLocalEndpoint,
  llmUse,
  privacyModeShape,
} from './privacy.js';

const schema = z
  .object({
    ...privacyModeShape,
    ...llmConfigShape('CHECKER'),
    ...classifierConfigShape('CHECKER'),
  })
  .superRefine(checkLlmConfig('CHECKER'))
  .superRefine(checkClassifierConfig('CHECKER'))
  .superRefine(
    checkPrivacyMode((config) => [llmUse('CHECKER', config), classifierUse('CHECKER', config)]),
  );

const failures = (env: Record<string, string>) =>
  schema.safeParse(env).error?.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) ??
  [];

const localLlm = {
  CHECKER_LLM_PROVIDER: 'openai-compatible',
  CHECKER_LLM_MODEL: 'qwen',
  CHECKER_LLM_BASE_URL: 'http://host.docker.internal:11434/v1',
};

describe('isLocalEndpoint', () => {
  it.each([
    'http://localhost:1234/v1',
    'http://host.docker.internal:1234/v1',
    'http://ollama:11434/v1',
    'http://mac.local:1234/v1',
    'http://192.168.1.20:1234/v1',
    'http://10.0.0.5/v1',
    'http://172.20.0.3/v1',
    'http://127.0.0.1/v1',
    'http://[::1]:1234/v1',
    'http://[fd00::1]/v1',
  ])('treats %s as local', (url) => {
    expect(isLocalEndpoint(url)).toBe(true);
  });

  it.each([
    'https://api.openai.com/v1',
    'https://example.org/v1',
    'http://8.8.8.8/v1',
    'http://172.32.0.1/v1',
    'http://[2001:db8::1]/v1',
  ])('treats %s as cloud', (url) => {
    expect(isLocalEndpoint(url)).toBe(false);
  });
});

describe('PRIVACY_MODE', () => {
  it('defaults to cloud and then allows cloud providers', () => {
    const env = {
      CHECKER_LLM_PROVIDER: 'anthropic',
      CHECKER_LLM_MODEL: 'm',
      CHECKER_LLM_API_KEY: 'k',
      CHECKER_CLASSIFIER_PROVIDER: 'typesafe',
      CHECKER_CLASSIFIER_MODEL: 'jev-1.13.0',
      TYPESAFE_API_KEY: 't',
    };
    expect(failures(env)).toEqual([]);
    expect(schema.parse(env).PRIVACY_MODE).toBe('cloud');
  });

  it('allows local LLMs and the llm classifier in local mode', () => {
    expect(
      failures({ PRIVACY_MODE: 'local', ...localLlm, CHECKER_CLASSIFIER_PROVIDER: 'llm' }),
    ).toEqual([]);
  });

  it('rejects Jev and Anthropic in local mode, naming each setting', () => {
    expect(
      failures({
        PRIVACY_MODE: 'local',
        CHECKER_LLM_PROVIDER: 'anthropic',
        CHECKER_LLM_MODEL: 'm',
        CHECKER_LLM_API_KEY: 'k',
        CHECKER_CLASSIFIER_PROVIDER: 'typesafe',
        CHECKER_CLASSIFIER_MODEL: 'jev-1.13.0',
        TYPESAFE_API_KEY: 't',
      }),
    ).toEqual([
      'PRIVACY_MODE: CHECKER_LLM_PROVIDER=anthropic sends data to a cloud service; not allowed when PRIVACY_MODE=local',
      'PRIVACY_MODE: CHECKER_CLASSIFIER_PROVIDER=typesafe sends data to a cloud service; not allowed when PRIVACY_MODE=local',
    ]);
  });

  it('rejects an openai-compatible endpoint on the internet in local mode', () => {
    expect(
      failures({
        PRIVACY_MODE: 'local',
        ...localLlm,
        CHECKER_LLM_BASE_URL: 'https://api.openai.com/v1',
        CHECKER_CLASSIFIER_PROVIDER: 'llm',
      }),
    ).toEqual([
      'PRIVACY_MODE: CHECKER_LLM_PROVIDER=openai-compatible sends data to a cloud service; not allowed when PRIVACY_MODE=local',
    ]);
  });
});
