import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { FakeServer } from '../testing/fake-server.js';
import { anthropicMessage, startFakeServer } from '../testing/fake-server.js';
import { createAnthropicProvider } from './anthropic.js';
import { LlmError } from './types.js';

const API_KEY = 'sk-ant-test-key-never-logged';
const Verdict = z.strictObject({
  verdict: z.enum(['stimmt', 'falsch']),
  share: z.number().min(0).max(1),
});
const request = {
  task: 'verdict',
  system: 'You judge claims.',
  user: 'Claim: Der Krieg endete 1945.',
  schema: Verdict,
};

describe('anthropic provider', () => {
  let server: FakeServer;
  const provider = () =>
    createAnthropicProvider({
      apiKey: API_KEY,
      model: 'claude-test',
      timeoutMs: 2_000,
      maxRetries: 0,
      baseURL: server.url,
    });

  beforeEach(async () => {
    server = await startFakeServer();
  });
  afterEach(async () => {
    await server.close();
  });

  it('sends system, user, model and the JSON schema and returns the validated value', async () => {
    server.respond(anthropicMessage('{"verdict":"stimmt","share":0.9}'));
    const result = await provider().generateStructured(request);

    expect(result).toEqual({
      value: { verdict: 'stimmt', share: 0.9 },
      usage: { inputTokens: 100, outputTokens: 20 },
      model: 'claude-test',
      provider: 'anthropic',
    });
    const [sent] = server.requests;
    expect(sent?.path).toBe('/v1/messages');
    expect(sent?.headers['x-api-key']).toBe(API_KEY);
    expect(sent?.body).toMatchObject({
      model: 'claude-test',
      system: 'You judge claims.',
      messages: [{ role: 'user', content: 'Claim: Der Krieg endete 1945.' }],
      output_config: { format: { type: 'json_schema' } },
    });
  });

  it('repairs once with the validation errors and sums the usage of both attempts', async () => {
    server.respond(
      anthropicMessage('{"verdict":"stimmt","share":1.7}'),
      anthropicMessage('{"verdict":"stimmt","share":0.7}'),
    );
    const result = await provider().generateStructured(request);

    expect(result.value.share).toBe(0.7);
    expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 40 });
    const repair = server.requests[1]?.body as { messages: { content: string }[] };
    expect(repair.messages[0]?.content).toContain('Your previous answer was rejected');
    expect(repair.messages[0]?.content).toContain('share');
  });

  it('gives up after one repair attempt with invalid_output and the spent tokens', async () => {
    server.respond(anthropicMessage('not json'), anthropicMessage('{"verdict":"wahr","share":0}'));
    const error = await provider()
      .generateStructured(request)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LlmError);
    expect(error).toMatchObject({
      kind: 'invalid_output',
      usage: { inputTokens: 200, outputTokens: 40 },
    });
    expect(server.requests).toHaveLength(2);
  });

  it('treats a truncated answer (max_tokens) like invalid output and repairs', async () => {
    server.respond(
      anthropicMessage('{"verdict":"sti', 'max_tokens'),
      anthropicMessage('{"verdict":"falsch","share":0.1}'),
    );
    expect((await provider().generateStructured(request)).value.verdict).toBe('falsch');
  });

  it('reports a refusal without retrying', async () => {
    server.respond(anthropicMessage('', 'refusal'));
    await expect(provider().generateStructured(request)).rejects.toMatchObject({
      kind: 'refused',
    });
    expect(server.requests).toHaveLength(1);
  });

  it('wraps HTTP errors as provider_error without the API key in the message', async () => {
    server.respond({ status: 500, body: { type: 'error', error: { type: 'api_error' } } });
    const error = await provider()
      .generateStructured(request)
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ kind: 'provider_error' });
    expect((error as Error).message).not.toContain(API_KEY);
  });
});
