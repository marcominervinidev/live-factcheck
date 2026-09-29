// Stage 2a: the transcription service reads its Redis password from a secret file
// (`REDIS_PASSWORD_FILE`, the way Compose and Kubernetes mount secrets), becomes ready against a
// real Redis, and turns audio on `/v1/audio` into transcript events (mock STT, ADR 0015).
// The built image with Compose secrets from SECRETS_DIR is verified on the running stack (TP5).
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EventEnvelope, STREAMS, sessionEventsChannel } from '@lfc/contracts';
import { freePort, startServiceProcess } from '@lfc/service-kit/testing';
import type { ServiceProcess } from '@lfc/service-kit/testing';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

const ENTRY = fileURLToPath(new URL('./main.ts', import.meta.url));
const PASSWORD = randomBytes(16).toString('hex');

describe('transcription with a secret file against a real Redis', () => {
  let redis: StartedRedisContainer;
  let secretsDir: string;
  let run: ServiceProcess | undefined;
  let lastPort = 0;

  const start = async (secretFileContent: string) => {
    const secretFile = join(secretsDir, `redis_password-${randomBytes(4).toString('hex')}`);
    writeFileSync(secretFile, secretFileContent, { mode: 0o400 });
    const port = await freePort();
    run = startServiceProcess(ENTRY, {
      PORT: String(port),
      REDIS_URL: `redis://${redis.getHost()}:${String(redis.getMappedPort(6379))}`,
      REDIS_PASSWORD_FILE: secretFile,
      STT_PROVIDER: 'mock',
      STT_MODEL: 'mock',
    });
    await run.waitFor('service started');
    lastPort = port;
    return `http://127.0.0.1:${String(port)}/readyz`;
  };

  beforeAll(async () => {
    redis = await new RedisContainer('redis:8.10.2-alpine').withPassword(PASSWORD).start();
    secretsDir = mkdtempSync(join(tmpdir(), 'lfc-secrets-'));
  });

  afterEach(async () => {
    run?.kill('SIGTERM');
    await run?.exitCode;
    run = undefined;
  });

  afterAll(async () => {
    rmSync(secretsDir, { recursive: true, force: true });
    await redis.stop();
  });

  it('becomes ready with the password from the file and never logs it', async () => {
    const url = await start(`${PASSWORD}\n`);
    await expect.poll(async () => (await fetch(url)).status, { timeout: 10_000 }).toBe(200);
    expect(await (await fetch(url)).json()).toEqual({ status: 'ready', checks: { redis: 'ok' } });
    expect(run?.output()).not.toContain(PASSWORD);
  });

  it('stays not ready when the file holds a wrong password', async () => {
    const url = await start('wrong-password\n');
    // Wait for Redis' actual auth rejection; right after start PING also fails while connecting.
    await run?.waitFor('WRONGPASS');
    const response = await fetch(url);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'not_ready', checks: { redis: 'failed' } });
  });

  it('turns audio into interim events on the channel and final segments on the stream', async () => {
    const readyz = await start(`${PASSWORD}\n`);
    await expect.poll(async () => (await fetch(readyz)).status, { timeout: 10_000 }).toBe(200);
    const client = new Redis(redis.getMappedPort(6379), redis.getHost(), { password: PASSWORD });
    const subscriber = client.duplicate();
    try {
      // The settings page learns which STT provider runs (ProviderStatus v2, role stt).
      expect(JSON.parse((await client.get('status:v1:transcription')) ?? '[]')).toEqual([
        { service: 'transcription', role: 'stt', provider: 'mock', model: 'mock', cloud: false },
      ]);

      const sessionId = randomUUID();
      const recordingId = randomUUID();
      const channel: EventEnvelope[] = [];
      subscriber.on('message', (_c: string, message: string) =>
        channel.push(EventEnvelope.parse(JSON.parse(message))),
      );
      await subscriber.subscribe(sessionEventsChannel(sessionId));

      const socket = new WebSocket(`ws://127.0.0.1:${String(lastPort)}/v1/audio`);
      const answers: unknown[] = [];
      socket.on('message', (data: Buffer) => answers.push(JSON.parse(data.toString('utf8'))));
      await new Promise((resolve) => socket.once('open', resolve));
      socket.send(
        JSON.stringify({
          type: 'start',
          schemaVersion: 1,
          sessionId,
          recordingId,
          sampleRate: 16_000,
          encoding: 'pcm16',
          channels: 1,
          language: 'de',
        }),
      );
      await expect.poll(() => answers).toEqual([{ type: 'ready', schemaVersion: 1, recordingId }]);
      // 2 s of audio: one interim and one final segment from the mock script.
      for (let i = 0; i < 20; i++) socket.send(new Uint8Array(3_200));
      socket.send(JSON.stringify({ type: 'stop', schemaVersion: 1 }));
      await expect
        .poll(() => answers.at(-1))
        .toEqual({ type: 'stopped', schemaVersion: 1, recordingId, reason: 'client' });

      await expect
        .poll(() => channel.map((e) => e.type === 'transcript.segment' && e.payload.isFinal))
        .toEqual([false, true]);
      const entries = await client.xrange(STREAMS.transcriptSegments, '-', '+');
      const stream = entries
        .map(([, fields]) => EventEnvelope.parse(JSON.parse(fields[1] ?? '{}')))
        .filter((e) => e.payload.sessionId === sessionId);
      // Only the final segment enters the pipeline (brief 6.4).
      expect(stream).toHaveLength(1);
      expect(stream[0]).toEqual(channel[1]);
      socket.close();
    } finally {
      subscriber.disconnect();
      client.disconnect();
    }
  });
});
