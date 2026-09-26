// Stage 2a: REST and WebSocket of the gateway against a real Redis (ADR 0010, 0011, brief 15.5).
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { EventEnvelope, STREAMS, sessionEventsChannel } from '@lfc/contracts';
import { freePort, startServiceProcess } from '@lfc/service-kit/testing';
import type { ServiceProcess } from '@lfc/service-kit/testing';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

const ENTRY = fileURLToPath(new URL('./main.ts', import.meta.url));
const PASSWORD = randomBytes(16).toString('hex');
const TOKEN = randomBytes(24).toString('hex');

describe('gateway API and WebSocket against a real Redis', () => {
  let container: StartedRedisContainer;
  let run: ServiceProcess;
  let base = '';
  let redis: Redis;

  const authHeaders = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

  /** Opens /ws/session and collects every server message. */
  const connect = () => {
    const socket = new WebSocket(`${base.replace('http', 'ws')}/ws/session`);
    const messages: Record<string, unknown>[] = [];
    let closeCode: number | undefined;
    socket.on('message', (data: Buffer) =>
      messages.push(JSON.parse(data.toString('utf8')) as Record<string, unknown>),
    );
    socket.on('close', (code: number) => {
      closeCode = code;
    });
    const opened = new Promise<void>((resolve) =>
      socket.once('open', () => {
        resolve();
      }),
    );
    return { socket, messages, opened, closeCode: () => closeCode };
  };

  /** An authenticated session; returns the socket and its session id. */
  const session = async () => {
    const client = connect();
    await client.opened;
    client.socket.send(JSON.stringify({ type: 'auth', schemaVersion: 1, token: TOKEN }));
    await expect.poll(() => client.messages.length).toBe(1);
    const ready = client.messages[0] as { type: string; sessionId: string };
    expect(ready.type).toBe('session.ready');
    return { ...client, sessionId: ready.sessionId };
  };

  beforeAll(async () => {
    container = await new RedisContainer('redis:8.10.2-alpine').withPassword(PASSWORD).start();
    const port = await freePort();
    base = `http://127.0.0.1:${String(port)}`;
    run = startServiceProcess(ENTRY, {
      PORT: String(port),
      REDIS_URL: `redis://${container.getHost()}:${String(container.getMappedPort(6379))}`,
      REDIS_PASSWORD: PASSWORD,
      GATEWAY_TOKEN: TOKEN,
      WS_AUTH_TIMEOUT_MS: '500',
      RATE_LIMIT_CHECKS_PER_MINUTE: '5',
    });
    await run.waitFor('service started');
    redis = new Redis(container.getMappedPort(6379), container.getHost(), { password: PASSWORD });
  });

  afterAll(async () => {
    redis.disconnect();
    run.kill('SIGTERM');
    await run.exitCode;
    await container.stop();
  });

  describe('REST', () => {
    it.each([
      ['no token', {}],
      ['a wrong token', { authorization: `Bearer ${'x'.repeat(48)}` }],
      ['a token in the wrong scheme', { authorization: `Basic ${TOKEN}` }],
    ])('answers 401 with ApiError for %s', async (_label, headers) => {
      const response = await fetch(`${base}/api/status`, { headers });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        schemaVersion: 1,
        error: { code: 'unauthorized', message: 'Missing or invalid token' },
      });
    });

    it('rejects invalid bodies and unknown sessions', async () => {
      const post = (body: string) =>
        fetch(`${base}/api/claims/check`, { method: 'POST', headers: authHeaders, body });
      const invalid = await post(
        JSON.stringify({ schemaVersion: 1, sessionId: randomUUID(), text: ' ' }),
      );
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toMatchObject({ error: { code: 'invalid_request' } });

      const broken = await post('{not json');
      expect(broken.status).toBe(400);

      const tooLarge = await post(
        JSON.stringify({ schemaVersion: 1, sessionId: randomUUID(), text: 'x'.repeat(5_000) }),
      );
      expect(tooLarge.status).toBe(413);
      expect(await tooLarge.json()).toMatchObject({ error: { code: 'invalid_request' } });

      const unknown = await post(
        JSON.stringify({
          schemaVersion: 1,
          sessionId: randomUUID(),
          text: 'Berlin hat 3,9 Millionen Einwohner.',
        }),
      );
      expect(unknown.status).toBe(404);
      expect(await unknown.json()).toMatchObject({ error: { code: 'session_unknown' } });
    });

    it('lists the providers the workers published, without keys', async () => {
      await redis.set(
        'status:v1:fact-checker',
        JSON.stringify([
          {
            service: 'fact-checker',
            role: 'classifier',
            provider: 'typesafe',
            model: 'jev-1.13.0',
            cloud: true,
          },
        ]),
      );
      const response = await fetch(`${base}/api/status`, { headers: authHeaders });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        schemaVersion: 1,
        privacyMode: 'cloud',
        providers: [
          {
            service: 'fact-checker',
            role: 'classifier',
            provider: 'typesafe',
            model: 'jev-1.13.0',
            cloud: true,
          },
        ],
      });
    });
  });

  describe('WebSocket', () => {
    it('closes when no auth message arrives in time', async () => {
      const client = connect();
      await client.opened;
      await expect.poll(() => client.closeCode()).toBe(4408);
      expect(client.messages).toEqual([
        {
          type: 'error',
          schemaVersion: 1,
          code: 'auth_timeout',
          message: 'No auth message in time',
        },
      ]);
    });

    it('closes on a wrong token and on a first message that is not auth', async () => {
      const wrong = connect();
      await wrong.opened;
      wrong.socket.send(JSON.stringify({ type: 'auth', schemaVersion: 1, token: 'nope' }));
      await expect.poll(() => wrong.closeCode()).toBe(4401);

      const other = connect();
      await other.opened;
      other.socket.send('{"type":"start","schemaVersion":1}');
      await expect.poll(() => other.closeCode()).toBe(4400);
    });

    it('text mode end to end: claim accepted, claim.detected and the verdict pushed to the session', async () => {
      const client = await session();
      const response = await fetch(`${base}/api/claims/check`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          schemaVersion: 1,
          sessionId: client.sessionId,
          text: '  Der Zweite Weltkrieg endete 1945. ',
        }),
      });
      expect(response.status).toBe(202);
      const accepted = (await response.json()) as { claimId: string; sessionId: string };
      expect(accepted.sessionId).toBe(client.sessionId);

      // The claim is in the stream for the fact-checker …
      const entries = await redis.xrange(STREAMS.claimsDetected, '-', '+');
      const detected = entries
        .map(([, fields]) => EventEnvelope.parse(JSON.parse(fields[1] ?? '{}')))
        .find(
          (event) => event.type === 'claim.detected' && event.payload.claimId === accepted.claimId,
        );
      expect(detected?.payload).toMatchObject({
        originalText: 'Der Zweite Weltkrieg endete 1945.',
        normalizedText: 'der zweite weltkrieg endete 1945',
        provider: { classifier: 'text-mode', model: 'none' },
      });

      // … and on the session channel for the browser ("erkannt").
      await expect.poll(() => client.messages.length).toBe(2);
      expect(client.messages[1]).toMatchObject({
        type: 'event',
        event: { type: 'claim.detected' },
      });

      // A verdict published by the fact-checker reaches this socket.
      const verdictEvent = {
        type: 'claim.explained',
        schemaVersion: 2,
        payload: {
          schemaVersion: 1,
          sessionId: client.sessionId,
          claimId: accepted.claimId,
          explanation: 'Der Krieg endete 1945.',
          provider: { llm: 'mock', model: 'mock' },
        },
      };
      await redis.publish(sessionEventsChannel(client.sessionId), JSON.stringify(verdictEvent));
      await expect.poll(() => client.messages.length).toBe(3);
      expect(client.messages[2]).toEqual({ type: 'event', schemaVersion: 1, event: verdictEvent });

      // Invalid channel payloads are not forwarded.
      await redis.publish(sessionEventsChannel(client.sessionId), '{"type":"claim.deleted"}');

      client.socket.close();
      await expect.poll(async () => redis.exists(`session:v1:${client.sessionId}`)).toBe(0);
      expect(client.messages).toHaveLength(3);
      // Claim text never reaches the log (brief 15.6).
      expect(run.output()).not.toContain('Weltkrieg');
    });

    it('rate-limits text-mode checks (brief 15.5)', async () => {
      const client = await session();
      const statuses: number[] = [];
      for (let i = 0; i < 7; i++) {
        const response = await fetch(`${base}/api/claims/check`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            schemaVersion: 1,
            sessionId: client.sessionId,
            text: `Behauptung Nummer ${String(i)}`,
          }),
        });
        statuses.push(response.status);
        if (response.status === 429) {
          expect(await response.json()).toMatchObject({ error: { code: 'rate_limited' } });
        }
      }
      expect(statuses).toContain(429);
      client.socket.close();
    });
  });
});
