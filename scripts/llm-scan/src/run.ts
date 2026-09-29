// `make llm-scan`: local LLM security scan of the diff against the base branch (brief 15.7,
// ADR 0014). Advisory: findings never fail the command; only a broken setup does.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createLlmProvider, describeLlmConfig } from '@lfc/providers';

import { Config } from './config.js';
import { chunksFromDiff } from './diff.js';
import type { LocatedFinding } from './scan.js';
import { scanChunk } from './scan.js';
import { summary, toSarif } from './sarif.js';

const parsed = Config.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid configuration (see scripts/llm-scan/README.md):');
  for (const issue of parsed.error.issues)
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  process.exit(2);
}
const config = parsed.data;

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const diff = execFileSync(
  'git',
  ['diff', '--no-color', '--no-ext-diff', '--unified=8', `${config.LLM_SCAN_BASE_REF}...HEAD`],
  { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
const chunks = chunksFromDiff(diff, config.LLM_SCAN_MAX_CHARS);
const described = describeLlmConfig('SCAN', config);
console.log(
  `Scanning ${String(chunks.length)} chunks against ${config.LLM_SCAN_BASE_REF} with ${described.provider}/${described.model}`,
);

const llm = createLlmProvider('SCAN', config);
const findings: LocatedFinding[] = [];
let failed = 0;
let discarded = 0;
for (const [index, chunk] of chunks.entries()) {
  const result = await scanChunk(llm, chunk);
  findings.push(...result.findings);
  discarded += result.discarded;
  if (result.error !== undefined) failed++;
  console.log(
    `${String(index + 1).padStart(3)}/${String(chunks.length)} ${chunk.file}:${String(chunk.startLine)}-${String(chunk.endLine)} → ${result.error === undefined ? `${String(result.findings.length)} finding(s)` : `no valid answer (${result.error})`}`,
  );
}

const meta = {
  model: described.model,
  baseRef: config.LLM_SCAN_BASE_REF,
  chunks: chunks.length,
  failedChunks: failed,
};
const out = join(root, 'scripts', 'llm-scan', 'reports');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'llm-scan.sarif'), `${JSON.stringify(toSarif(findings, meta), null, 2)}\n`);
const text = summary(findings, meta);
writeFileSync(join(out, 'llm-scan.md'), text);
console.log(`\n${text}`);
if (discarded > 0) {
  console.log(`(${String(discarded)} finding(s) pointed outside the new lines and were dropped)`);
}
console.log(`SARIF: ${join('scripts', 'llm-scan', 'reports', 'llm-scan.sarif')}`);
