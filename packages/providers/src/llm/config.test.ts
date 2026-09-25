import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { checkLlmConfig, describeLlmConfig, llmConfigShape, llmSecretKey } from './config.js';

const schema = z.object(llmConfigShape('CHECKER')).superRefine(checkLlmConfig('CHECKER'));

const failures = (env: Record<string, string>) =>
  schema.safeParse(env).error?.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) ??
  [];

describe('LLM config per task', () => {
  it('accepts anthropic with model and key, without base URL', () => {
    const env = {
      CHECKER_LLM_PROVIDER: 'anthropic',
      CHECKER_LLM_MODEL: 'some-model',
      CHECKER_LLM_API_KEY: 'sk-ant-xyz',
    };
    expect(failures(env)).toEqual([]);
  });

  it('requires an API key for anthropic', () => {
    expect(failures({ CHECKER_LLM_PROVIDER: 'anthropic', CHECKER_LLM_MODEL: 'm' })).toEqual([
      'CHECKER_LLM_API_KEY: required when CHECKER_LLM_PROVIDER=anthropic',
    ]);
  });

  it('requires a base URL for openai-compatible but no key (LM Studio, Ollama)', () => {
    expect(failures({ CHECKER_LLM_PROVIDER: 'openai-compatible', CHECKER_LLM_MODEL: 'm' })).toEqual(
      ['CHECKER_LLM_BASE_URL: required when CHECKER_LLM_PROVIDER=openai-compatible'],
    );
    expect(
      failures({
        CHECKER_LLM_PROVIDER: 'openai-compatible',
        CHECKER_LLM_MODEL: 'm',
        CHECKER_LLM_BASE_URL: 'http://host.docker.internal:1234/v1',
      }),
    ).toEqual([]);
  });

  it('accepts mock without key or base URL', () => {
    expect(failures({ CHECKER_LLM_PROVIDER: 'mock', CHECKER_LLM_MODEL: 'mock' })).toEqual([]);
  });

  it('rejects unknown providers and a missing model', () => {
    const keys = failures({ CHECKER_LLM_PROVIDER: 'gemini' }).map((f) => f.split(':')[0]);
    expect(keys).toEqual(['CHECKER_LLM_PROVIDER', 'CHECKER_LLM_MODEL']);
  });

  it('keeps tasks independent: extractor keys do not satisfy the checker', () => {
    const extractorOnly = { EXTRACTOR_LLM_PROVIDER: 'mock', EXTRACTOR_LLM_MODEL: 'mock' };
    expect(failures(extractorOnly).length).toBeGreaterThan(0);
  });

  it('names the secret key per task', () => {
    expect(llmSecretKey('EXTRACTOR')).toBe('EXTRACTOR_LLM_API_KEY');
    expect(llmSecretKey('CHECKER')).toBe('CHECKER_LLM_API_KEY');
  });

  it('describes the config for logs without the key and with only the base URL origin', () => {
    const config = schema.parse({
      CHECKER_LLM_PROVIDER: 'openai-compatible',
      CHECKER_LLM_MODEL: 'qwen',
      CHECKER_LLM_BASE_URL: 'http://user:pw@host.docker.internal:11434/v1',
      CHECKER_LLM_API_KEY: 'not-needed-but-set',
    });
    const description = describeLlmConfig('CHECKER', config);
    expect(description).toEqual({
      provider: 'openai-compatible',
      model: 'qwen',
      baseUrl: 'http://host.docker.internal:11434',
    });
    expect(JSON.stringify(description)).not.toContain('not-needed-but-set');
  });
});
