// Posts (or updates) one PR comment that links the Playwright reports of this commit, so the
// owner can review videos and traces without searching the Actions UI.
// Reports: stage 2b from the ci.yml push run of the head commit, stages 3 and 4 from this run.
// Env: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID, PR_NUMBER, HEAD_SHA.
import { array, boolean, number, object, string } from './json.ts';

// Every value that ends up in an API path is checked first, so no input can point a request
// (which carries the token) at another repository or endpoint.
function input(name: string, pattern: RegExp): string {
  const value = process.env[name] ?? '';
  if (!pattern.test(value)) throw new Error(`${name} is missing or malformed`);
  return value;
}
const token = input('GITHUB_TOKEN', /^\S+$/);
const repo = input('GITHUB_REPOSITORY', /^[\w.-]+\/[\w.-]+$/);
const runId = input('GITHUB_RUN_ID', /^\d+$/);
const prNumber = input('PR_NUMBER', /^\d+$/);
const headSha = input('HEAD_SHA', /^[0-9a-f]{40}$/);

/** Ids taken from API answers, checked before they go into a path or link. */
function id(value: unknown): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`unexpected id ${String(value)}`);
  }
  return String(value);
}

const API = 'https://api.github.com';
const MARKER = '<!-- lfc-test-reports -->';
const REPORTS = [
  ['playwright-report-stage-2b', 'Stage 2b · frontend against a mocked backend'],
  ['playwright-report-stage-3', 'Stage 3 · API against the stack'],
  ['playwright-report-stage-4', 'Stage 4 · E2E against the stack (Chromium, WebKit/iPhone)'],
] as const;

interface Artifact {
  readonly id: string;
  readonly name: string;
  readonly expired: boolean;
  readonly sizeBytes: number;
  readonly runId: string;
}

interface CiRun {
  readonly id: string;
  readonly htmlUrl: string;
}

async function api(path: string, init: { method?: 'POST' | 'PATCH'; body?: string } = {}) {
  const url = new URL(`/repos/${repo}${path}`, API);
  if (url.origin !== API) throw new Error(`refusing request to ${url.origin}`);
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path}: ${String(response.status)}`);
  }
  const data: unknown = response.status === 204 ? null : await response.json();
  return data;
}

async function artifactsOf(run: string): Promise<Artifact[]> {
  const { artifacts } = object(await api(`/actions/runs/${run}/artifacts?per_page=100`), 'run');
  return array(artifacts, 'artifacts').map((entry) => {
    const a = object(entry, 'artifact');
    return {
      id: id(a['id']),
      name: string(a['name'], 'artifact name'),
      expired: boolean(a['expired'], 'artifact expired'),
      sizeBytes: number(a['size_in_bytes'], 'artifact size'),
      runId: run,
    };
  });
}

// The push run may finish after this one; wait up to 10 minutes for its stage 2b report.
async function completedCiRun(): Promise<CiRun | undefined> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const { workflow_runs: runs } = object(
      await api(`/actions/workflows/ci.yml/runs?head_sha=${headSha}&event=push`),
      'workflow runs',
    );
    const [first] = array(runs, 'workflow_runs');
    if (first === undefined) return undefined;
    const run = object(first, 'workflow run');
    if (string(run['status'], 'run status') === 'completed') {
      const htmlUrl = string(run['html_url'], 'run html_url');
      if (!htmlUrl.startsWith(`https://github.com/${repo}/`)) {
        throw new Error(`unexpected run link ${htmlUrl}`);
      }
      return { id: id(run['id']), htmlUrl };
    }
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
  return undefined;
}

const ciRun = await completedCiRun();
const artifacts = [
  ...(await artifactsOf(runId)),
  ...(ciRun === undefined ? [] : await artifactsOf(ciRun.id)),
];

const rows = REPORTS.map(([name, label]) => {
  const artifact = artifacts.find((a) => a.name === name && !a.expired);
  if (artifact === undefined)
    return `| ${label} | not available (stage skipped or still running) |`;
  const url = `https://github.com/${repo}/actions/runs/${artifact.runId}/artifacts/${artifact.id}`;
  return `| ${label} | [download](${url}) (${(artifact.sizeBytes / 1e6).toFixed(1)} MB) |`;
});

const body = `${MARKER}
### Test reports for \`${headSha.slice(0, 7)}\`

Every test is recorded (trace, video, screenshot). Unzip a report and open it with
\`npx playwright show-report <folder>\`, or drop a single \`trace.zip\` from the report onto
https://trace.playwright.dev (runs locally in the browser, nothing is uploaded).

| Report | Artifact |
|---|---|
${rows.join('\n')}

Reports are kept for 7 days (stage 4: 14 days). [This run](https://github.com/${repo}/actions/runs/${runId})${ciRun === undefined ? '' : ` · [ci run](${ciRun.htmlUrl})`}
`;

const comments = array(await api(`/issues/${prNumber}/comments?per_page=100`), 'comments');
const existing = comments
  .map((entry) => object(entry, 'comment'))
  .find((c) => typeof c['body'] === 'string' && c['body'].startsWith(MARKER));
await (existing === undefined
  ? api(`/issues/${prNumber}/comments`, { method: 'POST', body: JSON.stringify({ body }) })
  : api(`/issues/comments/${id(existing['id'])}`, {
      method: 'PATCH',
      body: JSON.stringify({ body }),
    }));
console.log(existing === undefined ? 'comment created' : 'comment updated');
