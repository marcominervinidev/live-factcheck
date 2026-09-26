import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { checkLlmConfig, llmConfigShape } from './config.js';
import { createLlmProvider } from './factory.js';

const schema = z.object(llmConfigShape('EXPLAINER')).superRefine(checkLlmConfig('EXPLAINER'));

describe('createLlmProvider', () => {
  it('builds each configured provider with its model', () => {
    const anthropic = createLlmProvider(
      'EXPLAINER',
      schema.parse({
        EXPLAINER_LLM_PROVIDER: 'anthropic',
        EXPLAINER_LLM_MODEL: 'claude-x',
        EXPLAINER_LLM_API_KEY: 'k',
      }),
    );
    expect([anthropic.name, anthropic.model]).toEqual(['anthropic', 'claude-x']);

    const local = createLlmProvider(
      'EXPLAINER',
      schema.parse({
        EXPLAINER_LLM_PROVIDER: 'openai-compatible',
        EXPLAINER_LLM_MODEL: 'qwen',
        EXPLAINER_LLM_BASE_URL: 'http://host.docker.internal:11434/v1',
      }),
    );
    expect([local.name, local.model]).toEqual(['openai-compatible', 'qwen']);
  });

  it('applies the default timeout and retries', () => {
    const config = schema.parse({ EXPLAINER_LLM_PROVIDER: 'mock', EXPLAINER_LLM_MODEL: 'mock' });
    expect(config.EXPLAINER_LLM_TIMEOUT_MS).toBe(30_000);
    expect(config.EXPLAINER_LLM_MAX_RETRIES).toBe(2);
  });

  it('requires mock answers from the service for provider mock', async () => {
    const config = schema.parse({ EXPLAINER_LLM_PROVIDER: 'mock', EXPLAINER_LLM_MODEL: 'mock' });
    expect(() => createLlmProvider('EXPLAINER', config)).toThrow('needs mock answers');

    const mock = createLlmProvider('EXPLAINER', config, {
      mock: (request) => ({ explanation: `mock for ${request.task}` }),
    });
    const result = await mock.generateStructured({
      task: 'explanation',
      system: 's',
      user: 'u',
      schema: z.strictObject({ explanation: z.string() }),
    });
    expect(result.value).toEqual({ explanation: 'mock for explanation' });
  });

  it('rejects a mock answer that does not match the schema', async () => {
    const config = schema.parse({ EXPLAINER_LLM_PROVIDER: 'mock', EXPLAINER_LLM_MODEL: 'mock' });
    const mock = createLlmProvider('EXPLAINER', config, { mock: () => ({ wrong: true }) });
    await expect(
      mock.generateStructured({
        task: 'explanation',
        system: 's',
        user: 'u',
        schema: z.strictObject({ explanation: z.string() }),
      }),
    ).rejects.toMatchObject({ kind: 'invalid_output' });
  });
});
