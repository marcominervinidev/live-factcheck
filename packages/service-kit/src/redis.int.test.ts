import { randomBytes } from 'node:crypto';

import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createRedis } from './redis.js';
import type { RedisConnection } from './redis.js';
import { silentLogger } from './testing/silent-logger.js';

const PASSWORD = randomBytes(12).toString('hex');
// Isolates keys when test files run in parallel against shared infrastructure (brief 13.1).
const PREFIX = `test:${randomBytes(4).toString('hex')}:`;

describe('createRedis against a real Redis', () => {
  let container: StartedRedisContainer;
  const connections: RedisConnection[] = [];
  const connect = (password: string) => {
    const url = `redis://${container.getHost()}:${String(container.getMappedPort(6379))}`;
    const connection = createRedis({ url, password, logger: silentLogger() });
    connections.push(connection);
    return connection;
  };

  beforeAll(async () => {
    container = await new RedisContainer('redis:8.10.2-alpine').withPassword(PASSWORD).start();
  });

  afterAll(async () => {
    await Promise.all(connections.map((connection) => connection.close()));
    await container.stop();
  });

  it('is ready with the right password and can read and write', async () => {
    const redis = connect(PASSWORD);
    await expect.poll(() => redis.readiness.check().then(() => 'ok')).toBe('ok');
    await redis.client.set(`${PREFIX}greeting`, 'hallo');
    expect(await redis.client.get(`${PREFIX}greeting`)).toBe('hallo');
  });

  it('is not ready with a wrong password', async () => {
    const redis = connect('wrong-password');
    await expect(redis.readiness.check()).rejects.toThrow();
  });

  it('fails fast instead of queueing when Redis goes away', async () => {
    const redis = connect(PASSWORD);
    await expect.poll(() => redis.readiness.check().then(() => 'ok')).toBe('ok');
    await container.stop();
    const started = Date.now();
    await expect(redis.readiness.check()).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
