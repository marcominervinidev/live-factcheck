import { describe, expect, it } from 'vitest';

import type { LocatedFinding } from './scan.js';
import { summary, toSarif } from './sarif.js';

const meta = {
  model: 'qwen2.5-coder-7b-instruct',
  baseRef: 'origin/main',
  chunks: 3,
  failedChunks: 1,
};
const findings: LocatedFinding[] = [
  {
    file: 'a.ts',
    line: 4,
    severity: 'low',
    cwe: 'CWE-209',
    title: 'Error details',
    explanation: 'Stack trace in response.',
  },
  {
    file: 'b.ts',
    line: 9,
    severity: 'high',
    cwe: 'CWE-918',
    title: 'SSRF',
    explanation: 'Unchecked URL is fetched.',
  },
];

describe('toSarif', () => {
  it('writes SARIF 2.1.0 with one rule per CWE and advisory results', () => {
    const sarif = toSarif(findings, meta);
    expect(sarif.runs[0]?.automationDetails.id).toBe('llm-scan/');
    const [run] = sarif.runs;
    expect(sarif.version).toBe('2.1.0');
    expect(run?.tool.driver.rules.map((rule) => rule.id)).toEqual(['CWE-209', 'CWE-918']);
    expect(run?.tool.driver.rules[1]?.helpUri).toBe(
      'https://cwe.mitre.org/data/definitions/918.html',
    );
    expect(run?.results[1]).toMatchObject({
      ruleId: 'CWE-918',
      level: 'error',
      locations: [
        { physicalLocation: { artifactLocation: { uri: 'b.ts' }, region: { startLine: 9 } } },
      ],
      properties: { 'security-severity': '7.5', advisory: true },
    });
    expect(run?.results[0]?.level).toBe('note');
    expect(run?.properties).toMatchObject({ chunks: 3, failedChunks: 1 });
  });
});

describe('summary', () => {
  it('lists findings by severity', () => {
    const text = summary(findings, meta);
    expect(text).toContain('Chunks: 3 (without a valid answer: 1) · findings: 2');
    expect(text.indexOf('CWE-918')).toBeLessThan(text.indexOf('CWE-209'));
    expect(text).toContain('| high | CWE-918 | b.ts:9 | SSRF |');
  });

  it('says so when there is nothing', () => {
    expect(summary([], { ...meta, failedChunks: 0 })).toContain('No findings.');
  });
});
