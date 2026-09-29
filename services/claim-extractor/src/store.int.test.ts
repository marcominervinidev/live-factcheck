// Stage 2a: the session store of the claim-extractor against a real Redis (ADR 0017), in-process.
import { randomBytes, randomUUID } from 'node:crypto';

import type { TranscriptSegment } from '@lfc/contracts';
import { RedisContainer } from '@testcontainers/redis';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { redisSessionStore } from './store.js';

const PASSWORD = randomBytes(16).toString('hex');

describe('redisSessionStore against a real Redis', () => {
  let container: StartedRedisContainer;
  let redis: Redis;

  beforeAll(async () => {
    container = await new RedisContainer('redis:8.10.2-alpine').withPassword(PASSWORD).start();
    redis = new Redis(container.getMappedPort(6379), container.getHost(), { password: PASSWORD });
  });

  afterAll(async () => {
    redis.disconnect();
    await container.stop();
  });

  const store = () => redisSessionStore(redis, { windowSize: 3, candidates: 2, ttlMs: 60_000 });
  const segment = (sessionId: string, text: string, startMs: number): TranscriptSegment => ({
    schemaVersion: 1,
    sessionId,
    segmentId: randomUUID(),
    speaker: 'A',
    text,
    startMs,
    endMs: startMs + 1_000,
    isFinal: true,
    language: 'de',
  });

  it('keeps the last segments per session, sorted by time, idempotent, with a TTL', async () => {
    const sessionId = randomUUID();
    const s = store();
    const late = segment(sessionId, 'drei', 3_000);
    await s.addToWindow(segment(sessionId, 'eins', 1_000));
    await s.addToWindow(late);
    await s.addToWindow(late); // redelivered: not added twice
    const window = await s.addToWindow(segment(sessionId, 'zwei', 2_000)); // out of order
    expect(window.map((w) => w.text)).toEqual(['eins', 'zwei', 'drei']);

    const trimmed = await s.addToWindow(segment(sessionId, 'vier', 4_000));
    expect(trimmed.map((w) => w.text)).toEqual(['zwei', 'drei', 'vier']);
    expect(await redis.pttl(`extractor:v1:window:${sessionId}`)).toBeGreaterThan(0);
    // Other sessions are separate.
    expect(await s.addToWindow(segment(randomUUID(), 'andere', 0))).toHaveLength(1);
  });

  it('skips a corrupt window entry instead of failing', async () => {
    const sessionId = randomUUID();
    await redis.rpush(`extractor:v1:window:${sessionId}`, '{not json', '{"segmentId":1}');
    const window = await store().addToWindow(segment(sessionId, 'gültig', 0));
    expect(window.map((w) => w.text)).toEqual(['gültig']);
  });

  it('remembers claims per session and keeps only the recent candidates', async () => {
    const sessionId = randomUUID();
    const s = store();
    expect(await s.hasClaim(sessionId, 'a')).toBe(false);
    await s.addClaim(sessionId, 'a', 'Satz A.');
    await s.addClaim(sessionId, 'b', 'Satz B.');
    await s.addClaim(sessionId, 'c', 'Satz C.');
    expect(await s.hasClaim(sessionId, 'a')).toBe(true);
    expect(await s.hasClaim(randomUUID(), 'a')).toBe(false);
    expect(await s.recentClaims(sessionId)).toEqual(['Satz C.', 'Satz B.']);
    expect(await redis.pttl(`extractor:v1:claims:${sessionId}`)).toBeGreaterThan(0);
  });

  it('keeps the claim memory alive while segments arrive and lets it expire when idle (ADR 0018)', async () => {
    const sessionId = randomUUID();
    const s = redisSessionStore(redis, { windowSize: 3, candidates: 2, ttlMs: 60_000 });
    await s.addClaim(sessionId, 'a', 'Satz A.');
    // Simulate an idle stretch: the claim memory is about to expire.
    await redis.pexpire(`extractor:v1:claims:${sessionId}`, 1_000);
    await redis.pexpire(`extractor:v1:recent:${sessionId}`, 1_000);

    await s.addToWindow(segment(sessionId, 'weiter', 0));

    for (const key of ['window', 'claims', 'recent']) {
      expect(await redis.pttl(`extractor:v1:${key}:${sessionId}`)).toBeGreaterThan(50_000);
    }
  });
});
