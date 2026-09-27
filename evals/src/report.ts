import type { ReliabilityBin, Summary } from './metrics.js';

const pct = (value: number) => (Number.isNaN(value) ? '–' : `${(value * 100).toFixed(1)} %`);
const num = (value: number, digits = 3) => (Number.isNaN(value) ? '–' : value.toFixed(digits));
const ms = (value: number) => (Number.isNaN(value) ? '–' : `${String(Math.round(value))} ms`);
const usd = (value: number) => (Number.isNaN(value) ? '–' : `$${value.toFixed(4)}`);

/** Reliability diagram: bars = accuracy per confidence bin, diagonal = perfect calibration. */
export function reliabilitySvg(bins: readonly ReliabilityBin[]): string {
  const size = 320;
  const pad = 40;
  const plot = size - 2 * pad;
  const f = (value: number) => value.toFixed(1);
  const x = (v: number) => f(pad + v * plot);
  const y = (v: number) => f(size - pad - v * plot);
  const bars = bins
    .filter((b) => b.count > 0)
    .map(
      (b) =>
        `<rect x="${f(pad + b.from * plot + 1)}" y="${y(b.accuracy)}" width="${f((b.to - b.from) * plot - 2)}" height="${f(b.accuracy * plot)}" fill="#475569"><title>${String(b.count)} claims, confidence ${num(b.confidence, 2)}, accuracy ${num(b.accuracy, 2)}</title></rect>`,
    )
    .join('');
  const ticks = [0, 0.5, 1]
    .map(
      (t) =>
        `<text x="${x(t)}" y="${f(size - pad + 16)}" text-anchor="middle">${String(t)}</text><text x="${f(pad - 8)}" y="${f(size - pad - t * plot + 4)}" text-anchor="end">${String(t)}</text>`,
    )
    .join('');
  const s = String(size);
  const half = f(size / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" font-family="sans-serif" font-size="11" role="img" aria-label="Reliability diagram">
<rect width="${s}" height="${s}" fill="#fff"/>
<line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}" stroke="#94a3b8" stroke-dasharray="4 3"/>
${bars}
<line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(0)}" stroke="#0f172a"/>
<line x1="${x(0)}" y1="${y(0)}" x2="${x(0)}" y2="${y(1)}" stroke="#0f172a"/>
${ticks}
<text x="${half}" y="${f(size - 6)}" text-anchor="middle">confidence (probability of the chosen verdict)</text>
<text x="12" y="${half}" text-anchor="middle" transform="rotate(-90 12 ${half})">accuracy</text>
</svg>
`;
}

export interface ReportMeta {
  readonly label: string;
  readonly startedAt: string;
  readonly dataset: string;
  readonly includesUnreviewed: boolean;
  readonly providers: string;
  readonly svgFile: string;
}

const table = (rows: Readonly<Record<string, { count: number; accuracy: number }>>) =>
  Object.entries(rows)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, row]) => `| ${key} | ${String(row.count)} | ${pct(row.accuracy)} |`)
    .join('\n');

/** The eval report as Markdown (brief 13.5): accuracy, calibration, latency per path, cost. */
export function markdownReport(meta: ReportMeta, s: Summary): string {
  const latency = Object.entries(s.latency)
    .map(
      ([path, l]) =>
        `| ${path} | ${String(l.count)} | ${ms(l.p50)} | ${ms(l.p95)} | ${ms(l.clientP50)} | ${ms(l.clientP95)} |`,
    )
    .join('\n');
  const reasons =
    Object.entries(s.byReason)
      .map(([reason, count]) => `${reason}: ${String(count)}`)
      .join(', ') || '–';
  return `# Eval report: ${meta.label}

- Run: ${meta.startedAt}
- Dataset: \`${meta.dataset}\`, ${String(s.items)} claims${meta.includesUnreviewed ? ' **including labels not yet reviewed by the owner (not a valid result, brief 13.5)**' : ' (owner-reviewed labels only)'}
- Providers: ${meta.providers}

## Result

| Metric | Value |
|---|---|
| Answered / timeouts | ${String(s.answered)} / ${String(s.timeouts)} |
| Accuracy (exact verdict) | ${pct(s.accuracy)} |
| Direction accuracy (wahr / falsch / offen) | ${pct(s.directionAccuracy)} |
| Coverage (checkable claims with a real verdict) | ${pct(s.coverage)} |
| Brier score (0 perfect, 2 worst) | ${num(s.brier)} |
| Expected calibration error | ${num(s.ece)} |
| Cost per claim / total | ${usd(s.cost.meanUsd)} / ${usd(s.cost.totalUsd)}${s.cost.unknown > 0 ? ` (${String(s.cost.unknown)} with unknown price)` : ''} |
| nicht_pruefbar reasons | ${reasons} |

![Reliability diagram](${meta.svgFile})

## Accuracy by confidence level

| Level | Claims | Accuracy |
|---|---|---|
${table(s.byLevel)}

## Accuracy by category

| Category | Claims | Accuracy |
|---|---|---|
${table(s.byCategory)}

## Latency per path (brief 9.6)

| Path | Claims | Pipeline p50 | Pipeline p95 | Client p50 | Client p95 |
|---|---|---|---|---|---|
${latency}
`;
}
