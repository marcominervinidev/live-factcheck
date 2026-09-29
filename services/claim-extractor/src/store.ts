import type { TranscriptSegment } from '@lfc/contracts';
import type { Redis } from 'ioredis';
import { z } from 'zod';

/** What the window keeps per segment: enough for context, nothing more (ADR 0017). */
export interface WindowSegment {
  readonly segmentId: string;
  readonly speaker: string;
  readonly text: string;
  readonly startMs: number;
}

const WindowSegmentSchema = z.strictObject({
  segmentId: z.string(),
  speaker: z.string(),
  text: z.string(),
  startMs: z.number(),
});

/**
 * Per-session state of the extractor in Redis, so any replica can handle any segment and a
 * restart loses nothing (factor VI). Keys expire with the session.
 */
export interface SessionStore {
  /** Adds the segment (idempotent by id) and returns the window, oldest first, including it. */
  addToWindow(segment: TranscriptSegment): Promise<readonly WindowSegment[]>;
  /** True when the session already has a claim with exactly this normalised text. */
  hasClaim(sessionId: string, normalizedText: string): Promise<boolean>;
  /** The standalone texts of the session's most recent claims, newest first. */
  recentClaims(sessionId: string): Promise<readonly string[]>;
  addClaim(sessionId: string, normalizedText: string, standaloneText: string): Promise<void>;
}

export interface SessionStoreOptions {
  readonly windowSize: number;
  readonly candidates: number;
  readonly ttlMs: number;
}

const windowKey = (sessionId: string) => `extractor:v1:window:${sessionId}`;
const claimsKey = (sessionId: string) => `extractor:v1:claims:${sessionId}`;
const recentKey = (sessionId: string) => `extractor:v1:recent:${sessionId}`;

function parseWindow(entries: readonly string[]): WindowSegment[] {
  const segments: WindowSegment[] = [];
  for (const entry of entries) {
    try {
      const parsed = WindowSegmentSchema.safeParse(JSON.parse(entry));
      if (parsed.success) segments.push(parsed.data);
    } catch {
      // A corrupt entry only costs context; the segment itself is still handled.
    }
  }
  return segments;
}

export function redisSessionStore(redis: Redis, options: SessionStoreOptions): SessionStore {
  return {
    async addToWindow(segment) {
      const key = windowKey(segment.sessionId);
      const current = parseWindow(await redis.lrange(key, 0, -1));
      if (!current.some((s) => s.segmentId === segment.segmentId)) {
        const entry: WindowSegment = {
          segmentId: segment.segmentId,
          speaker: segment.speaker,
          text: segment.text,
          startMs: segment.startMs,
        };
        await redis
          .multi()
          .rpush(key, JSON.stringify(entry))
          .ltrim(key, -options.windowSize, -1)
          .pexpire(key, options.ttlMs)
          .exec();
        current.push(entry);
      }
      // Segments can arrive out of order with several consumers (pipeline summary).
      return current.slice(-options.windowSize).sort((a, b) => a.startMs - b.startMs);
    },
    async hasClaim(sessionId, normalizedText) {
      return (await redis.sismember(claimsKey(sessionId), normalizedText)) === 1;
    },
    recentClaims(sessionId) {
      return redis.lrange(recentKey(sessionId), 0, options.candidates - 1);
    },
    async addClaim(sessionId, normalizedText, standaloneText) {
      await redis
        .multi()
        .sadd(claimsKey(sessionId), normalizedText)
        .pexpire(claimsKey(sessionId), options.ttlMs)
        .lpush(recentKey(sessionId), standaloneText)
        .ltrim(recentKey(sessionId), 0, options.candidates - 1)
        .pexpire(recentKey(sessionId), options.ttlMs)
        .exec();
    },
  };
}
