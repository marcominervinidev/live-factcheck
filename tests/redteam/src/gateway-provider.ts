// promptfoo provider (brief 15.7, ADR 0014): sends a claim to the real text-mode pipeline like a
// user of the app would – WebSocket session, POST /api/claims/check – and returns what the user
// would see: the verdict, its sources and the explanation. The attack text is the claim itself
// or comes from the crafted page in the mock research corpus.
import { readFileSync } from 'node:fs';

import type { ClaimChecked, ClaimExplained } from '@lfc/contracts';
import { CheckClaimAccepted, WsServerMessage } from '@lfc/contracts';
import WebSocket from 'ws';

export interface PipelineAnswer {
  readonly verdict: ClaimChecked['verdict'];
  readonly confidenceLevel: ClaimChecked['confidenceLevel'];
  readonly reason: ClaimChecked['reason'] | null;
  readonly evidenceUrls: readonly string[];
  readonly bestEvidenceUrl: string | null;
  /** null when no explanation arrived in time (the explainer discards unsafe ones). */
  readonly explanation: string | null;
}

const env = (name: string, fallback: string) => process.env[name] ?? fallback;
const BASE_URL = env('REDTEAM_BASE_URL', 'https://lfc.local:8443');
// Local models on a laptop are slow; the check itself is bounded by CHECKER_TIMEOUT_MS.
const VERDICT_TIMEOUT_MS = Number(env('REDTEAM_VERDICT_TIMEOUT_MS', '600000'));
const EXPLANATION_TIMEOUT_MS = Number(env('REDTEAM_EXPLANATION_TIMEOUT_MS', '240000'));

function token(): string {
  return readFileSync(env('GATEWAY_TOKEN_FILE', '/run/secrets/gateway_token'), 'utf8').trim();
}

/** Opens an authenticated session and resolves once `session.ready` arrives. */
function openSession(auth: string): Promise<{ socket: WebSocket; sessionId: string }> {
  const socket = new WebSocket(`${BASE_URL.replace(/^http/, 'ws')}/ws/session`);
  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.once('open', () => {
      socket.send(JSON.stringify({ type: 'auth', schemaVersion: 1, token: auth }));
    });
    socket.once('message', (data: Buffer) => {
      const message = WsServerMessage.safeParse(JSON.parse(data.toString('utf8')));
      if (message.success && message.data.type === 'session.ready') {
        resolve({ socket, sessionId: message.data.sessionId });
      } else {
        reject(new Error('no session.ready from the gateway'));
      }
    });
  });
}

/** Waits for the verdict and (if it comes) the explanation of one claim. */
function collect(
  socket: WebSocket,
  claimId: string,
): Promise<{ checked?: ClaimChecked; explained?: ClaimExplained }> {
  return new Promise((resolve) => {
    const result: { checked?: ClaimChecked; explained?: ClaimExplained } = {};
    let timer = setTimeout(() => {
      resolve(result);
    }, VERDICT_TIMEOUT_MS);
    socket.on('message', (data: Buffer) => {
      const message = WsServerMessage.safeParse(JSON.parse(data.toString('utf8')));
      if (!message.success || message.data.type !== 'event') return;
      const event = message.data.event;
      if (event.type === 'claim.checked' && event.payload.claimId === claimId) {
        result.checked = event.payload;
        clearTimeout(timer);
        timer = setTimeout(() => {
          resolve(result);
        }, EXPLANATION_TIMEOUT_MS);
      } else if (event.type === 'claim.explained' && event.payload.claimId === claimId) {
        result.explained = event.payload;
        clearTimeout(timer);
        resolve(result);
      }
    });
  });
}

export default class GatewayProvider {
  id = (): string => 'live-factcheck-gateway';

  callApi = async (prompt: string): Promise<{ output?: PipelineAnswer; error?: string }> => {
    const auth = token();
    const { socket, sessionId } = await openSession(auth);
    try {
      const response = await fetch(`${BASE_URL}/api/claims/check`, {
        method: 'POST',
        headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' },
        body: JSON.stringify({ schemaVersion: 1, sessionId, text: prompt.slice(0, 1_000) }),
      });
      const accepted = CheckClaimAccepted.safeParse(await response.json());
      if (response.status !== 202 || !accepted.success) {
        return { error: `claim not accepted (HTTP ${String(response.status)})` };
      }
      const { checked, explained } = await collect(socket, accepted.data.claimId);
      if (checked === undefined) return { error: 'no verdict within the time budget' };
      const best = checked.evidence.find((e) => e.evidenceId === checked.bestEvidenceId);
      return {
        output: {
          verdict: checked.verdict,
          confidenceLevel: checked.confidenceLevel,
          reason: checked.reason ?? null,
          evidenceUrls: [
            ...checked.evidence.map((e) => e.url),
            ...(checked.existingFactCheck === undefined ? [] : [checked.existingFactCheck.url]),
          ],
          bestEvidenceUrl: best?.url ?? null,
          explanation: explained?.explanation ?? null,
        },
      };
    } finally {
      socket.close();
    }
  };
}
