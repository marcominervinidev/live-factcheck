import type { ClaimChecked, Verdict } from '@lfc/contracts';
import { describe, expect, it } from 'vitest';

import type { ClaimItem } from './dataset.js';
import { brierScore, calibration, percentile, summarize } from './metrics.js';
import { markdownReport, reliabilitySvg } from './report.js';

const dist = (verdict: Verdict, p: number): Record<Verdict, number> => {
  const rest = (1 - p) / 4;
  return {
    stimmt: rest,
    groesstenteils_richtig: rest,
    uebertrieben: rest,
    falsch: rest,
    nicht_pruefbar: rest,
    [verdict]: p,
  };
};

const item = (
  id: string,
  expected: Verdict,
  category: ClaimItem['category'] = 'datum',
): ClaimItem => ({
  id,
  claim: `Behauptung ${id}`,
  expected,
  category,
  sourceId: 'test',
  note: 'test',
  reviewed: true,
});

const checked = (verdict: Verdict, p: number, extra: Partial<ClaimChecked> = {}): ClaimChecked => ({
  schemaVersion: 2,
  sessionId: '6f1c1e9a-3b1f-4c55-9a53-2f4a9c1d7e10',
  claimId: '0e9d8c7b-6a5f-4e3d-8c1b-0a9f8e7d6c5b',
  speaker: 'A',
  claim: 'x',
  verdict,
  probabilities: dist(verdict, p),
  confidence: p,
  confidenceLevel: p >= 0.75 ? 'hoch' : 'mittel',
  evidence: [],
  cacheHit: 'none',
  timings: { detectMs: 0, retrieveMs: 100, classifyMs: 100, totalMs: 1_000 },
  checkedAt: '2026-09-27T10:00:00.000Z',
  provider: { classifier: 'llm', model: 'm', search: 's', embeddings: 'e' },
  usage: { inputTokens: 1_000, outputTokens: 100, estimatedCostUsd: 0.01 },
  ...extra,
});

describe('percentile', () => {
  it('uses the nearest rank', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([], 50)).toBeNaN();
  });
});

describe('brierScore', () => {
  it('is 0 for certain correct answers and 2 for certain wrong ones', () => {
    expect(brierScore([{ probabilities: dist('falsch', 1), expected: 'falsch' }])).toBeCloseTo(
      0,
      10,
    );
    expect(brierScore([{ probabilities: dist('stimmt', 1), expected: 'falsch' }])).toBeCloseTo(
      2,
      10,
    );
  });

  it('matches a hand calculation (0.8 on the right verdict, 0.05 elsewhere)', () => {
    // (0.8 − 1)² + 4 · 0.05² = 0.04 + 0.01 = 0.05
    expect(brierScore([{ probabilities: dist('falsch', 0.8), expected: 'falsch' }])).toBeCloseTo(
      0.05,
      10,
    );
  });
});

describe('calibration', () => {
  it('is perfectly calibrated when accuracy equals confidence per bin', () => {
    // Four answers at 0.75: three right, one wrong → accuracy 0.75 in the 0.7–0.8 bin.
    const pairs = [
      { probabilities: dist('falsch', 0.75), expected: 'falsch' as const },
      { probabilities: dist('falsch', 0.75), expected: 'falsch' as const },
      { probabilities: dist('falsch', 0.75), expected: 'falsch' as const },
      { probabilities: dist('falsch', 0.75), expected: 'stimmt' as const },
    ];
    const { ece, bins } = calibration(pairs);
    expect(ece).toBeCloseTo(0, 10);
    expect(bins[7]).toMatchObject({ count: 4, confidence: 0.75, accuracy: 0.75 });
  });

  it('measures overconfidence', () => {
    // Always 0.95 sure, right half the time → ECE 0.45.
    const pairs = [
      { probabilities: dist('stimmt', 0.95), expected: 'stimmt' as const },
      { probabilities: dist('stimmt', 0.95), expected: 'falsch' as const },
    ];
    expect(calibration(pairs).ece).toBeCloseTo(0.45, 10);
  });

  it('refuses an empty distribution instead of guessing a verdict', () => {
    const pairs = [{ probabilities: {} as ReturnType<typeof dist>, expected: 'stimmt' as const }];
    expect(() => calibration(pairs)).toThrow('calibration needs a probability per verdict');
  });
});

