import type { z } from 'zod';

import type { LlmProviderName } from './config.js';

/** Token counts of one or more model calls. */
export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export const NO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0 };

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}

/** A structured request: prompt in, zod-validated object out (brief 8). */
export interface StructuredRequest<T> {
  /** Stable name of the prompt (e.g. `verdict`, `explanation`); used by the mock and in logs. */
  readonly task: string;
  readonly system: string;
  readonly user: string;
  readonly schema: z.ZodType<T>;
  readonly maxTokens?: number;
}

export interface StructuredResult<T> {
  readonly value: T;
  /** Usage of all attempts, including a repair attempt. */
  readonly usage: TokenUsage;
  /** The model id that answered, as configured. */
  readonly model: string;
  readonly provider: LlmProviderName;
}

export type LlmErrorKind =
  /** Output did not satisfy the schema, also after the repair attempt. */
  | 'invalid_output'
  /** The model refused (Anthropic `stop_reason: refusal`). */
  | 'refused'
  /** Network, HTTP, rate limit or timeout errors after the SDK's retries. */
  | 'provider_error';

/** A failed structured request. Callers map it to `nicht_pruefbar` instead of crashing (brief 8). */
export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    /** Tokens already spent, so budgets stay correct even on failure. */
    readonly usage: TokenUsage = NO_USAGE,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'LlmError';
  }
}

export interface LlmProvider {
  readonly name: LlmProviderName;
  readonly model: string;
  generateStructured<T>(
    request: StructuredRequest<T>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<StructuredResult<T>>;
}

/** Deterministic answers of the `mock` provider, supplied by the calling service. */
export type MockLlmHandler = (request: StructuredRequest<unknown>) => unknown;
