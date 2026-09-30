import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The committed repo config, found by walking up from this file. A fixed `../../..` would break
 * in Stryker's sandbox (`.stryker-tmp/sandbox-*`), where the package sits two levels deeper.
 */
export function readRepoSourceTiers(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    const candidate = join(dir, 'config', 'source-tiers.yaml');
    try {
      return readFileSync(candidate, 'utf8');
    } catch {
      dir = dirname(dir);
    }
  }
  throw new Error('config/source-tiers.yaml not found above the test file');
}
