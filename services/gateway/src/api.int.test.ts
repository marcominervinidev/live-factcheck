// Stage 2a: REST and WebSocket of the gateway against a real Redis (ADR 0010, 0011, brief 15.5).
// In-process (the real routes on a real port), so coverage counts; the process-level start is
// covered by main.test.ts and main.int.test.ts.
import { randomBytes, randomUUID } from 'node:crypto';

import { EventEnvelope, STREAMS, sessionEventsChannel } from '@lfc/contracts';
import { createHttpServer, createLogger, createRedis } from '@lfc/service-kit';
import type { HttpServer, RedisConnection } from '@lfc/service-kit';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { Redis } from 'ioredis';
import { Registry } from 'prom-client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

import { registerApi } from './api.js';
import { configSchema } from './config.js';
import type { SessionHub } from './sessions.js';
import { sessionHub, sessionStore } from './sessions.js';
import { registerWebSocket } from './ws.js';

const PASSWORD = randomBytes(16).toString('hex');
const TOKEN = randomBytes(24).toString('hex');

describe('gateway API and WebSocket against a real Redis', () => {
  let container: StartedRedisContainer;
  let app: HttpServer;
  let connection: RedisConnection;
  let hub: SessionHub;
  const logLines: string[] = [];
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
    const url = `redis://${container.getHost()}:${String(container.getMappedPort(6379))}`;
    const config = configSchema.parse({
      PORT: '8080', // unused: the test server listens on a free port
      REDIS_URL: url,
      REDIS_PASSWORD: PASSWORD,
      GATEWAY_TOKEN: TOKEN,
      WS_AUTH_TIMEOUT_MS: '500',
      RATE_LIMIT_CHECKS_PER_MINUTE: '5',
    });
    const logger = createLogger({
      service: 'gateway',
      level: 'info',
      secretKeys: ['GATEWAY_TOKEN'],
      secretValues: [TOKEN],
      destination: { write: (line: string) => logLines.push(line) },
    });
    connection = createRedis({ url, password: PASSWORD, logger });
    const sessions = sessionStore(connection.client, config.MAX_SESSION_MS);
    hub = sessionHub(connection.client, logger);
    app = createHttpServer({
      logger,
      metrics: new Registry(),
      readiness: () => [connection.readiness],
      isShuttingDown: () => false,
    });
    await registerApi(app, {
      config,
      redis: connection.client,
      sessions,
      logger,
      now: () => new Date(),
    });
    await registerWebSocket(app, { config, sessions, hub, logger });
    base = await app.listen({ host: '127.0.0.1', port: 0 });
    redis = new Redis(container.getMappedPort(6379), container.getHost(), { password: PASSWORD });
    await vi.waitFor(() => connection.readiness.check(), { timeout: 10_000 });
  });

  afterAll(async () => {
    redis.disconnect();
    await app.close();
    hub.close();
    await connection.close();
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

    it.each([
      '/%61pi/status',
      '/ap%69/status',
      '/%61%70%69/status',
      '/API/status',
      '/api/unknown',
      '/nothing',
    ])('needs the token for %s too (deny by default on the matched route)', async (path) => {
      const response = await fetch(`${base}${path}`);
      expect(response.status).toBe(401);
    });

    it('answers the ops endpoints without a token (internal only)', async () => {
      expect((await fetch(`${base}/healthz`)).status).toBe(200);
    });

    it('skips a corrupt worker status entry instead of failing', async () => {
      await redis.set('status:v1:explainer', '{not json');
      const response = await fetch(`${base}/api/status`, { headers: authHeaders });
      expect(response.status).toBe(200);
      await redis.del('status:v1:explainer');
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

      const binary = connect();
      await binary.opened;
      binary.socket.send(
        Buffer.from(JSON.stringify({ type: 'auth', schemaVersion: 1, token: TOKEN })),
      );
      await expect.poll(() => binary.closeCode()).toBe(4400);

      const garbage = connect();
      await garbage.opened;
      garbage.socket.send('{not json');
      await expect.poll(() => garbage.closeCode()).toBe(4400);
    });

    it('treats a second auth message sent while the session is created as invalid', async () => {
      const before = (await redis.keys('session:v1:*')).length;
      const client = connect();
      await client.opened;
      const auth = JSON.stringify({ type: 'auth', schemaVersion: 1, token: TOKEN });
      client.socket.send(auth);
      client.socket.send(auth);
      await expect.poll(() => client.closeCode()).toBe(4400);
      // No session survives the closed socket (no leaked session or subscription).
      await expect.poll(async () => (await redis.keys('session:v1:*')).length).toBe(before);
    });

    it('closes an authenticated session on any further client message (phase 1 has none)', async () => {
      const client = await session();
      client.socket.send(JSON.stringify({ type: 'auth', schemaVersion: 1, token: TOKEN }));
      await expect.poll(() => client.closeCode()).toBe(4400);
      await expect.poll(async () => redis.exists(`session:v1:${client.sessionId}`)).toBe(0);
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
      await redis.publish(sessionEventsChannel(client.sessionId), '{not json');

      client.socket.close();
      await expect.poll(async () => redis.exists(`session:v1:${client.sessionId}`)).toBe(0);
      expect(client.messages).toHaveLength(3);
      // Claim text never reaches the log (brief 15.6).
      expect(logLines.join('')).not.toContain('Weltkrieg');
      expect(logLines.join('')).not.toContain(TOKEN);
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
