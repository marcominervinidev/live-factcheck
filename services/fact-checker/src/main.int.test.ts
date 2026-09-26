// Stage 2a: the fact-checker reads its Redis password from a secret file
// (`REDIS_PASSWORD_FILE`, the way Compose and Kubernetes mount secrets) and becomes ready
// against a real Redis.
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

const ENTRY = fileURLToPath(new URL('./main.ts', import.meta.url));
const PASSWORD = randomBytes(16).toString('hex');

describe('fact-checker with a secret file against a real Redis', () => {
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
      CHECKER_LLM_PROVIDER: 'mock',
      CHECKER_LLM_MODEL: 'mock',
      CHECKER_CLASSIFIER_PROVIDER: 'mock',
      SEARCH_PROVIDER: 'mock',
      EMBEDDINGS_PROVIDER: 'mock',
      EMBEDDINGS_MODEL: 'mock',
      CHECKER_RESEARCH_SOURCES: 'mock',
      SOURCE_TIERS_FILE: fileURLToPath(
        new URL('../../../config/source-tiers.yaml', import.meta.url),
      ),
      CHECKER_USER_AGENT_URL: 'https://github.com/marcominervinidev/live-factcheck',
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

  it('checks a claim from claims.detected and publishes the verdict to the stream and the session', async () => {
    const url = await start(`${PASSWORD}\n`);
    await expect.poll(async () => (await fetch(url)).status, { timeout: 10_000 }).toBe(200);

    const client = new Redis(redis.getMappedPort(6379), redis.getHost(), { password: PASSWORD });
    const subscriber = new Redis(redis.getMappedPort(6379), redis.getHost(), {
      password: PASSWORD,
    });
    try {
      const sessionId = randomUUID();
      const claimId = randomUUID();
      const channelMessages: string[] = [];
      await subscriber.subscribe(sessionEventsChannel(sessionId));
      subscriber.on('message', (_channel, message: string) => channelMessages.push(message));

      const detected = {
        type: 'claim.detected',
        schemaVersion: 2,
        payload: {
          schemaVersion: 2,
          sessionId,
          claimId,
          speaker: 'A',
          originalText: 'Der Zweite Weltkrieg ist erst 20 Jahre vorbei.',
          standaloneText: 'Der Zweite Weltkrieg ist erst 20 Jahre vorbei.',
          normalizedText: 'der zweite weltkrieg ist erst 20 jahre vorbei',
          checkworthiness: 1,
          sourceSegmentIds: [],
          detectedAt: new Date().toISOString(),
          provider: { classifier: 'text-mode', model: 'none' },
        },
      };
      await client.xadd(STREAMS.claimsDetected, '*', 'data', JSON.stringify(detected));

      await expect.poll(() => channelMessages.length, { timeout: 15_000 }).toBe(1);
      const event = EventEnvelope.parse(JSON.parse(channelMessages[0] ?? '{}'));
      expect(event.type).toBe('claim.checked');
      if (event.type !== 'claim.checked') return;
      expect(event.payload).toMatchObject({ claimId, verdict: 'falsch', confidenceLevel: 'hoch' });

      const entries = await client.xrange(STREAMS.claimsChecked, '-', '+');
      expect(entries.some(([, fields]) => fields[1]?.includes(claimId))).toBe(true);
      await expect
        .poll(
          async () =>
            ((await client.xpending(STREAMS.claimsDetected, 'fact-checker')) as [number])[0],
        )
        .toBe(0);
      // Claim text never reaches the logs (brief 15.6).
      expect(run?.output()).not.toContain('20 Jahre vorbei');
    } finally {
      client.disconnect();
      subscriber.disconnect();
    }
  });
});
