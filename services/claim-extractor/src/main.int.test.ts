// Stage 2a: the claim-extractor reads its Redis password from a secret file
// (`REDIS_PASSWORD_FILE`, the way Compose and Kubernetes mount secrets), becomes ready against a
// real Redis, and turns final transcript segments into claims (mock classifier and LLM, ADR 0017).
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ClaimDetected } from '@lfc/contracts';
import { EventEnvelope, STREAMS } from '@lfc/contracts';
import { publishEvent } from '@lfc/service-kit';
import { freePort, startServiceProcess } from '@lfc/service-kit/testing';
import type { ServiceProcess } from '@lfc/service-kit/testing';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const ENTRY = fileURLToPath(new URL('./main.ts', import.meta.url));
const PASSWORD = randomBytes(16).toString('hex');

describe('claim-extractor with a secret file against a real Redis', () => {
  let redis: StartedRedisContainer;
  let secretsDir: string;
  let run: ServiceProcess | undefined;

  const start = async (secretFileContent: string) => {
    const secretFile = join(secretsDir, `redis_password-${randomBytes(4).toString('hex')}`);
    writeFileSync(secretFile, secretFileContent, { mode: 0o400 });
    const port = await freePort();
    run = startServiceProcess(ENTRY, {
      PORT: String(port),
      REDIS_URL: `redis://${redis.getHost()}:${String(redis.getMappedPort(6379))}`,
      REDIS_PASSWORD_FILE: secretFile,
      EXTRACTOR_LLM_PROVIDER: 'mock',
      EXTRACTOR_LLM_MODEL: 'mock',
      DETECTOR_CLASSIFIER_PROVIDER: 'mock',
    });
    await run.waitFor('service started');
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

  it('detects claims in final segments: pre-filter, window, deduplication, claims.detected', async () => {
    const url = await start(`${PASSWORD}\n`);
    await expect.poll(async () => (await fetch(url)).status, { timeout: 10_000 }).toBe(200);
    const client = new Redis(redis.getMappedPort(6379), redis.getHost(), { password: PASSWORD });
    try {
      const sessionId = randomUUID();
      const segment = (text: string, startMs: number, isFinal = true) => ({
        type: 'transcript.segment' as const,
        schemaVersion: 2 as const,
        payload: {
          schemaVersion: 1 as const,
          sessionId,
          segmentId: randomUUID(),
          speaker: 'A',
          text,
          startMs,
          endMs: startMs + 2_000,
          isFinal,
          language: 'de',
        },
      });
      const lines = [
        segment('Guten Abend und willkommen zur Diskussion.', 0),
        segment('Der Zweite Weltkrieg endete 1965.', 2_000, false),
        segment('Der Zweite Weltkrieg endete 1965.', 2_000),
        segment('Das sehe ich anders, ich finde das Thema wichtig.', 4_000),
        segment('Berlin hat ungefähr 3,9 Millionen Einwohner.', 6_000),
        segment('Der Zweite Weltkrieg endete 1965!', 8_000),
      ];
      for (const line of lines) await publishEvent(client, STREAMS.transcriptSegments, line);

      const claims = async () =>
        (await client.xrange(STREAMS.claimsDetected, '-', '+'))
          .map(([, fields]) => EventEnvelope.parse(JSON.parse(fields[1] ?? '{}')))
          .filter((e) => e.type === 'claim.detected' && e.payload.sessionId === sessionId)
          .map((e) => e.payload as ClaimDetected);
      // Greeting and opinion dropped, interim ignored, the repeated claim deduplicated.
      await expect
        .poll(async () => (await claims()).map((c) => c.standaloneText), { timeout: 15_000 })
        .toEqual([
          'Der Zweite Weltkrieg endete 1965.',
          'Berlin hat ungefähr 3,9 Millionen Einwohner.',
        ]);
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(await claims()).toHaveLength(2);
      const [first] = await claims();
      expect(first).toMatchObject({
        schemaVersion: 3,
        normalizedText: 'der zweite weltkrieg endete 1965',
        sourceSegmentIds: [lines[2]?.payload.segmentId],
        provider: { classifier: 'mock', model: 'mock' },
      });
      // The window keeps the final segments as context for later ones.
      expect(await client.llen(`extractor:v1:window:${sessionId}`)).toBe(5);
      // The provider status for the settings page.
      expect(JSON.parse((await client.get('status:v1:claim-extractor')) ?? '[]')).toEqual([
        { service: 'claim-extractor', role: 'classifier', provider: 'mock', cloud: false },
        { service: 'claim-extractor', role: 'llm', provider: 'mock', model: 'mock', cloud: false },
      ]);
    } finally {
      client.disconnect();
    }
  });
});
