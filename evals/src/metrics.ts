import type { ClaimChecked, Verdict } from '@lfc/contracts';
import { VERDICTS } from '@lfc/contracts';

import type { ClaimItem } from './dataset.js';

/** One evaluated item: the label, the pipeline's answer and the latency the client saw. */
export interface Outcome {
  readonly item: ClaimItem;
  /** Absent when no verdict arrived within the timeout. */
  readonly checked?: ClaimChecked;
  /** Submit → claims.checked on the WebSocket, as a user experiences it. */
  readonly clientLatencyMs?: number;
}

/** Truth direction: right is right, overstated and false are wrong, uncheckable is its own class. */
const DIRECTION: Readonly<Record<Verdict, 'wahr' | 'falsch' | 'offen'>> = {
  stimmt: 'wahr',
  groesstenteils_richtig: 'wahr',
  uebertrieben: 'falsch',
  falsch: 'falsch',
  nicht_pruefbar: 'offen',
};

const mean = (values: readonly number[]) =>
  values.length === 0 ? Number.NaN : values.reduce((a, b) => a + b, 0) / values.length;

/** Nearest-rank percentile (p in 0..100) of the values; NaN for none. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] ?? Number.NaN;
}

/** Multi-class Brier score: mean over items of Σ_v (p_v − 1[v = expected])²; 0 is perfect, 2 worst. */
export function brierScore(
  pairs: readonly { probabilities: Readonly<Record<Verdict, number>>; expected: Verdict }[],
): number {
  return mean(
    pairs.map(({ probabilities, expected }) =>
      VERDICTS.reduce((sum, v) => sum + (probabilities[v] - (v === expected ? 1 : 0)) ** 2, 0),
    ),
  );
}

export interface ReliabilityBin {
  readonly from: number;
  readonly to: number;
  readonly count: number;
  /** Mean predicted probability of the chosen verdict in this bin. */
  readonly confidence: number;
  /** Share of correct verdicts in this bin. */
  readonly accuracy: number;
}

/**
 * Reliability bins and expected calibration error over the probability of the top verdict
 * (the most probable class): ECE = Σ (n_b / N) · |accuracy_b − confidence_b|.
 */
export function calibration(
  pairs: readonly { probabilities: Readonly<Record<Verdict, number>>; expected: Verdict }[],
  binCount = 10,
): { ece: number; bins: ReliabilityBin[] } {
  const bins = Array.from({ length: binCount }, (_, i) => ({
    from: i / binCount,
    to: (i + 1) / binCount,
    p: [] as number[],
    hit: [] as number[],
  }));
  for (const { probabilities, expected } of pairs) {
    const [top, p] = (Object.entries(probabilities) as [Verdict, number][]).reduce((best, entry) =>
      entry[1] > best[1] ? entry : best,
    );
    const index = Math.min(binCount - 1, Math.floor(p * binCount));
    bins[index]?.p.push(p);
    bins[index]?.hit.push(top === expected ? 1 : 0);
  }
  const total = pairs.length;
  const result = bins.map((b) => ({
    from: b.from,
    to: b.to,
    count: b.p.length,
    confidence: mean(b.p),
    accuracy: mean(b.hit),
  }));
  const ece =
    total === 0
      ? Number.NaN
      : result.reduce(
          (sum, b) =>
            b.count === 0 ? sum : sum + (b.count / total) * Math.abs(b.accuracy - b.confidence),
          0,
        );
  return { ece, bins: result };
}

export interface Summary {
  readonly items: number;
  readonly answered: number;
  readonly timeouts: number;
  /** Exact verdict matches among answered items. */
  readonly accuracy: number;
  /** Same truth direction (wahr / falsch / offen). */
  readonly directionAccuracy: number;
  /** Share of checkable items (expected ≠ nicht_pruefbar) that got a real verdict. */
  readonly coverage: number;
  readonly brier: number;
  readonly ece: number;
  readonly reliability: ReliabilityBin[];
  readonly byLevel: Readonly<Record<string, { count: number; accuracy: number }>>;
  readonly byCategory: Readonly<Record<string, { count: number; accuracy: number }>>;
  readonly byReason: Readonly<Record<string, number>>;
  /** Pipeline timings (totalMs) and client latency per cache path (brief 9.6). */
  readonly latency: Readonly<
    Record<
      string,
      { count: number; p50: number; p95: number; clientP50: number; clientP95: number }
    >
  >;
  readonly cost: { readonly meanUsd: number; readonly totalUsd: number; readonly unknown: number };
}

const group = <T>(values: readonly T[], key: (value: T) => string) => {
  const groups = new Map<string, T[]>();
  for (const value of values) groups.set(key(value), [...(groups.get(key(value)) ?? []), value]);
  return groups;
};

export function summarize(outcomes: readonly Outcome[]): Summary {
  const answered = outcomes.filter(
    (o): o is Outcome & { checked: ClaimChecked } => o.checked !== undefined,
  );
  const hit = (o: Outcome & { checked: ClaimChecked }) =>
    o.checked.verdict === o.item.expected ? 1 : 0;
  const pairs = answered.map((o) => ({
    probabilities: o.checked.probabilities,
    expected: o.item.expected,
  }));
  const { ece, bins } = calibration(pairs);
  const checkable = answered.filter((o) => o.item.expected !== 'nicht_pruefbar');

  const accuracyBy = (key: (o: Outcome & { checked: ClaimChecked }) => string) =>
    Object.fromEntries(
      [...group(answered, key)].map(([k, list]) => [
        k,
        { count: list.length, accuracy: mean(list.map(hit)) },
      ]),
    );

  const costs = answered.map((o) => o.checked.usage.estimatedCostUsd);
  const known = costs.filter((c): c is number => c !== null);

  return {
    items: outcomes.length,
    answered: answered.length,
    timeouts: outcomes.length - answered.length,
    accuracy: mean(answered.map(hit)),
    directionAccuracy: mean(
      answered.map((o) => (DIRECTION[o.checked.verdict] === DIRECTION[o.item.expected] ? 1 : 0)),
    ),
    coverage: mean(checkable.map((o) => (o.checked.verdict === 'nicht_pruefbar' ? 0 : 1))),
    brier: brierScore(pairs),
    ece,
    reliability: bins,
    byLevel: accuracyBy((o) => o.checked.confidenceLevel),
    byCategory: accuracyBy((o) => o.item.category),
    byReason: Object.fromEntries(
      [
        ...group(
          answered.filter((o) => o.checked.reason !== undefined),
          (o) => o.checked.reason ?? '',
        ),
      ].map(([k, list]) => [k, list.length]),
    ),
    latency: Object.fromEntries(
      [...group(answered, (o) => o.checked.cacheHit)].map(([path, list]) => {
        const pipeline = list.map((o) => o.checked.timings.totalMs);
        const client = list.flatMap((o) =>
          o.clientLatencyMs === undefined ? [] : [o.clientLatencyMs],
        );
        return [
          path,
          {
            count: list.length,
            p50: percentile(pipeline, 50),
            p95: percentile(pipeline, 95),
            clientP50: percentile(client, 50),
            clientP95: percentile(client, 95),
          },
        ];
      }),
    ),
    cost: {
      meanUsd: mean(known),
      totalUsd: known.reduce((a, b) => a + b, 0),
      unknown: costs.length - known.length,
    },
  };
}
