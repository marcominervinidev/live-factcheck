// A service whose configuration can select a cloud provider must sit on the egress network,
// or the configured provider is unreachable at runtime (lesson 2026-09-29: the claim-extractor
// was internal-only while its config offered cloud LLMs; nothing failed until a real key).
// Usage: docker compose config --format json | node scripts/ci/check-egress.ts
// The config arrives only on stdin. A file path argument or spawning docker from here brings
// back Sonar's path traversal (tssecurity:S8707) and PATH lookup (S4036) findings.
import { readFileSync } from 'node:fs';

import { object } from './json.ts';

const input = readFileSync(0, 'utf8');
if (input.trim() === '') {
  console.error(
    'no compose config on stdin: docker compose config --format json | node scripts/ci/check-egress.ts',
  );
  process.exit(1);
}
const config = object(JSON.parse(input), 'compose config');
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
