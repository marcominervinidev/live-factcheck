// Computes the CI test matrices (brief 13.4): which workspaces are affected and which
// test stages they have. Backend = packages/*, services/*, evals and scripts/llm-scan,
// frontend = apps/*.
// Usage: node scripts/ci/affected.ts [<git-ref>]   (no ref = all workspaces)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

import { array, isObject, object, output, string } from './json.ts';

interface Workspace {
  readonly name: string;
  readonly dir: string;
}

interface MatrixEntry extends Workspace {
  readonly script: string;
  readonly coverage: boolean;
}

const root = process.cwd();

function list(filter?: string): Workspace[] {
  const args = ['ls', '-r', '--depth', '-1', '--json'];
  if (filter !== undefined) args.push('--filter', filter);
  // pnpm is found via PATH on purpose (hence NOSONAR) – its location differs between the CI runner
  // (pnpm/action-setup) and the toolbox (npm global); both PATHs are set by us, not by input.
  const json = execFileSync('pnpm', args, { encoding: 'utf8' }); // NOSONAR
  return array(JSON.parse(json), 'pnpm ls').map((entry) => {
    const { name, path } = object(entry, 'pnpm ls entry');
    return {
      name: string(name, 'pnpm ls entry name'),
      dir: relative(root, string(path, 'pnpm ls entry path')),
    };
  });
}

function scriptsOf(dir: string): ReadonlySet<string> {
  const { scripts } = object(
    JSON.parse(readFileSync(`${dir}/package.json`, 'utf8')),
    `${dir}/package.json`,
  );
  if (scripts === undefined) return new Set();
  if (!isObject(scripts)) throw new Error(`${dir}/package.json: scripts is not an object`);
  return new Set(Object.keys(scripts));
}

const ref = process.argv[2];
// The ref becomes part of a pnpm argument: a plain git ref only, never an option.
if (ref !== undefined && !/^[\w.][\w./-]*$/.test(ref)) {
  throw new Error(`not a git ref: ${ref}`);
}
let selected = list(ref === undefined ? undefined : `...[${ref}]`);
// A change to a root file (lockfile, tsconfig.base.json, eslint config, …) belongs to the root
// project, which has no tests itself but affects every workspace: run everything.
if (selected.some(({ dir }) => dir === '')) {
  selected = list();
}
const workspaces = selected.filter(({ dir }) => dir !== '');

const BACKEND = /^(packages\/|services\/|evals$|scripts\/llm-scan$)/;

function select(kind: 'backend' | 'frontend', script: 'test:unit' | 'test:int'): MatrixEntry[] {
  return workspaces
    .filter(
      ({ dir }) =>
        (kind === 'frontend' ? dir.startsWith('apps/') : BACKEND.test(dir)) &&
        scriptsOf(dir).has(script),
    )
    .map((workspace) => {
      // Coverage thresholds (brief 13.5) are enforced on one run per workspace: `test:coverage`
      // (unit + integration together) in the integration job where it exists, else the unit run.
      const combined = scriptsOf(workspace.dir).has('test:coverage');
      if (script === 'test:unit') return { ...workspace, script, coverage: !combined };
      return { ...workspace, script: combined ? 'test:coverage' : script, coverage: combined };
    });
}

output('backend_unit', select('backend', 'test:unit'));
output('backend_int', select('backend', 'test:int'));
output('frontend_unit', select('frontend', 'test:unit'));
output('frontend_int', select('frontend', 'test:int'));
