import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Path of the committed repo config, found by walking up from this file. A fixed `../../..`
 * breaks in Stryker's sandbox (`.stryker-tmp/sandbox-*`), where a package sits two levels
 * deeper - it bit research and fact-checker alike, so every test resolves the repo config
 * through here.
 */
export function repoSourceTiersPath(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    const candidate = join(dir, 'config', 'source-tiers.yaml');
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      dir = dirname(dir);
    }
  }
  throw new Error('config/source-tiers.yaml not found above the test file');
}

/** The committed repo config's text. */
export function readRepoSourceTiers(): string {
  return readFileSync(repoSourceTiersPath(), 'utf8');
}
