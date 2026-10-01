// A service whose configuration can select a cloud provider must sit on the egress network,
// or the configured provider is unreachable at runtime (lesson 2026-09-29: the claim-extractor
// was internal-only while its config offered cloud LLMs; nothing failed until a real key).
// Reads `docker compose config` (or a pre-rendered JSON passed as the first argument).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { object } from './json.ts';

const rendered = process.argv[2];
const output =
  rendered !== undefined
    ? readFileSync(rendered, 'utf8')
    : execFileSync('docker', ['compose', 'config', '--format', 'json'], {
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      });
const config = object(JSON.parse(output), 'compose config');
const services = object(config['services'], 'services');

function names(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'object' && value !== null) return Object.keys(value);
  return [];
}

const problems: string[] = [];
for (const [name, entry] of Object.entries(services)) {
  const service = object(entry, name);
  const environmentKeys = names(service['environment']).map((key) => key.split('=')[0] ?? '');
  if (!environmentKeys.some((key) => key.endsWith('_PROVIDER'))) continue;
  if (!names(service['networks']).includes('egress'))
    problems.push(`${name}: offers *_PROVIDER configuration but is not on the egress network`);
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`egress check ok (${String(Object.keys(services).length)} services)`);
