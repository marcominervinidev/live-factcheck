// `pnpm eval` (brief 13.5): runs the claim set against a running stack like a client (REST +
// WebSocket through Caddy) and writes a report. Configure the providers of the stack itself;
// this runner only measures. Usage (inside the stack network, see `make eval`):
//   EVAL_LABEL=claude-opus EVAL_BASE_URL=https://lfc.local:8443 GATEWAY_TOKEN_FILE=… pnpm eval
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ClaimChecked } from '@lfc/contracts';
import { CheckClaimAccepted, ProviderStatus, WsServerMessage } from '@lfc/contracts';
import WebSocket from 'ws';

import type { ClaimItem } from './dataset.js';
import { loadClaims } from './dataset.js';
import type { Outcome } from './metrics.js';
import { summarize } from './metrics.js';
import { markdownReport, reliabilitySvg } from './report.js';

const env = (name: string, fallback?: string) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') throw new Error(`${name} is required`);
  return value;
};

const BASE_URL = env('EVAL_BASE_URL', 'https://lfc.local:8443');
const LABEL = env('EVAL_LABEL')
  .replace(/[^a-z0-9-]/gi, '-')
  .toLowerCase();
const DATASET = env('EVAL_DATASET', new URL('../claims.de.jsonl', import.meta.url).pathname);
const OUT_DIR = env(
  'EVAL_OUT_DIR',
  new URL('../../docs/evidence/phase-1/evals', import.meta.url).pathname,
);
const INCLUDE_UNREVIEWED = process.env['EVAL_INCLUDE_UNREVIEWED'] === 'true';
const TIMEOUT_MS = Number(env('EVAL_TIMEOUT_MS', '90000'));
const LIMIT = Number(env('EVAL_LIMIT', '0'));
// nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_secret -- read from the secret file
const TOKEN = readFileSync(env('GATEWAY_TOKEN_FILE', '/run/secrets/gateway_token'), 'utf8').trim();

const headers = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

async function openSession(): Promise<{
  socket: WebSocket;
  sessionId: string;
  verdicts: Map<string, (c: ClaimChecked) => void>;
}> {
  const socket = new WebSocket(`${BASE_URL.replace(/^http/, 'ws')}/ws/session`);
  const verdicts = new Map<string, (c: ClaimChecked) => void>();
  const sessionId = await new Promise<string>((resolve, reject) => {
    socket.once('error', reject);
    socket.once('open', () => {
      socket.send(JSON.stringify({ type: 'auth', schemaVersion: 1, token: TOKEN }));
    });
    socket.on('message', (data: Buffer) => {
      const parsed = WsServerMessage.safeParse(JSON.parse(data.toString('utf8')));
      if (!parsed.success) return;
      const message = parsed.data;
      if (message.type === 'session.ready') resolve(message.sessionId);
      else if (message.type === 'error') reject(new Error(`gateway: ${message.code}`));
      else if (message.event.type === 'claim.checked')
        verdicts.get(message.event.payload.claimId)?.(message.event.payload);
    });
  });
  return { socket, sessionId, verdicts };
}

/** Sends one claim; waits out a rate limit once. Returns undefined when it was not accepted. */
async function submit(
  item: ClaimItem,
  sessionId: string,
  retried = false,
): Promise<string | undefined> {
  // nosemgrep: ajinabraham.njsscan.generic.error_disclosure.generic_error_disclosure -- CLI output for the owner, only the error type
  try {
    const response = await fetch(`${BASE_URL}/api/claims/check`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ schemaVersion: 1, sessionId, text: item.claim }),
    });
    if (response.status === 429 && !retried) {
      await new Promise((resolve) => setTimeout(resolve, 60_000));
      return await submit(item, sessionId, true);
    }
    const accepted = CheckClaimAccepted.safeParse(await response.json());
    if (response.status === 202 && accepted.success) return accepted.data.claimId;
    console.error(`${item.id}: not accepted (HTTP ${String(response.status)})`);
  } catch (error) {
    console.error(
      `${item.id}: request failed (${error instanceof Error ? error.name : 'unknown'})`,
    );
  }
  return undefined;
}

async function evaluate(
  item: ClaimItem,
  session: Awaited<ReturnType<typeof openSession>>,
): Promise<Outcome> {
  const started = performance.now();
  const claimId = await submit(item, session.sessionId);
  // One failed request must not throw away a (possibly paid) run: it counts as unanswered.
  if (claimId === undefined) return { item };
  const checked = await new Promise<ClaimChecked | undefined>((resolve) => {
    const timer = setTimeout(() => {
      resolve(undefined);
    }, TIMEOUT_MS);
    session.verdicts.set(claimId, (c) => {
      clearTimeout(timer);
      resolve(c);
    });
  });
  session.verdicts.delete(claimId);
  return checked === undefined
    ? { item }
    : { item, checked, clientLatencyMs: performance.now() - started };
}

const all = loadClaims(DATASET);
const items = all
  .filter((item) => INCLUDE_UNREVIEWED || item.reviewed)
  .slice(0, LIMIT > 0 ? LIMIT : undefined);
if (items.length === 0) {
  console.error(
    `No items to evaluate: ${String(all.length)} in the set, none reviewed. Review labels or set EVAL_INCLUDE_UNREVIEWED=true for a dry run.`,
  );
  process.exit(1);
}

const status = await fetch(`${BASE_URL}/api/status`, { headers });
const providers = ProviderStatus.safeParse(await status.json());
const providerText = providers.success
  ? providers.data.providers
      .map(
        (p) => `${p.service}/${p.role}: ${p.provider}${p.model === undefined ? '' : ` ${p.model}`}`,
      )
      .join(', ')
  : 'unknown';

const startedAt = new Date().toISOString();
const session = await openSession();
const outcomes: Outcome[] = [];
// Sequential on purpose: latency per claim stays comparable and rate limits are respected.
for (const [index, item] of items.entries()) {
  const outcome = await evaluate(item, session);
  outcomes.push(outcome);
  console.log(
    `${String(index + 1).padStart(3)}/${String(items.length)} ${item.id}: expected ${item.expected}, got ${outcome.checked?.verdict ?? 'timeout'}${outcome.checked === undefined ? '' : ` (${outcome.checked.confidenceLevel}, ${outcome.checked.cacheHit})`}`,
  );
}
session.socket.close();

const summary = summarize(outcomes);
const stamp = startedAt.replace(/[:.]/g, '-');
const base = `eval-${LABEL}-${stamp}`;
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, `${base}.svg`), reliabilitySvg(summary.reliability));
writeFileSync(
  join(OUT_DIR, `${base}.md`),
  markdownReport(
    {
      label: LABEL,
      startedAt,
      dataset: DATASET.split('/').slice(-2).join('/'),
      includesUnreviewed: INCLUDE_UNREVIEWED,
      providers: providerText,
      svgFile: `${base}.svg`,
    },
    summary,
  ),
);
// Raw results for later analysis; claims are public test data, no secrets.
writeFileSync(
  join(OUT_DIR, `${base}.json`),
  JSON.stringify(
    outcomes.map((o) => ({
      id: o.item.id,
      expected: o.item.expected,
      checked: o.checked,
      clientLatencyMs: o.clientLatencyMs,
    })),
    null,
    2,
  ),
);
console.log(`\nReport: ${join(OUT_DIR, `${base}.md`)}`);
console.log(
  `accuracy ${summary.accuracy.toFixed(3)}, direction ${summary.directionAccuracy.toFixed(3)}, brier ${summary.brier.toFixed(3)}, ece ${summary.ece.toFixed(3)}`,
);
