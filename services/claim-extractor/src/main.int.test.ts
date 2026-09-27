// Stage 2a: the claim-extractor reads its Redis password from a secret file
// (`REDIS_PASSWORD_FILE`, the way Compose and Kubernetes mount secrets) and becomes ready
// against a real Redis.
// The built image with Compose secrets from SECRETS_DIR is verified on the running stack (TP5).
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { freePort, startServiceProcess } from '@lfc/service-kit/testing';
import type { ServiceProcess } from '@lfc/service-kit/testing';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
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
});
