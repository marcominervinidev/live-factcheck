import OpenAI from 'openai';
import { z } from 'zod';

import { isLocalEndpoint } from '../privacy.js';
import type { ExternalUse } from '../privacy.js';

/** Embedding providers (brief 9.2, ADR 0012): local OpenAI-compatible endpoint or deterministic mock. */
export const EMBEDDING_PROVIDERS = ['openai-compatible', 'mock'] as const;
export type EmbeddingProviderName = (typeof EMBEDDING_PROVIDERS)[number];

export const embeddingsConfigShape = {
  EMBEDDINGS_PROVIDER: z.enum(EMBEDDING_PROVIDERS),
  EMBEDDINGS_BASE_URL: z.url({ protocol: /^https?$/ }).optional(),
  EMBEDDINGS_MODEL: z.string().min(1),
  /** Only for a cloud endpoint; LM Studio and Ollama need none. Secret. */
  EMBEDDINGS_API_KEY: z.string().min(1).optional(),
  /** Some models need prefixes, e.g. multilingual-e5: `query: ` and `passage: ` (ADR 0012). */
  EMBEDDINGS_QUERY_PREFIX: z.string().optional(),
  EMBEDDINGS_PASSAGE_PREFIX: z.string().optional(),
  EMBEDDINGS_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
};

type EmbeddingsConfig = z.infer<z.ZodObject<typeof embeddingsConfigShape>>;

export function checkEmbeddingsConfig(config: EmbeddingsConfig, ctx: z.RefinementCtx): void {
  if (
    config.EMBEDDINGS_PROVIDER === 'openai-compatible' &&
    config.EMBEDDINGS_BASE_URL === undefined
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['EMBEDDINGS_BASE_URL'],
      message: 'required when EMBEDDINGS_PROVIDER=openai-compatible',
    });
  }
}

export function embeddingsUse(config: EmbeddingsConfig): ExternalUse {
  const setting = `EMBEDDINGS_PROVIDER=${config.EMBEDDINGS_PROVIDER}`;
  if (config.EMBEDDINGS_PROVIDER === 'mock') return { setting, cloud: false };
  const url = config.EMBEDDINGS_BASE_URL;
  return { setting, cloud: url === undefined || !isLocalEndpoint(url) };
}

export function describeEmbeddingsConfig(config: EmbeddingsConfig) {
  return {
    provider: config.EMBEDDINGS_PROVIDER,
    model: config.EMBEDDINGS_MODEL,
    ...(config.EMBEDDINGS_BASE_URL === undefined
      ? {}
      : { baseUrl: new URL(config.EMBEDDINGS_BASE_URL).origin }),
  };
}

export interface EmbeddingProvider {
  readonly name: EmbeddingProviderName;
  readonly model: string;
  /** One vector per text, all of the same dimension, L2-normalised. */
  embedQuery(text: string, options?: { readonly signal?: AbortSignal }): Promise<number[]>;
  embedPassages(
    texts: readonly string[],
    options?: { readonly signal?: AbortSignal },
  ): Promise<number[][]>;
}

export class EmbeddingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EmbeddingError';
  }
}

function l2normalize(vector: readonly number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
  return norm === 0 ? [...vector] : vector.map((x) => x / norm);
}

/** Cosine similarity of two vectors of equal length (−1..1). */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new EmbeddingError(
      `vector dimensions differ: ${String(a.length)} vs ${String(b.length)}`,
    );
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

function createOpenAiCompatibleEmbeddings(
  config: EmbeddingsConfig & { EMBEDDINGS_BASE_URL: string },
): EmbeddingProvider {
  const client = new OpenAI({
    baseURL: config.EMBEDDINGS_BASE_URL,
    apiKey: config.EMBEDDINGS_API_KEY ?? 'not-needed',
    timeout: config.EMBEDDINGS_TIMEOUT_MS,
    maxRetries: 1,
  });
  const embed = async (texts: readonly string[], signal?: AbortSignal) => {
    if (texts.length === 0) return [];
    let response: OpenAI.CreateEmbeddingResponse;
    try {
      response = await client.embeddings.create(
        { model: config.EMBEDDINGS_MODEL, input: [...texts] },
        signal === undefined ? {} : { signal },
      );
    } catch (error) {
      throw new EmbeddingError('embeddings request failed', { cause: error });
    }
    const vectors = [...response.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    const dimension = vectors[0]?.length ?? 0;
    if (
      vectors.length !== texts.length ||
      dimension === 0 ||
      vectors.some((v) => v.length !== dimension)
    ) {
      throw new EmbeddingError('embeddings response does not match the input');
    }
    return vectors.map(l2normalize);
  };
  const query = config.EMBEDDINGS_QUERY_PREFIX ?? '';
  const passage = config.EMBEDDINGS_PASSAGE_PREFIX ?? '';
  return {
    name: 'openai-compatible',
    model: config.EMBEDDINGS_MODEL,
    async embedQuery(text, options) {
      const [vector] = await embed([`${query}${text}`], options?.signal);
      if (vector === undefined) throw new EmbeddingError('no vector returned');
      return vector;
    },
    embedPassages: (texts, options) =>
      embed(
        texts.map((t) => `${passage}${t}`),
        options?.signal,
      ),
  };
}

const MOCK_DIMENSIONS = 256;

/** FNV-1a, 32 bit: a stable hash for the mock's bag of words. */
function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * Deterministic hashed bag-of-words vectors: texts sharing words are close, so ranking tests
 * behave sensibly without a model (brief 13.1).
 */
export function mockEmbedding(text: string): number[] {
  const vector = new Array<number>(MOCK_DIMENSIONS).fill(0);
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    const hash = fnv1a(word);
    vector[hash % MOCK_DIMENSIONS] = (vector[hash % MOCK_DIMENSIONS] ?? 0) + (hash & 1 ? 1 : -1);
  }
  return l2normalize(vector);
}

export function createEmbeddingProvider(config: EmbeddingsConfig): EmbeddingProvider {
  if (config.EMBEDDINGS_PROVIDER === 'mock') {
    return {
      name: 'mock',
      model: config.EMBEDDINGS_MODEL,
      embedQuery: (text) => Promise.resolve(mockEmbedding(text)),
      embedPassages: (texts) => Promise.resolve(texts.map(mockEmbedding)),
    };
  }
  const baseUrl = config.EMBEDDINGS_BASE_URL;
  if (baseUrl === undefined) {
    // Unreachable after checkEmbeddingsConfig.
    throw new Error('EMBEDDINGS_BASE_URL is required for openai-compatible');
  }
  return createOpenAiCompatibleEmbeddings({ ...config, EMBEDDINGS_BASE_URL: baseUrl });
}
