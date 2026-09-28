// promptfoo provider (brief 15.7, ADR 0014): sends a claim to the real text-mode pipeline like a
// user of the app would – WebSocket session, POST /api/claims/check – and returns what the user
// would see: the verdict, its sources and the explanation. The attack text is the claim itself
// or comes from the crafted page in the mock research corpus.
import { readFileSync } from 'node:fs';

import type {
  ClaimChecked,
  ClaimExplained,
  WsServerMessage as ServerMessage,
} from '@lfc/contracts';
import { CheckClaimAccepted, WsServerMessage } from '@lfc/contracts';
import WebSocket from 'ws';

export interface PipelineAnswer {
  readonly verdict: ClaimChecked['verdict'];
  readonly confidenceLevel: ClaimChecked['confidenceLevel'];
  readonly reason: ClaimChecked['reason'] | null;
  /** `none` means this run's model judged; anything else is a cached verdict (inconclusive). */
  readonly cacheHit: ClaimChecked['cacheHit'];
  readonly evidenceUrls: readonly string[];
  readonly bestEvidenceUrl: string | null;
  /** null when no explanation arrived in time (the explainer discards unsafe ones). */
  readonly explanation: string | null;
  /** True if the gateway token appears anywhere in what the user would see (never the value). */
  readonly tokenLeaked: boolean;
}

/** Positive integer milliseconds from the environment; a typo fails loudly instead of 1 ms. */
function ms(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

const BASE_URL = process.env['REDTEAM_BASE_URL'] ?? 'https://lfc.local:8443';
const CONNECT_TIMEOUT_MS = ms('REDTEAM_CONNECT_TIMEOUT_MS', 15_000);
// Local models on a laptop are slow; the check itself is bounded by CHECKER_TIMEOUT_MS.
const VERDICT_TIMEOUT_MS = ms('REDTEAM_VERDICT_TIMEOUT_MS', 600_000);
// Must exceed EXPLAINER_TIMEOUT_MS plus stream latency, or a slow explanation looks missing.
const EXPLANATION_TIMEOUT_MS = ms('REDTEAM_EXPLANATION_TIMEOUT_MS', 300_000);

function token(): string {
  return readFileSync(
    process.env['GATEWAY_TOKEN_FILE'] ?? '/run/secrets/gateway_token',
    'utf8',
  ).trim();
}

/** A server frame, or undefined for anything that is not a valid message (never throws). */
function parse(data: Buffer): ServerMessage | undefined {
  try {
    const message = WsServerMessage.safeParse(JSON.parse(data.toString('utf8')));
    return message.success ? message.data : undefined;
  } catch {
    return undefined;
  }
}

interface Session {
  readonly socket: WebSocket;
  readonly sessionId: string;
  /** Every event received so far, and a way to wait for the next one. */
  readonly events: ServerMessage[];
  next(timeoutMs: number): Promise<void>;
}

/** Opens an authenticated session; events are collected from the first frame on. */
function openSession(auth: string): Promise<Session> {
  const socket = new WebSocket(`${BASE_URL.replace(/^http/, 'ws')}/ws/session`);
  const events: ServerMessage[] = [];
  let wake: (() => void) | undefined;
  socket.on('message', (data: Buffer) => {
    const message = parse(data);
    if (message === undefined) return;
    events.push(message);
    wake?.();
  });
  // Errors after the handshake end the run through the timeouts below, never as a crash.
  socket.on('error', () => undefined);
  const next = (timeoutMs: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });

  return new Promise((resolve, reject) => {
    const fail = (reason: string) => {
      clearTimeout(timer);
      socket.close();
      reject(new Error(reason));
    };
    const timer = setTimeout(() => {
      fail('no session.ready within the connect timeout');
    }, CONNECT_TIMEOUT_MS);
    socket.once('error', (error: Error) => {
      fail(`WebSocket error: ${error.message}`);
    });
    socket.once('open', () => {
      socket.send(JSON.stringify({ type: 'auth', schemaVersion: 1, token: auth }));
    });
    const waitReady = (): void => {
      const ready = events.find((event) => event.type === 'session.ready');
      if (ready?.type === 'session.ready') {
        clearTimeout(timer);
        resolve({ socket, sessionId: ready.sessionId, events, next });
      } else if (events.some((event) => event.type === 'error')) {
        fail('the gateway refused the session');
      } else {
        void next(CONNECT_TIMEOUT_MS).then(waitReady);
      }
    };
    waitReady();
  });
}

/** Waits (with a deadline) until `found` returns a value from the collected events. */
async function waitFor<T>(
  session: Session,
  found: () => T | undefined,
  timeoutMs: number,
): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = found();
    if (value !== undefined) return value;
    const left = deadline - Date.now();
    if (left <= 0) return undefined;
    await session.next(left);
  }
}

export default class GatewayProvider {
  id = (): string => 'live-factcheck-gateway';

  callApi = async (prompt: string): Promise<{ output?: PipelineAnswer; error?: string }> => {
    const auth = token();
    const session = await openSession(auth);
    try {
      // The listener already runs: a verdict from the cache (milliseconds) is not missed.
      const response = await fetch(`${BASE_URL}/api/claims/check`, {
        method: 'POST',
        headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: 1,
          sessionId: session.sessionId,
          text: prompt.slice(0, 1_000),
        }),
      });
      const accepted = CheckClaimAccepted.safeParse(await response.json());
      if (response.status !== 202 || !accepted.success) {
        return { error: `claim not accepted (HTTP ${String(response.status)})` };
      }
      const { claimId } = accepted.data;
      const payloadOf = <K extends 'claim.checked' | 'claim.explained'>(type: K) => {
        for (const message of session.events) {
          if (
            message.type === 'event' &&
            message.event.type === type &&
            message.event.payload.claimId === claimId
          ) {
            return message.event.payload as K extends 'claim.checked'
              ? ClaimChecked
              : ClaimExplained;
          }
        }
        return undefined;
      };
      const checked = await waitFor(session, () => payloadOf('claim.checked'), VERDICT_TIMEOUT_MS);
      if (checked === undefined) return { error: 'no verdict within the time budget' };
      const explained = await waitFor(
        session,
        () => payloadOf('claim.explained'),
        EXPLANATION_TIMEOUT_MS,
      );
      const best = checked.evidence.find((e) => e.evidenceId === checked.bestEvidenceId);
      const shown = JSON.stringify({ checked, explained });
      return {
        output: {
          verdict: checked.verdict,
          confidenceLevel: checked.confidenceLevel,
          reason: checked.reason ?? null,
          cacheHit: checked.cacheHit,
          evidenceUrls: [
            ...checked.evidence.map((e) => e.url),
            ...(checked.existingFactCheck === undefined ? [] : [checked.existingFactCheck.url]),
          ],
          bestEvidenceUrl: best?.url ?? null,
          explanation: explained?.explanation ?? null,
          tokenLeaked: shown.includes(auth),
        },
      };
    } finally {
      session.socket.close();
    }
  };
}
