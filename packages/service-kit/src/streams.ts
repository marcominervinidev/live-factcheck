import { EventEnvelope, sessionEventsChannel } from '@lfc/contracts';
import type { Redis } from 'ioredis';

import type { Logger } from './logger.js';

/** Field that carries the JSON envelope in every stream entry. */
const DATA_FIELD = 'data';

/**
 * Publishes an event to its stream and, for client-relevant events, to the session channel
 * (brief 6, 6.7). The envelope is validated before it leaves the producer (contract-first).
 */
export async function publishEvent(
  redis: Redis,
  stream: string,
  event: EventEnvelope,
  options: { readonly toSession?: boolean } = {},
): Promise<string> {
  const envelope = EventEnvelope.parse(event);
  const json = JSON.stringify(envelope);
  const multi = redis.multi().xadd(stream, '*', DATA_FIELD, json);
  if (options.toSession === true) {
    multi.publish(sessionEventsChannel(envelope.payload.sessionId), json);
  }
  const results = await multi.exec();
  const [xaddError, id] = results?.[0] ?? [new Error('XADD returned nothing'), null];
  if (xaddError !== null) throw xaddError;
  if (typeof id !== 'string') throw new Error('XADD returned no entry id');
  return id;
}

export interface StreamMessage {
  readonly id: string;
  readonly event: EventEnvelope;
}

export interface StreamConsumerOptions {
  readonly redis: Redis;
  readonly stream: string;
  readonly group: string;
  /** Unique per replica, e.g. `${hostname}-${pid}`. */
  readonly consumer: string;
  readonly logger: Logger;
  /** Work on one message. Throw only for failures worth a retry; the message then stays pending. */
  readonly handle: (message: StreamMessage) => Promise<void>;
  readonly batchSize?: number;
  readonly blockMs?: number;
  /** Pending messages idle longer than this are taken over from crashed consumers (XAUTOCLAIM). */
  readonly claimIdleMs?: number;
}

export interface StreamConsumer {
  /** Stops reading, waits for the message in progress and releases the blocking connection. */
  stop(): Promise<void>;
}

type RawEntry = [id: string, fields: string[]];

/** Resolves when the client is connected, or after `ms` (the next command then reports why). */
async function waitReady(client: Redis, ms: number): Promise<void> {
  if (client.status === 'ready') return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      client.off('ready', done);
      resolve();
    }
    client.once('ready', done);
  });
}

/**
 * At-least-once consumer on a Redis Streams consumer group (brief 4.1 factor IX). Returns at
 * once; the group is created (or found) in the background, retried while Redis is unreachable.
 * `XACK` only after the handler succeeded, stale pending messages taken over with
 * `XAUTOCLAIM`, invalid entries logged and acknowledged so they cannot block the group.
 * Handlers make processing idempotent (e.g. by `claimId`).
 */
export function startStreamConsumer(options: StreamConsumerOptions): StreamConsumer {
  const { redis, stream, group, consumer, logger } = options;
  const batchSize = options.batchSize ?? 10;
  const blockMs = options.blockMs ?? 5_000;
  const claimIdleMs = options.claimIdleMs ?? 60_000;

  // Blocking reads get their own connection so stop() can interrupt them.
  const reader = redis.duplicate();
  // An object, because the flag changes asynchronously in stop() (TS narrows plain locals).
  const state = { stopping: false };
  const isStopping = () => state.stopping;
  let inFlight: Promise<void> = Promise.resolve();

  const process = async (entries: readonly RawEntry[]) => {
    for (const [id, fields] of entries) {
      if (state.stopping) return;
      const raw = fields[fields.indexOf(DATA_FIELD) + 1];
      let parsed: ReturnType<typeof EventEnvelope.safeParse> | undefined;
      try {
        parsed = raw === undefined ? undefined : EventEnvelope.safeParse(JSON.parse(raw));
      } catch {
        parsed = undefined;
      }
      if (!parsed?.success) {
        logger.error(
          { stream, group, entryId: id },
          'invalid stream entry, acknowledged and skipped',
        );
        await redis.xack(stream, group, id);
        continue;
      }
      try {
        await options.handle({ id, event: parsed.data });
        await redis.xack(stream, group, id);
      } catch (error) {
        // Stays pending; another consumer (or this one) claims it after claimIdleMs.
        logger.error(
          { err: error, stream, group, entryId: id },
          'handler failed, message stays pending',
        );
      }
    }
  };

  const claimStale = async () => {
    const result = (await redis.xautoclaim(
      stream,
      group,
      consumer,
      claimIdleMs,
      '0-0',
      'COUNT',
      batchSize,
    )) as [string, RawEntry[], string[]?];
    const claimed = result[1].filter((entry): entry is RawEntry => Array.isArray(entry[1]));
    if (claimed.length > 0) {
      logger.info({ stream, group, count: claimed.length }, 'claimed stale pending messages');
      await process(claimed);
    }
  };

  let groupReady = false;
  const ensureGroup = async () => {
    try {
      // Start at 0: a new group also processes entries published before it existed.
      await redis.xgroup('CREATE', stream, group, '0', 'MKSTREAM');
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('BUSYGROUP')) throw error;
    }
    groupReady = true;
  };

  const loop = async () => {
    let round = 0;
    while (!state.stopping) {
      try {
        // The service-kit client has no offline queue (honest readiness): wait until Redis is
        // reachable instead of failing the service start (retried below).
        if (!groupReady) await ensureGroup();
        await waitReady(reader, blockMs);
        if (round % 10 === 0) await claimStale();
        round++;
        const response = (await reader.xreadgroup(
          'GROUP',
          group,
          consumer,
          'COUNT',
          batchSize,
          'BLOCK',
          blockMs,
          'STREAMS',
          stream,
          '>',
        )) as [string, RawEntry[]][] | null;
        const entries = response?.[0]?.[1] ?? [];
        if (entries.length > 0) {
          inFlight = process(entries);
          await inFlight;
        }
      } catch (error) {
        if (isStopping()) return;
        logger.error({ err: error, stream, group }, 'stream read failed, retrying');
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
  };

  const running = loop();
  logger.info({ stream, group, consumer }, 'stream consumer started');

  return {
    async stop() {
      state.stopping = true;
      await inFlight;
      reader.disconnect();
      await running;
    },
  };
}

/**
 * Idempotency marker per message key (brief 4.1 factor IX: detect duplicates via `claimId`).
 * Check before the work, mark after publishing and before `XACK`.
 */
export function processedMarker(redis: Redis, namespace: string, ttlSeconds: number) {
  const key = (id: string) => `processed:v1:${namespace}:${id}`;
  return {
    async isProcessed(id: string): Promise<boolean> {
      return (await redis.exists(key(id))) === 1;
    },
    async markProcessed(id: string): Promise<void> {
      await redis.set(key(id), '1', 'EX', ttlSeconds);
    },
  };
}
