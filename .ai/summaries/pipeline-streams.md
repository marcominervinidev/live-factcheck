# Summary: event pipeline on Redis (state after phase 1b)

**Responsibility (brief 4.1 factor IX, 6, 7):** services talk only through Redis Streams (work, at-least-once) and the Pub/Sub channel `session:{sessionId}:events` (push to the browser). Contracts in `packages/contracts/src/envelope.ts`, helpers in `packages/service-kit/src/streams.ts`.

**Streams (`STREAMS`):** `transcript.segments`, `claims.detected`, `claims.checked`, `claims.explained`, `topics.detected` (phase 4). Every entry has one field holding the JSON of an `EventEnvelope` v2 (`{ type, schemaVersion: 2, payload }`; types `transcript.segment`, `claim.detected`, `claim.checked`, `claim.explained`, `topic.detected`).

**Producers:** `publishEvent(redis, stream, event, { toSession })` validates the envelope, then `XADD` and (if `toSession`) `PUBLISH` to the session channel in one `MULTI`. There is **no helper for "channel only"** yet – phase 2 needs one for interim transcript segments, which must not enter the stream (brief 6.4): add `publishToSession(redis, event)` in `streams.ts` with the same validation.

**Consumers:** `startStreamConsumer({ redis, stream, group, consumer, logger, handle, batchSize, blockMs, claimIdleMs, maxDeliveries })`:
- consumer group created in the background (retries while Redis is down), `XREADGROUP` with blocking reads on a duplicated connection;
- `XACK` only after `handle` succeeded; throwing leaves the message pending;
- `XAUTOCLAIM` takes over entries idle longer than `claimIdleMs` (must exceed batch × longest handler run);
- delivered more than `maxDeliveries` (default 3) → logged as dead letter and acknowledged;
- invalid entries are logged and acknowledged so they cannot block the group.
- `processedMarker(redis, namespace, ttl)` makes handlers idempotent (check before work, mark after publishing, before `XACK`).

**Current consumers:** `fact-checker` (`claims.detected` → `claims.checked`), `explainer` (`claims.checked` → `claims.explained`). Their `claimIdleMs` = configured timeout + 30 s.

**Phase 2 adds:**
- `transcription` produces `transcript.segments` (finals, with `toSession`) and channel-only interim segments.
- `claim-extractor` consumes `transcript.segments` (group `claim-extractor`), keeps a per-session window in Redis (TTL) and produces `claims.detected` with `toSession`.

**Pitfalls:**
- Order across sessions is not guaranteed with several consumers; within one session the extractor must tolerate out-of-order segments (sort the window by `startMs`).
- A handler that calls an LLM must be idempotent (dead letters and `XAUTOCLAIM` can redeliver).
- Tests use their own stream and key prefixes per test (brief 13.1).
