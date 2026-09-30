# 0018: Data retention in Redis

- Status: accepted (owner, 2026-09-29)
- Date: 2026-09-29

## Context

Since phase 2, Redis holds spoken words: final transcript segments in `transcript.segments`, claims in `claims.detected` and `claims.checked`, and the claim-extractor's per-session window and claim memory (ADR 0017). The security review of PR #33 found that nothing removed them: streams were never trimmed, the extractor memory lived for two hours, and Redis wrote everything to an AOF file on a named volume, so transcripts survived restarts indefinitely. Brief 15.6 asks to keep personal data only as long as the feature needs it; long-term storage comes with Postgres in phase 4.

The pipeline handles a stream entry within seconds (`claimIdleMs` and the dead-letter limit bound retries to a few minutes). Nothing reads older entries.

## Decision

- **Streams:** every `publishEvent` trims its stream to entries younger than 15 minutes (`XADD … MINID <now − 15 min>`, exact trimming, `STREAM_RETENTION_MS` in `@lfc/service-kit`). Exact, not `~`, because approximate trimming leaves small streams untouched.
- **claim-extractor memory:** window, claim set and recent claims of a session expire 15 minutes after the session's last final segment (`EXTRACTOR_MEMORY_TTL_MS`, default 15 min, replaces `SESSION_TTL_MS` = 2 h). Every segment refreshes all three keys, so a long conversation keeps its duplicate check.
- **No persistence:** Redis runs with `--appendonly no --save ''` and `--dir /tmp` (tmpfs); the `redis-data` volume is removed. A restart starts empty.
- Unchanged and why:
  - **Verdict cache** (`verdict:v1:<sha256>`, `CHECKER_VERDICT_CACHE_TTL_S`, 7 days): the key is a hash of the normalised claim, the value holds the verdict, probabilities and web evidence, no transcript, speaker or session id.
  - **Processed markers** (7 days): only segment and claim ids.
  - **Session channel** (Pub/Sub): nothing is stored.

## Alternatives

- **Trim by length (`MAXLEN`):** bounds memory, not time; a quiet stack would keep old transcripts for days.
- **Keep AOF for crash recovery:** the only state worth recovering is in-flight work of a few seconds; it would keep every transcript on disk.
- **Delete a session's data when the recording stops:** would need a new event and a cleanup path in every service; the TTLs reach the same goal without it.

## Consequences

- A transcript entry is gone from Redis at the latest 15 minutes after it was published, and never reaches disk.
- **A Redis restart resets the daily cloud budget counter** (`budget:v1:cloud:<date>`). Worst case after a restart: one more `CLOUD_DAILY_BUDGET_USD` on the same day. Only the owner can restart Redis; accepted by the owner with this ADR. Provider-side spending limits stay the hard cap (docs/SECURITY.md).
- A restart also empties the verdict cache (more cloud calls for repeated claims) and the processed markers (a redelivered message could be handled twice; handlers are idempotent within a run).
- A consumer that is down for more than 15 minutes loses the entries published meanwhile. Acceptable for a live app: a claim that old is no longer useful on screen.
- The `MINID` threshold uses the publisher's clock; clock skew between containers only shifts the window by the skew.
- Existing installations still have the old `redis-data` volume with AOF data; remove it once with `docker volume rm live-factcheck_redis-data`.
