import { describe, expect, it } from 'vitest';

import type { BudgetStore } from './budget.js';
import { BudgetExceededError, budgetCostUsd, createDailyBudget } from './budget.js';
import { estimateCostUsd } from './pricing.js';

/** In-memory stand-in for Redis (the system boundary); the service tests use a real Redis. */
function memoryStore() {
  const values = new Map<string, string>();
  const ttls = new Map<string, number>();
  const store: BudgetStore = {
    incrbyfloat: (key, increment) => {
      const next = String(Number(values.get(key) ?? '0') + increment);
      values.set(key, next);
      return Promise.resolve(next);
    },
    expire: (key, seconds) => {
      ttls.set(key, seconds);
      return Promise.resolve(1);
    },
    get: (key) => Promise.resolve(values.get(key) ?? null),
  };
  return { store, values, ttls };
}

describe('daily cloud budget', () => {
  const day = (iso: string) => () => new Date(iso);

  it('allows calls until the limit is reached, per UTC day', async () => {
    const { store, values, ttls } = memoryStore();
    const budget = createDailyBudget(store, 1, day('2026-09-26T23:59:00Z'));
    await budget.ensureAvailable();
    // 120k input tokens of claude-opus-5 = 0.60 USD
    await budget.record('claude-opus-5', { inputTokens: 120_000, outputTokens: 0 });
    await budget.ensureAvailable();
    await budget.record('claude-opus-5', { inputTokens: 100_000, outputTokens: 0 });
    await expect(budget.ensureAvailable()).rejects.toBeInstanceOf(BudgetExceededError);
    expect([...values.keys()]).toEqual(['budget:v1:cloud:2026-09-26']);
    expect(ttls.get('budget:v1:cloud:2026-09-26')).toBe(172_800);

    const nextDay = createDailyBudget(store, 1, day('2026-09-27T00:00:01Z'));
    await expect(nextDay.ensureAvailable()).resolves.toBeUndefined();
  });

  it('charges unknown cloud models at a conservative rate instead of nothing (fails closed)', async () => {
    const { store, values } = memoryStore();
    const budget = createDailyBudget(store, 1, day('2026-09-26T12:00:00Z'));
    await budget.record('claude-sonnet-5-20260915', { inputTokens: 50_000, outputTokens: 5_000 });
    expect(Number(values.get('budget:v1:cloud:2026-09-26'))).toBeCloseTo(1.125, 10);
    await expect(budget.ensureAvailable()).rejects.toBeInstanceOf(BudgetExceededError);
    expect(budgetCostUsd('claude-opus-5', { inputTokens: 1_000_000, outputTokens: 0 })).toBe(5);
  });

  it('ignores calls without tokens', async () => {
    const { store, values } = memoryStore();
    await createDailyBudget(store, 1).record('unknown', { inputTokens: 0, outputTokens: 0 });
    expect(values.size).toBe(0);
  });
});

describe('estimateCostUsd', () => {
  it('prices known models per million tokens and returns null for unknown ones', () => {
    expect(estimateCostUsd('claude-opus-5', { inputTokens: 3_000, outputTokens: 100 })).toBeCloseTo(
      0.0175,
      10,
    );
    expect(estimateCostUsd('jev-1.13.0', { inputTokens: 1_000_000, outputTokens: 50 })).toBeCloseTo(
      0.042,
      10,
    );
    expect(estimateCostUsd('qwen3-8b', { inputTokens: 1, outputTokens: 1 })).toBeNull();
  });
});
