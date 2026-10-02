import { describe, expect, it } from 'vitest';

import type { DetectionItem } from './dataset.js';
import type { DetectionOutcome } from './detection.js';
import { detectionReport, rawOutcomes, summarizeDetection } from './detection.js';

const item = (id: string, expected: boolean): DetectionItem => ({
  id,
  conversationId: 'c',
  speaker: 'A',
  text: 'Satz.',
  expected,
  sourceId: 'test',
  note: 'n',
  reviewed: true,
});

const outcome = (
  id: string,
  expected: boolean,
  detected: boolean,
  latencyMs = 100,
): DetectionOutcome => ({ item: item(id, expected), processed: true, detected, latencyMs });

const inSource = (sourceId: string, o: DetectionOutcome): DetectionOutcome => ({
  ...o,
  item: { ...o.item, sourceId },
});

describe('summarizeDetection', () => {
  it('computes precision, recall and F1 from the confusion matrix', () => {
    const s = summarizeDetection([
      outcome('tp1', true, true),
      outcome('tp2', true, true),
      outcome('tp3', true, true),
      outcome('fn', true, false),
      outcome('fp', false, true),
      outcome('tn1', false, false),
      outcome('tn2', false, false),
    ]);
    expect([s.truePositives, s.falsePositives, s.falseNegatives, s.trueNegatives]).toEqual([
      3, 1, 1, 2,
    ]);
    expect(s.precision).toBeCloseTo(0.75, 10);
    expect(s.recall).toBeCloseTo(0.75, 10);
    expect(s.f1).toBeCloseTo(0.75, 10);
    expect(s.falsePositiveIds).toEqual(['fp']);
    expect(s.falseNegativeIds).toEqual(['fn']);
  });

  it('counts timeouts on their own, never as a correct negative', () => {
    const s = summarizeDetection([
      outcome('tp', true, true),
      { item: item('slow-claim', true), processed: false, detected: false },
      { item: item('slow-talk', false), processed: false, detected: false },
    ]);
    expect(s.timeouts).toBe(2);
    expect(s.timeoutIds).toEqual(['slow-claim', 'slow-talk']);
    expect([s.trueNegatives, s.falseNegatives]).toEqual([0, 0]);
    expect(s.recall).toBe(1);
  });

  it('reports NaN instead of a made-up value when a ratio has no base', () => {
    const s = summarizeDetection([outcome('tn', false, false)]);
    expect(s.precision).toBeNaN();
    expect(s.recall).toBeNaN();
    expect(s.f1).toBeNaN();
  });

  it('takes latency percentiles over handled segments only', () => {
    const s = summarizeDetection([
      outcome('a', false, false, 100),
      outcome('b', false, false, 300),
      { item: item('c', false), processed: false, detected: false },
    ]);
    expect([s.latencyP50, s.latencyP95]).toEqual([100, 300]);
  });
});

describe('detectionReport', () => {
  const meta = {
    label: 'dry',
    startedAt: '2026-09-30T10:00:00.000Z',
    dataset: 'evals/detection.de.jsonl',
    providers: 'claim-extractor/classifier: mock',
  };

  it('marks runs with unreviewed labels as invalid and lists the errors', () => {
    const report = detectionReport({ ...meta, includesUnreviewed: true }, [
      outcome('fp', false, true),
      outcome('tp', true, true),
    ]);
    expect(report).toContain('not a valid result');
    expect(report).toContain('| Precision | 50.0 % |');
    expect(report).toContain('- False positives: fp');
    expect(report).toContain('- Timeouts: –');
  });

  it('shows a dash for undefined metrics', () => {
    const report = detectionReport({ ...meta, includesUnreviewed: false }, [
      outcome('tn', false, false),
    ]);
    expect(report).toContain('owner-reviewed labels only');
    expect(report).toContain('| Recall | – |');
  });

  it('never carries segment text, speaker or note into the report or the raw rows', () => {
    const secret = {
      ...outcome('local-1', true, false),
      item: { ...item('local-1', true), text: 'Wortlaut der Sendung', note: 'Notiz zum Gast' },
    };
    const report = detectionReport({ ...meta, includesUnreviewed: false }, [secret]);
    const raw = JSON.stringify(rawOutcomes([secret]));
    for (const output of [report, raw]) {
      expect(output).not.toContain('Wortlaut der Sendung');
      expect(output).not.toContain('Notiz zum Gast');
    }
    expect(Object.keys(rawOutcomes([secret])[0] ?? {})).toEqual([
      'id',
      'sourceId',
      'expected',
      'processed',
      'detected',
      'latencyMs',
    ]);
  });

  it('adds one row per source, so a gain on one kind of speech cannot hide a loss on another', () => {
    const report = detectionReport({ ...meta, includesUnreviewed: false }, [
      inSource('talk', outcome('t-fp', false, true)),
      inSource('bundestag', outcome('b-tp', true, true)),
      inSource('talk', outcome('t-fn', true, false)),
    ]);
    expect(report).toContain(
      '| `bundestag` | 1 | 100.0 % | 100.0 % | 100.0 % | 1 / 0 | 0 / 0 | 0 |\n| `talk` | 2 | 0.0 % | 0.0 % | – | 0 / 1 | 1 / 0 | 0 |',
    );
  });
});
