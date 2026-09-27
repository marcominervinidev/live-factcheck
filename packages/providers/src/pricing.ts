import type { TokenUsage } from './llm/types.js';

/**
 * USD per million tokens, first-party APIs, as of 2026-09-26 (`.ai/research/llm-providers.md`,
 * `.ai/research/classifier-jev.md`). Only used for the eval's cost column and the daily budget;
 * an unknown model has no price rather than a guessed one.
 */
const PRICES: Readonly<Record<string, { readonly input: number; readonly output: number }>> = {
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-opus-5': { input: 5, output: 25 },
  'jev-1.13.0': { input: 0.042, output: 0 },
};

/** Estimated cost in USD, or `null` when the model's price is unknown (brief 13.5, ADR 0010). */
export function estimateCostUsd(model: string, usage: TokenUsage): number | null {
  const price = PRICES[model];
  if (price === undefined) {
    return null;
  }
  return (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
}
