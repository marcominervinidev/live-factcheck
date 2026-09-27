// Computes the CI test matrices (brief 13.4): which workspaces are affected and which
// test stages they have. Backend = packages/* and services/*, frontend = apps/*.
// Usage: node scripts/ci/affected.mjs [<git-ref>]   (no ref = all workspaces)
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';

const root = process.cwd();
const list = (filter) => {
  const args = ['ls', '-r', '--depth', '-1', '--json'];
  if (filter) {
    args.push('--filter', filter);
  }
  return JSON.parse(execFileSync('pnpm', args, { encoding: 'utf8' })).map(({ name, path }) => ({
    name,
    dir: relative(root, path),
  }));
};

const ref = process.argv[2];
let selected = list(ref ? `...[${ref}]` : undefined);
// A change to a root file (lockfile, tsconfig.base.json, eslint config, …) belongs to the root
// project, which has no tests itself but affects every workspace: run everything.
if (selected.some(({ dir }) => dir === '')) {
  selected = list(undefined);
}
const workspaces = selected.filter(({ dir }) => dir !== '');

const scriptsOf = (dir) => JSON.parse(readFileSync(`${dir}/package.json`, 'utf8')).scripts ?? {};
const select = (kind, script) =>
  workspaces.filter(
    ({ dir }) =>
      (kind === 'frontend' ? dir.startsWith('apps/') : /^(packages|services)\//.test(dir)) &&
      script in scriptsOf(dir),
  );

const matrices = {
  backend_unit: select('backend', 'test:unit'),
  backend_int: select('backend', 'test:int'),
  frontend_unit: select('frontend', 'test:unit'),
  frontend_int: select('frontend', 'test:int'),
};

for (const [key, value] of Object.entries(matrices)) {
  const line = `${key}=${JSON.stringify(value)}\n`;
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, line);
  }
  process.stdout.write(line);
}
