// Lists every image this repo builds, for the CI build/scan/publish matrices.
// Workspaces with a Dockerfile build their `runtime` stage; deploy/compose/<name>/Dockerfile
// are single-stage infrastructure images (e.g. caddy). The build context is always the repo root.
// Usage: node scripts/ci/images.mjs   -> writes `images=<json>` to $GITHUB_OUTPUT and stdout
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const files = execFileSync(
  'git',
  ['ls-files', 'services/*/Dockerfile', 'apps/*/Dockerfile', 'deploy/compose/*/Dockerfile'],
  { encoding: 'utf8' },
)
  .split('\n')
  .filter(Boolean);

const images = files.map((dockerfile) => {
  const parts = dockerfile.split('/');
  const infrastructure = dockerfile.startsWith('deploy/compose/');
  return {
    name: infrastructure ? parts[2] : parts[1],
    dockerfile,
    target: infrastructure ? '' : 'runtime',
  };
});

const line = `images=${JSON.stringify(images)}\n`;
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, line);
}
process.stdout.write(line);