describe('summarize', () => {
  const outcomes = [
    { item: item('a', 'falsch', 'zahl'), checked: checked('falsch', 0.9), clientLatencyMs: 2_000 },
    { item: item('b', 'uebertrieben'), checked: checked('falsch', 0.6), clientLatencyMs: 3_000 },
    {
      item: item('c', 'stimmt'),
      checked: checked('nicht_pruefbar', 0.3, {
        reason: 'low_confidence',
        confidenceLevel: 'niedrig',
      }),
      clientLatencyMs: 2_500,
    },
    {
      item: item('d', 'nicht_pruefbar', 'meinung'),
      checked: checked('nicht_pruefbar', 0.9, {
        reason: 'classified_unverifiable',
        cacheHit: 'verdict_exact',
        usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: null },
      }),
      clientLatencyMs: 300,
    },
    { item: item('e', 'stimmt') },
  ];

  it('counts accuracy, direction, coverage, timeouts, reasons and cost', () => {
    const s = summarize(outcomes);
    expect(s).toMatchObject({
      items: 5,
      answered: 4,
      timeouts: 1,
      accuracy: 0.5,
      directionAccuracy: 0.75,
    });
    // Checkable: a, b, c → c got no verdict.
    expect(s.coverage).toBeCloseTo(2 / 3, 10);
    expect(s.byReason).toEqual({ low_confidence: 1, classified_unverifiable: 1 });
    expect(s.byCategory['zahl']).toEqual({ count: 1, accuracy: 1 });
    expect(s.cost).toEqual({
      meanUsd: 0.01,
      totalUsd: expect.closeTo(0.03, 10) as number,
      unknown: 1,
    });
    expect(s.latency['verdict_exact']).toMatchObject({ count: 1, clientP50: 300 });
    expect(s.latency['none']).toMatchObject({ count: 3, p50: 1_000, clientP95: 3_000 });
  });

  it('renders a report and a reliability diagram', () => {
    const s = summarize(outcomes);
    const svg = reliabilitySvg(s.reliability);
    expect(svg).toMatch(/^<svg[\s\S]*<rect[\s\S]*<\/svg>\n$/);
    const md = markdownReport(
      {
        label: 'test',
        startedAt: '2026-09-27T10:00:00.000Z',
        dataset: 'evals/claims.de.jsonl',
        includesUnreviewed: true,
        providers: 'mock',
        svgFile: 'x.svg',
      },
      s,
    );
    expect(md).toContain('| Accuracy (exact verdict) | 50.0 % |');
    expect(md).toContain('not a valid result');
    expect(md).toContain('| verdict_exact | 1 |');
  });

  it('leaves placeholder distributions of stopped checks out of the calibration', () => {
    const stopped = {
      item: item('f', 'stimmt'),
      checked: checked('nicht_pruefbar', 0, { reason: 'budget_exceeded' }),
    };
    const withStopped = summarize([...outcomes, stopped]);
    const without = summarize(outcomes);
    expect(withStopped.brier).toBeCloseTo(without.brier, 10);
    expect(withStopped.ece).toBeCloseTo(without.ece, 10);
    expect(withStopped.answered).toBe(without.answered + 1);
  });

  it('renders an empty run with dashes instead of NaN, marked as reviewed-only', () => {
    const s = summarize([{ item: item('x', 'stimmt') }]);
    const md = markdownReport(
      {
        label: 'empty',
        startedAt: '2026-09-27T10:00:00.000Z',
        dataset: 'evals/claims.de.jsonl',
        includesUnreviewed: false,
        providers: 'mock',
        svgFile: 'x.svg',
      },
      s,
    );
    expect(md).not.toContain('NaN');
    expect(md).toContain('| Accuracy (exact verdict) | – |');
    expect(md).toContain('| nicht_pruefbar reasons | – |');
    expect(md).toContain('(owner-reviewed labels only)');
    expect(md).not.toContain('unknown price');
    expect(reliabilitySvg(s.reliability)).not.toContain('<title>');
  });
});
