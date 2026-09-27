// Stage 2a: the explainer reads its Redis password from a secret file
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

describe('explainer with a secret file against a real Redis', () => {
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
      EXPLAINER_LLM_PROVIDER: 'mock',
      EXPLAINER_LLM_MODEL: 'mock',
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

  it('explains a verdict from claims.checked and publishes it after the verdict', async () => {
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

      const checked = {
        type: 'claim.checked',
        schemaVersion: 2,
        payload: {
          schemaVersion: 2,
          sessionId,
          claimId,
          speaker: 'A',
          claim: 'Der Zweite Weltkrieg ist erst 20 Jahre vorbei.',
          verdict: 'falsch',
          probabilities: {
            stimmt: 0.01,
            groesstenteils_richtig: 0.01,
            uebertrieben: 0.03,
            falsch: 0.93,
            nicht_pruefbar: 0.02,
          },
          confidence: 0.91,
          confidenceLevel: 'hoch',
          evidence: [
            {
              evidenceId: randomUUID(),
              title: 'Zweiter Weltkrieg',
              url: 'https://de.wikipedia.org/wiki/Zweiter_Weltkrieg',
              publisher: 'Wikipedia',
              retrievedAt: new Date().toISOString(),
              tier: 'referenz',
              snippet: 'Der Zweite Weltkrieg endete am 2. September 1945.',
            },
          ],
          cacheHit: 'none',
          timings: { detectMs: 0, retrieveMs: 100, classifyMs: 10, totalMs: 120 },
          checkedAt: new Date().toISOString(),
          provider: { classifier: 'mock', model: 'mock', search: 'mock', embeddings: 'mock' },
          usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
        },
      };
      await client.xadd(STREAMS.claimsChecked, '*', 'data', JSON.stringify(checked));

      await expect.poll(() => channelMessages.length, { timeout: 15_000 }).toBe(1);
      const event = EventEnvelope.parse(JSON.parse(channelMessages[0] ?? '{}'));
      expect(event).toMatchObject({
        type: 'claim.explained',
        payload: { claimId, explanation: 'Testerklärung: Die Behauptung ist falsch.' },
      });
      const [verdictEntry] = await client.xrange(STREAMS.claimsChecked, '-', '+');
      const [explanationEntry] = await client.xrange(STREAMS.claimsExplained, '-', '+');
      // Stream ids are time-ordered: the verdict came first (DoD phase 1).
      expect(
        verdictEntry?.[0].localeCompare(explanationEntry?.[0] ?? '', undefined, { numeric: true }),
      ).toBe(-1);
    } finally {
      client.disconnect();
      subscriber.disconnect();
    }
  });
});
