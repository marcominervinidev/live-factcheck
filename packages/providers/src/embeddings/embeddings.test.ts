import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { FakeServer } from '../testing/fake-server.js';
import { startFakeServer } from '../testing/fake-server.js';
import {
  checkEmbeddingsConfig,
  cosineSimilarity,
  createEmbeddingProvider,
  embeddingsConfigShape,
  embeddingsUse,
  mockEmbedding,
} from './embeddings.js';

const schema = z.object(embeddingsConfigShape).superRefine(checkEmbeddingsConfig);

describe('embeddings config', () => {
  it('requires a base URL for openai-compatible and counts only local endpoints as local', () => {
    expect(
      schema.safeParse({ EMBEDDINGS_PROVIDER: 'openai-compatible', EMBEDDINGS_MODEL: 'bge-m3' })
        .success,
    ).toBe(false);
    const local = schema.parse({
      EMBEDDINGS_PROVIDER: 'openai-compatible',
      EMBEDDINGS_MODEL: 'bge-m3',
      EMBEDDINGS_BASE_URL: 'http://host.docker.internal:11434/v1',
    });
    expect(embeddingsUse(local).cloud).toBe(false);
    expect(
      embeddingsUse({ ...local, EMBEDDINGS_BASE_URL: 'https://api.example.com/v1' }).cloud,
    ).toBe(true);
  });
});

describe('mock embeddings', () => {
  it('are deterministic, normalised and closer for texts that share words', () => {
    const claim = mockEmbedding('Der Zweite Weltkrieg endete 1945');
    expect(mockEmbedding('Der Zweite Weltkrieg endete 1945')).toEqual(claim);
    expect(cosineSimilarity(claim, claim)).toBeCloseTo(1, 6);
    const related = cosineSimilarity(
      claim,
      mockEmbedding('Der Zweite Weltkrieg endete im Jahr 1945 in Europa'),
    );
    const unrelated = cosineSimilarity(claim, mockEmbedding('Berlin hat 3,9 Millionen Einwohner'));
    expect(related).toBeGreaterThan(unrelated);
  });
});

describe('cosineSimilarity', () => {
  it('rejects vectors of different dimensions', () => {
    expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow('dimensions differ');
  });
});

describe('openai-compatible embeddings (LM Studio, Ollama)', () => {
  let server: FakeServer;
  beforeEach(async () => {
    server = await startFakeServer();
  });
  afterEach(async () => {
    await server.close();
  });

  const provider = (prefixes = {}) =>
    createEmbeddingProvider(
      schema.parse({
        EMBEDDINGS_PROVIDER: 'openai-compatible',
        EMBEDDINGS_MODEL: 'multilingual-e5-large',
        EMBEDDINGS_BASE_URL: `${server.url}/v1`,
        ...prefixes,
      }),
    );

  it('applies the query and passage prefixes and restores the input order', async () => {
    server.respond(
      {
        body: {
          object: 'list',
          data: [{ object: 'embedding', index: 0, embedding: [3, 4] }],
          model: 'm',
        },
      },
      {
        body: {
          object: 'list',
          data: [
            { object: 'embedding', index: 1, embedding: [0, 2] },
            { object: 'embedding', index: 0, embedding: [2, 0] },
          ],
          model: 'm',
        },
      },
    );
    const p = provider({
      EMBEDDINGS_QUERY_PREFIX: 'query: ',
      EMBEDDINGS_PASSAGE_PREFIX: 'passage: ',
    });

    expect(await p.embedQuery('Krieg')).toEqual([0.6, 0.8]);
    expect(await p.embedPassages(['a', 'b'])).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(server.requests[0]?.body).toMatchObject({
      model: 'multilingual-e5-large',
      input: ['query: Krieg'],
    });
    expect(server.requests[1]?.body).toMatchObject({ input: ['passage: a', 'passage: b'] });
  });

  it('rejects a response with the wrong number of vectors or mixed dimensions', async () => {
    server.respond({
      body: {
        object: 'list',
        data: [
          { object: 'embedding', index: 0, embedding: [1, 0] },
          { object: 'embedding', index: 1, embedding: [1, 0, 0] },
        ],
        model: 'm',
      },
    });
    await expect(provider().embedPassages(['a', 'b'])).rejects.toThrow('does not match the input');
  });

  it('sends no request for an empty batch', async () => {
    expect(await provider().embedPassages([])).toEqual([]);
    expect(server.requests).toHaveLength(0);
  });
});
