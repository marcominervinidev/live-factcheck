import { z } from 'zod';

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
  /** Adds the cost of a finished call (`null` = unknown price: counted as 0, see pricing.ts). */
  record(costUsd: number | null): Promise<void>;
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
    async record(costUsd) {
      if (costUsd === null || costUsd <= 0) return;
      const k = key();
      await store.incrbyfloat(k, costUsd);
      await store.expire(k, TWO_DAYS_S);
    },
  };
}
