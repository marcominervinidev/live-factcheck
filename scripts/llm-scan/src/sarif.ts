// SARIF 2.1.0 for GitHub code scanning (brief 15.7, ADR 0014). Results are advisory: a local
// model is not deterministic, so they are marked as such and never used as a gate.
import type { LocatedFinding } from './scan.js';

const LEVEL = { high: 'error', medium: 'warning', low: 'note' } as const;
// GitHub orders code-scanning alerts by this CVSS-like score.
const SEVERITY_SCORE = { high: '7.5', medium: '5.0', low: '2.0' } as const;

export interface SarifMeta {
  readonly model: string;
  readonly baseRef: string;
  readonly chunks: number;
  readonly failedChunks: number;
}

export function toSarif(findings: readonly LocatedFinding[], meta: SarifMeta) {
  const cwes = [...new Set(findings.map((finding) => finding.cwe))].sort();
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        // Upload category, so the findings stay apart from CodeQL's.
        automationDetails: { id: 'llm-scan/' },
        tool: {
          driver: {
            name: 'llm-scan',
            informationUri:
              'https://github.com/marcominervinidev/live-factcheck/blob/main/docs/adr/0014-security-scanning-stack.md',
            rules: cwes.map((cwe) => ({
              id: cwe,
              name: cwe,
              shortDescription: { text: `${cwe} (reported by a local language model)` },
              helpUri: `https://cwe.mitre.org/data/definitions/${cwe.slice(4)}.html`,
              properties: { tags: ['security', 'advisory', cwe] },
            })),
          },
        },
        results: findings.map((finding) => ({
          ruleId: finding.cwe,
          level: LEVEL[finding.severity],
          message: { text: `${finding.title}: ${finding.explanation}` },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: finding.file },
                region: { startLine: finding.line },
              },
            },
          ],
          properties: {
            'security-severity': SEVERITY_SCORE[finding.severity],
            advisory: true,
          },
        })),
        properties: {
          model: meta.model,
          baseRef: meta.baseRef,
          chunks: meta.chunks,
          failedChunks: meta.failedChunks,
          note: 'Advisory second opinion from a local model; never a merge gate (ADR 0014).',
        },
      },
    ],
  };
}

/** A short Markdown summary for the terminal and the evidence file. */
export function summary(findings: readonly LocatedFinding[], meta: SarifMeta): string {
  const lines = [
    `# LLM security scan (${meta.model}) against ${meta.baseRef}`,
    '',
    `Chunks: ${String(meta.chunks)} (without a valid answer: ${String(meta.failedChunks)}) · findings: ${String(findings.length)}`,
    '',
  ];
  if (findings.length === 0) return [...lines, 'No findings.', ''].join('\n');
  lines.push('| Severity | CWE | Location | Finding |', '|---|---|---|---|');
  const order = { high: 0, medium: 1, low: 2 } as const;
  for (const finding of [...findings].sort((a, b) => order[a.severity] - order[b.severity])) {
    lines.push(
      `| ${finding.severity} | ${finding.cwe} | ${finding.file}:${String(finding.line)} | ${finding.title} |`,
    );
  }
  return [...lines, ''].join('\n');
}
