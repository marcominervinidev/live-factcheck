// Stage 2a: the stream helpers against a real Redis (brief 4.1 factor IX, 13.2).
import { randomBytes, randomUUID } from 'node:crypto';

import type { EventEnvelope } from '@lfc/contracts';
import { sessionEventsChannel } from '@lfc/contracts';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { StreamConsumer, StreamMessage } from './streams.js';
import { processedMarker, publishEvent, startStreamConsumer } from './streams.js';
import { silentLogger } from './testing/silent-logger.js';

const PASSWORD = randomBytes(12).toString('hex');

const detected = (sessionId = randomUUID()): EventEnvelope => ({
  type: 'claim.detected',
  schemaVersion: 2,
  payload: {
    schemaVersion: 2,
    sessionId,
    claimId: randomUUID(),
    speaker: 'A',
    originalText: 'Der Krieg endete 1965.',
    standaloneText: 'Der Zweite Weltkrieg endete 1965.',
    normalizedText: 'der zweite weltkrieg endete 1965',
    checkworthiness: 1,
    sourceSegmentIds: [],
    detectedAt: '2026-09-26T10:00:00.000Z',
    provider: { classifier: 'text-mode', model: 'none' },
  },
});

describe('Redis Streams helpers against a real Redis', () => {
  let container: StartedRedisContainer;
  const clients: Redis[] = [];
  const consumers: StreamConsumer[] = [];
  const connect = () => {
    const client = new Redis(container.getMappedPort(6379), container.getHost(), {
      password: PASSWORD,
    });
    clients.push(client);
    return client;
  };
  // Own stream and group per test: tests can run in parallel (brief 13.1).
  const names = () => ({
    stream: `test:${randomBytes(4).toString('hex')}:claims`,
    group: 'checker',
  });

  const consume = (
    redis: Redis,
    stream: string,
    group: string,
    handle: (message: StreamMessage) => Promise<void>,
    consumer = `c-${randomBytes(2).toString('hex')}`,
    claimIdleMs = 60_000,
  ) => {
    const started = startStreamConsumer({
      redis,
      stream,
      group,
      consumer,
      logger: silentLogger(),
      handle,
      blockMs: 100,
      claimIdleMs,
    });
    consumers.push(started);
    return started;
  };

  beforeAll(async () => {
    container = await new RedisContainer('redis:8.10.2-alpine').withPassword(PASSWORD).start();
  });

  afterAll(async () => {
    await Promise.all(consumers.map((c) => c.stop()));
    clients.forEach((c) => {
      c.disconnect();
    });
    await container.stop();
  });

  it('delivers a published event, acknowledges it and mirrors it to the session channel', async () => {
    const redis = connect();
    const subscriber = connect();
    const { stream, group } = names();
    const event = detected();
    const channelMessages: string[] = [];
    await subscriber.subscribe(sessionEventsChannel(event.payload.sessionId));
    subscriber.on('message', (_channel, message: string) => channelMessages.push(message));

    const received: StreamMessage[] = [];
    consume(redis, stream, group, (message) => {
      received.push(message);
      return Promise.resolve();
    });
    await publishEvent(redis, stream, event, { toSession: true });

    await expect.poll(() => received.length).toBe(1);
    expect(received[0]?.event).toEqual(event);
    await expect.poll(() => channelMessages.length).toBe(1);
    expect(JSON.parse(channelMessages[0] ?? '{}')).toEqual(event);
    await expect.poll(async () => ((await redis.xpending(stream, group)) as [number])[0]).toBe(0);
  });

  it('refuses to publish an invalid envelope (producer-side validation)', async () => {
    const redis = connect();
    const { stream } = names();
    const invalid = { ...detected(), schemaVersion: 1 } as unknown as EventEnvelope;
    await expect(publishEvent(redis, stream, invalid)).rejects.toThrow();
    expect(await redis.exists(stream)).toBe(0);
  });

  it('keeps a message pending when the handler fails; another consumer claims it later', async () => {
    const redis = connect();
    const { stream, group } = names();
    consume(
      redis,
      stream,
      group,
      () => Promise.reject(new Error('temporary failure')),
      'crashy',
      60_000,
    );
    await publishEvent(redis, stream, detected());
    await expect.poll(async () => ((await redis.xpending(stream, group)) as [number])[0]).toBe(1);

    const recovered: string[] = [];
    consume(
      connect(),
      stream,
      group,
      (message) => {
        recovered.push(message.id);
        return Promise.resolve();
      },
      'rescuer',
      0,
    );
    await expect.poll(() => recovered.length, { timeout: 5_000 }).toBe(1);
    await expect.poll(async () => ((await redis.xpending(stream, group)) as [number])[0]).toBe(0);
  });

  it('acknowledges and skips an entry that is not a valid envelope', async () => {
    const redis = connect();
    const { stream, group } = names();
    const received: string[] = [];
    consume(redis, stream, group, (message) => {
      received.push(message.id);
      return Promise.resolve();
    });
    await redis.xadd(stream, '*', 'data', '{"type":"claim.deleted"}');
    await redis.xadd(stream, '*', 'data', 'not json');
    await publishEvent(redis, stream, detected());

    await expect.poll(() => received.length).toBe(1);
    await expect.poll(async () => ((await redis.xpending(stream, group)) as [number])[0]).toBe(0);
  });

  it('marks processed ids for idempotent handlers', async () => {
    const marker = processedMarker(connect(), `test-${randomBytes(3).toString('hex')}`, 60);
    const id = randomUUID();
    expect(await marker.isProcessed(id)).toBe(false);
    await marker.markProcessed(id);
    expect(await marker.isProcessed(id)).toBe(true);
  });

  it('stop() waits for the message in progress', async () => {
    const redis = connect();
    const { stream, group } = names();
    let finished = false;
    const consumer = consume(redis, stream, group, async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      finished = true;
    });
    await publishEvent(redis, stream, detected());
    await expect.poll(async () => ((await redis.xpending(stream, group)) as [number])[0]).toBe(1);
    await consumer.stop();
    expect(finished).toBe(true);
  });
});
