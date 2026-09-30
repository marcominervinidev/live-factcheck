import type { DetectionItem } from './dataset.js';
import { percentile } from './metrics.js';

/** One replayed segment: the label and what the claim-extractor did with it. */
export interface DetectionOutcome {
  readonly item: DetectionItem;
  /** False when the extractor did not finish the segment within the timeout. */
  readonly processed: boolean;
  /** A new claim with this segment in `sourceSegmentIds` reached `claims.detected`. */
  readonly detected: boolean;
  /** Publish → segment handled (claim published or dropped). */
  readonly latencyMs?: number;
}

export interface DetectionSummary {
  readonly items: number;
  readonly timeouts: number;
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly trueNegatives: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
  readonly latencyP50: number;
  readonly latencyP95: number;
  /** Ids for the owner's error analysis. */
  readonly falsePositiveIds: readonly string[];
  readonly falseNegativeIds: readonly string[];
  readonly timeoutIds: readonly string[];
}

const ratio = (part: number, whole: number) => (whole === 0 ? Number.NaN : part / whole);

/**
 * Precision, recall and F1 of "the segment became a new claim" (brief 13.5, ADR 0017). A timeout
 * is neither right nor wrong: it is counted on its own, so a slow provider cannot pass as a
 * precise one.
 */
export function summarizeDetection(outcomes: readonly DetectionOutcome[]): DetectionSummary {
  const done = outcomes.filter((o) => o.processed);
  const ids = (keep: (o: DetectionOutcome) => boolean) => done.filter(keep).map((o) => o.item.id);
  const falsePositiveIds = ids((o) => o.detected && !o.item.expected);
  const falseNegativeIds = ids((o) => !o.detected && o.item.expected);
  const truePositives = done.filter((o) => o.detected && o.item.expected).length;
  const trueNegatives = done.filter((o) => !o.detected && !o.item.expected).length;
  const precision = ratio(truePositives, truePositives + falsePositiveIds.length);
  const recall = ratio(truePositives, truePositives + falseNegativeIds.length);
  const latencies = done.flatMap((o) => (o.latencyMs === undefined ? [] : [o.latencyMs]));
  return {
    items: outcomes.length,
    timeouts: outcomes.length - done.length,
    truePositives,
    falsePositives: falsePositiveIds.length,
    falseNegatives: falseNegativeIds.length,
    trueNegatives,
    precision,
    recall,
    f1: ratio(2 * precision * recall, precision + recall),
    latencyP50: percentile(latencies, 50),
    latencyP95: percentile(latencies, 95),
    falsePositiveIds,
    falseNegativeIds,
    timeoutIds: outcomes.filter((o) => !o.processed).map((o) => o.item.id),
  };
}

export interface DetectionReportMeta {
  readonly label: string;
  readonly startedAt: string;
  readonly dataset: string;
  readonly includesUnreviewed: boolean;
  readonly providers: string;
}

const pct = (value: number) => (Number.isNaN(value) ? '–' : `${(value * 100).toFixed(1)} %`);
const ms = (value: number) => (Number.isNaN(value) ? '–' : `${String(Math.round(value))} ms`);
const list = (ids: readonly string[]) => (ids.length === 0 ? '–' : ids.join(', '));

/** The detection eval report as Markdown. */
export function detectionReport(meta: DetectionReportMeta, s: DetectionSummary): string {
  return `# Detection eval report: ${meta.label}

- Run: ${meta.startedAt}
- Dataset: \`${meta.dataset}\`, ${String(s.items)} segments${meta.includesUnreviewed ? ' **including labels not yet reviewed by the owner (not a valid result, brief 13.5)**' : ' (owner-reviewed labels only)'}
- Providers: ${meta.providers}

## Result

| Metric | Value |
|---|---|
| Precision | ${pct(s.precision)} |
| Recall | ${pct(s.recall)} |
| F1 | ${pct(s.f1)} |
| True / false positives | ${String(s.truePositives)} / ${String(s.falsePositives)} |
| False / true negatives | ${String(s.falseNegatives)} / ${String(s.trueNegatives)} |
| Timeouts (not counted above) | ${String(s.timeouts)} |
| Latency p50 / p95 (publish → handled) | ${ms(s.latencyP50)} / ${ms(s.latencyP95)} |

## Errors

- False positives: ${list(s.falsePositiveIds)}
- False negatives: ${list(s.falseNegativeIds)}
- Timeouts: ${list(s.timeoutIds)}
`;
}
