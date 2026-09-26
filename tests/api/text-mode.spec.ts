// Stage 3 (brief 13.2): text mode through Caddy against the whole backend stack with mock
// providers: claim in, verdict out, then the explanation (DoD phase 1: verdict before explanation).
import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';
import WebSocket from 'ws';

const TOKEN = readFileSync(
  process.env['GATEWAY_TOKEN_FILE'] ?? '/run/secrets/gateway_token',
  'utf8',
).trim();
const auth = { authorization: `Bearer ${TOKEN}` };

interface Message {
  type: string;
  sessionId?: string;
  code?: string;
  event?: { type: string; payload: Record<string, unknown> };
}

/** Opens an authenticated session through Caddy (wss) and collects every message. */
async function openSession(baseURL: string) {
  const socket = new WebSocket(`${baseURL.replace(/^https/, 'wss')}/ws/session`, {
    rejectUnauthorized: false,
  });
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
  socket.send(JSON.stringify({ type: 'auth', schemaVersion: 1, token: TOKEN }));
  await expect.poll(() => messages[0]?.type).toBe('session.ready');
  return { socket, messages, sessionId: messages[0]?.sessionId ?? '' };
}

const events = (messages: Message[], type: string) =>
  messages.filter((m) => m.type === 'event' && m.event?.type === type);

test.describe('text mode', () => {
  test('a typed claim is detected, checked and explained, in this order', async ({
    request,
    baseURL,
  }) => {
    const { socket, messages, sessionId } = await openSession(baseURL ?? '');
    try {
      const response = await request.post('/api/claims/check', {
        headers: auth,
        data: {
          schemaVersion: 1,
          sessionId,
          text: 'Der Zweite Weltkrieg ist erst 20 Jahre vorbei.',
        },
      });
      expect(response.status()).toBe(202);
      const { claimId } = (await response.json()) as { claimId: string };

      await expect
        .poll(() => events(messages, 'claim.explained').length, { timeout: 30_000 })
        .toBe(1);

      const order = messages.filter((m) => m.type === 'event').map((m) => m.event?.type);
      expect(order).toEqual(['claim.detected', 'claim.checked', 'claim.explained']);

      const verdict = events(messages, 'claim.checked')[0]?.event?.payload ?? {};
      expect(verdict).toMatchObject({
        claimId,
        verdict: 'falsch',
        confidenceLevel: 'hoch',
        existingFactCheck: { rating: 'Falsch' },
      });
      expect((verdict['evidence'] as unknown[]).length).toBeGreaterThan(0);
      expect(events(messages, 'claim.explained')[0]?.event?.payload).toMatchObject({ claimId });
    } finally {
      socket.close();
    }
  });

  test('medium confidence and opinions are reported honestly', async ({ request, baseURL }) => {
    const { socket, messages, sessionId } = await openSession(baseURL ?? '');
    try {
      for (const text of [
        'Berlin hat 3,9 Millionen Einwohner.',
        'Ich finde, Berlin ist die schönste Stadt.',
      ]) {
        const response = await request.post('/api/claims/check', {
          headers: auth,
          data: { schemaVersion: 1, sessionId, text },
        });
        expect(response.status()).toBe(202);
      }
      await expect
        .poll(() => events(messages, 'claim.checked').length, { timeout: 30_000 })
        .toBe(2);
      const verdicts = events(messages, 'claim.checked').map((m) => m.event?.payload);
      expect(verdicts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ verdict: 'groesstenteils_richtig', confidenceLevel: 'mittel' }),
          expect.objectContaining({ verdict: 'nicht_pruefbar', reason: 'classified_unverifiable' }),
        ]),
      );
    } finally {
      socket.close();
    }
  });

  test('a repeated claim is answered from the verdict cache', async ({ request, baseURL }) => {
    const { socket, messages, sessionId } = await openSession(baseURL ?? '');
    try {
      for (let i = 0; i < 2; i++) {
        await request.post('/api/claims/check', {
          headers: auth,
          data: { schemaVersion: 1, sessionId, text: 'Der Zweite Weltkrieg endete 1945.' },
        });
        await expect
          .poll(() => events(messages, 'claim.checked').length, { timeout: 30_000 })
          .toBe(i + 1);
      }
      expect(events(messages, 'claim.checked')[1]?.event?.payload).toMatchObject({
        cacheHit: 'verdict_exact',
        verdict: 'stimmt',
      });
    } finally {
      socket.close();
    }
  });
});

test.describe('gateway protection (brief 15.5)', () => {
  test('REST without or with a wrong token is refused', async ({ request }) => {
    for (const headers of [{}, { authorization: `Bearer ${'x'.repeat(48)}` }]) {
      const response = await request.get('/api/status', { headers });
      expect(response.status()).toBe(401);
      expect(await response.json()).toMatchObject({ error: { code: 'unauthorized' } });
    }
  });

  test('a token in the URL does not authenticate', async ({ request }) => {
    const response = await request.get(`/api/status?token=${TOKEN}`);
    expect(response.status()).toBe(401);
  });

  test('WebSocket without auth is closed', async ({ baseURL }) => {
    const socket = new WebSocket(`${(baseURL ?? '').replace(/^https/, 'wss')}/ws/session`, {
      rejectUnauthorized: false,
    });
    const code = await new Promise<number>((resolve) =>
      socket.once('close', (c: number) => {
        resolve(c);
      }),
    );
    expect(code).toBe(4408);
  });

  test('oversized and invalid bodies are rejected', async ({ request, baseURL }) => {
    const { socket, sessionId } = await openSession(baseURL ?? '');
    try {
      const big = await request.post('/api/claims/check', {
        headers: auth,
        data: { schemaVersion: 1, sessionId, text: 'x'.repeat(5_000) },
      });
      expect(big.status()).toBe(413);
      const blank = await request.post('/api/claims/check', {
        headers: auth,
        data: { schemaVersion: 1, sessionId, text: '   ' },
      });
      expect(blank.status()).toBe(400);
    } finally {
      socket.close();
    }
  });

  test('the settings endpoint lists providers without keys or URLs', async ({ request }) => {
    const response = await request.get('/api/status', { headers: auth });
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { providers: { service: string; role: string }[] };
    expect(body.providers.map((p) => `${p.service}:${p.role}`)).toEqual(
      expect.arrayContaining(['fact-checker:classifier', 'fact-checker:llm', 'explainer:llm']),
    );
    expect(JSON.stringify(body)).not.toMatch(/key|https?:\/\//i);
  });
});
