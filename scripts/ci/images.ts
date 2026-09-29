// Lists every image this repo builds, for the CI build/scan/publish matrices.
// Workspaces with a Dockerfile build their `runtime` stage; deploy/compose/<name>/Dockerfile
// are single-stage infrastructure images (e.g. caddy). The build context is always the repo root.
// Usage: node scripts/ci/images.ts   -> writes `images=<json>` to $GITHUB_OUTPUT and stdout
import { execFileSync } from 'node:child_process';

import { output } from './json.ts';

// Absolute path: the same on the CI runner, in the toolbox and on macOS.
const files = execFileSync(
  '/usr/bin/git',
  ['ls-files', 'services/*/Dockerfile', 'apps/*/Dockerfile', 'deploy/compose/*/Dockerfile'],
  { encoding: 'utf8' },
)
  .split('\n')
  .filter((line) => line !== '');

const images = files.map((dockerfile) => {
  const infrastructure = dockerfile.startsWith('deploy/compose/');
  const name = dockerfile.split('/')[infrastructure ? 2 : 1];
  if (name === undefined) throw new Error(`unexpected Dockerfile path: ${dockerfile}`);
  return { name, dockerfile, target: infrastructure ? '' : 'runtime' };
});

output('images', images);
