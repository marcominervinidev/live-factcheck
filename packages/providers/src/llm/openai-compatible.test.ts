import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { FakeServer } from '../testing/fake-server.js';
import { chatCompletion, startFakeServer } from '../testing/fake-server.js';
import { createOpenAiCompatibleProvider } from './openai-compatible.js';

const Explanation = z.strictObject({ explanation: z.string().min(1) });
const request = {
  task: 'explanation',
  system: 'Explain the verdict in German.',
  user: 'Verdict: falsch',
  schema: Explanation,
};

describe('openai-compatible provider (LM Studio, Ollama)', () => {
  let server: FakeServer;
  const provider = (apiKey?: string) =>
    createOpenAiCompatibleProvider({
      baseURL: `${server.url}/v1`,
      ...(apiKey === undefined ? {} : { apiKey }),
      model: 'qwen3-8b',
      timeoutMs: 2_000,
      maxRetries: 0,
    });

  beforeEach(async () => {
    server = await startFakeServer();
  });
  afterEach(async () => {
    await server.close();
  });

  it('asks for json_schema output and validates the answer', async () => {
    server.respond(chatCompletion('{"explanation":"Der Krieg endete 1945."}'));
    const result = await provider().generateStructured(request);

    expect(result).toEqual({
      value: { explanation: 'Der Krieg endete 1945.' },
      usage: { inputTokens: 80, outputTokens: 15 },
      model: 'qwen3-8b',
      provider: 'openai-compatible',
    });
    const [sent] = server.requests;
    expect(sent?.path).toBe('/v1/chat/completions');
    expect(sent?.body).toMatchObject({
      model: 'qwen3-8b',
      messages: [
        { role: 'system', content: 'Explain the verdict in German.' },
        { role: 'user', content: 'Verdict: falsch' },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'explanation', schema: { type: 'object' } },
      },
    });
  });

  it('sends a placeholder instead of a real key when none is configured', async () => {
    server.respond(chatCompletion('{"explanation":"ok"}'));
    await provider().generateStructured(request);
    expect(server.requests[0]?.headers.authorization).toBe('Bearer not-needed');
  });

  it('repairs once when a local model wraps the JSON in prose', async () => {
    server.respond(
      chatCompletion('Sure! Here is the JSON: {"explanation":"x"}'),
      chatCompletion('{"explanation":"Der Krieg endete 1945."}'),
    );
    const result = await provider().generateStructured(request);
    expect(result.value.explanation).toBe('Der Krieg endete 1945.');
    expect(result.usage).toEqual({ inputTokens: 160, outputTokens: 30 });
  });

  it('treats finish_reason length and empty content as invalid output', async () => {
    server.respond(chatCompletion('{"expl', 'length'), chatCompletion(null));
    await expect(provider().generateStructured(request)).rejects.toMatchObject({
      kind: 'invalid_output',
    });
  });

  it('reports an unreachable server as provider_error', async () => {
    const baseURL = `${server.url}/v1`;
    await server.close();
    const offline = createOpenAiCompatibleProvider({
      baseURL,
      model: 'm',
      timeoutMs: 500,
      maxRetries: 0,
    });
    await expect(offline.generateStructured(request)).rejects.toMatchObject({
      kind: 'provider_error',
    });
    server = await startFakeServer();
  });
});
