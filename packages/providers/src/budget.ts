import { z } from 'zod';

import type { TokenUsage } from './llm/types.js';
import { estimateCostUsd } from './pricing.js';

/**
 * USD per million tokens for cloud models missing from the price table: above every known
 * price, so an unknown model can only make the budget stricter, never looser.
 */
const FALLBACK_PRICE = { input: 15, output: 75 };

/** The cost counted against the budget: the known price, else the conservative fallback. */
export function budgetCostUsd(model: string, usage: TokenUsage): number {
  return (
    estimateCostUsd(model, usage) ??
    (usage.inputTokens * FALLBACK_PRICE.input + usage.outputTokens * FALLBACK_PRICE.output) /
      1_000_000
  );
}

/**
 * Daily budget for cloud model calls (brief 15.5): a mistake or abuse must not produce a big
 * bill. Spend is counted in Redis per UTC day and shared by all replicas.
 */
export const budgetConfigShape = {
  CLOUD_DAILY_BUDGET_USD: z.coerce.number().positive().default(2),
};

/** The Redis commands the budget needs; an ioredis client fits this shape. */
export interface BudgetStore {
  incrbyfloat(key: string, increment: number): Promise<string>;
  expire(key: string, seconds: number): Promise<number>;
  get(key: string): Promise<string | null>;
}

export class BudgetExceededError extends Error {
  constructor(
    readonly spentUsd: number,
    readonly limitUsd: number,
  ) {
    super('daily cloud budget exceeded');
    this.name = 'BudgetExceededError';
  }
}

const TWO_DAYS_S = 2 * 24 * 60 * 60;

export interface DailyBudget {
  /** Throws `BudgetExceededError` when today's spend has reached the limit. Call before a cloud call. */
  ensureAvailable(): Promise<void>;
  /**
   * Adds the cost of a finished cloud call. A model without a known price is charged at a
   * conservative fallback rate, so the budget fails closed (security review finding 3).
   */
  record(model: string, usage: TokenUsage): Promise<void>;
}

export function createDailyBudget(
  store: BudgetStore,
  limitUsd: number,
  now: () => Date = () => new Date(),
): DailyBudget {
  const key = () => `budget:v1:cloud:${now().toISOString().slice(0, 10)}`;
  return {
    async ensureAvailable() {
      const spent = Number((await store.get(key())) ?? '0');
      if (spent >= limitUsd) {
        throw new BudgetExceededError(spent, limitUsd);
      }
    },
    async record(model, usage) {
      const costUsd = budgetCostUsd(model, usage);
      if (costUsd <= 0) return;
      const k = key();
      await store.incrbyfloat(k, costUsd);
      await store.expire(k, TWO_DAYS_S);
    },
  };
}
