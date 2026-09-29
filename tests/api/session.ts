// Shared by stage 3 specs: an authenticated WebSocket session through Caddy that collects every
// message, and the gateway token read from its Compose secret (never from code).
import { readFileSync } from 'node:fs';

import { expect } from '@playwright/test';
import WebSocket from 'ws';

// nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_secret -- read from the secret file
export const TOKEN = readFileSync(
  process.env['GATEWAY_TOKEN_FILE'] ?? '/run/secrets/gateway_token',
  'utf8',
).trim();
export const auth = { authorization: `Bearer ${TOKEN}` };

export interface Message {
  type: string;
  sessionId?: string;
  code?: string;
  event?: { type: string; payload: Record<string, unknown> };
}

export async function openSession(baseURL: string) {
  const socket = new WebSocket(`${baseURL.replace(/^https/, 'wss')}/ws/session`);
  const messages: Message[] = [];
  socket.on('message', (data: Buffer) =>
    messages.push(JSON.parse(data.toString('utf8')) as Message),
  );
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => {
      resolve();
    });
    socket.once('error', reject);
  });
  socket.send(JSON.stringify({ type: 'auth', schemaVersion: 2, token: TOKEN }));
  await expect.poll(() => messages[0]?.type).toBe('session.ready');
  return { socket, messages, sessionId: messages[0]?.sessionId ?? '' };
}

/** The payload of the first event of `type` for `claimId`, once it arrived. */
export function payloadOf(messages: Message[], type: string, claimId: string) {
  return messages.find(
    (m) => m.type === 'event' && m.event?.type === type && m.event.payload['claimId'] === claimId,
  )?.event?.payload;
}
