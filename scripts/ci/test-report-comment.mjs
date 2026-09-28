// Posts (or updates) one PR comment that links the Playwright reports of this commit, so the
// owner can review videos and traces without searching the Actions UI.
// Reports: stage 2b from the ci.yml push run of the head commit, stages 3 and 4 from this run.
// Env: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID, PR_NUMBER, HEAD_SHA.
// Every value that ends up in an API path is checked first, so no input can point a request
// (which carries the token) at another repository or endpoint.
function input(name, pattern) {
  const value = process.env[name] ?? '';
  if (!pattern.test(value)) throw new Error(`${name} is missing or malformed`);
  return value;
}
const { GITHUB_TOKEN } = process.env;
const repo = input('GITHUB_REPOSITORY', /^[\w.-]+\/[\w.-]+$/);
const runId = input('GITHUB_RUN_ID', /^\d+$/);
const PR_NUMBER = input('PR_NUMBER', /^\d+$/);
const HEAD_SHA = input('HEAD_SHA', /^[0-9a-f]{40}$/);
/** Ids taken from API answers, checked before they go into a path or link. */
function id(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`unexpected id ${String(value)}`);
  return String(value);
}
const API = 'https://api.github.com';
const MARKER = '<!-- lfc-test-reports -->';
const REPORTS = [
  ['playwright-report-stage-2b', 'Stage 2b · frontend against a mocked backend'],
  ['playwright-report-stage-3', 'Stage 3 · API against the stack'],
  ['playwright-report-stage-4', 'Stage 4 · E2E against the stack (Chromium, WebKit/iPhone)'],
];

async function api(path, init = {}) {
  const url = new URL(`/repos/${repo}${path}`, API);
  if (url.origin !== API) throw new Error(`refusing request to ${url.origin}`);
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${response.status}`);
  return response.status === 204 ? null : response.json();
}

const artifactsOf = async (run) =>
  (await api(`/actions/runs/${run}/artifacts?per_page=100`)).artifacts.map((a) => ({
    ...a,
    runId: run,
  }));

// The push run may finish after this one; wait up to 10 minutes for its stage 2b report.
async function completedCiRun() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const { workflow_runs: runs } = await api(
      `/actions/workflows/ci.yml/runs?head_sha=${HEAD_SHA}&event=push`,
    );
    if (runs[0] === undefined || runs[0].status === 'completed') return runs[0];
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
  return undefined;
}
const ciRun = await completedCiRun();
const artifacts = [
  ...(await artifactsOf(runId)),
  ...(ciRun === undefined ? [] : await artifactsOf(id(ciRun.id))),
];

const rows = REPORTS.map(([name, label]) => {
  const artifact = artifacts.find((a) => a.name === name && !a.expired);
  if (artifact === undefined)
    return `| ${label} | not available (stage skipped or still running) |`;
  const url = `https://github.com/${repo}/actions/runs/${artifact.runId}/artifacts/${id(artifact.id)}`;
  return `| ${label} | [download](${url}) (${(artifact.size_in_bytes / 1e6).toFixed(1)} MB) |`;
});

const body = `${MARKER}
### Test reports for \`${HEAD_SHA.slice(0, 7)}\`

Every test is recorded (trace, video, screenshot). Unzip a report and open it with
\`npx playwright show-report <folder>\`, or drop a single \`trace.zip\` from the report onto
https://trace.playwright.dev (runs locally in the browser, nothing is uploaded).

| Report | Artifact |
|---|---|
${rows.join('\n')}

Reports are kept for 7 days (stage 4: 14 days). [This run](https://github.com/${repo}/actions/runs/${runId})${ciRun === undefined ? '' : ` · [ci run](${ciRun.html_url})`}
`;

const comments = await api(`/issues/${PR_NUMBER}/comments?per_page=100`);
const existing = comments.find((c) => c.body?.startsWith(MARKER));
await (existing === undefined
  ? api(`/issues/${PR_NUMBER}/comments`, { method: 'POST', body: JSON.stringify({ body }) })
  : api(`/issues/comments/${id(existing.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ body }),
    }));
console.log(existing === undefined ? 'comment created' : 'comment updated');
