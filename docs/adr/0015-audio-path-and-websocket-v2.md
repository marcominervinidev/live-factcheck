# 0015: Audio path and WebSocket protocol v2

- Status: proposed
- Date: 2026-09-29

## Context

Phase 2 streams microphone audio from the browser to a speech-to-text provider (brief 6.2–6.4, 10). The WebSocket `/ws/session` (ADR 0010, 0011) so far accepts exactly one client message, `auth`. Brief 15.5 requires size limits, validation of every payload, rate limiting, a maximum duration and a daily budget for cloud STT; brief 15.6 forbids storing audio and logging transcripts. Research: `.ai/research/browser-audio.md`, `.ai/research/stt-providers.md`.

## Decision

**Client → gateway (`/ws/session`, protocol v2, `schemaVersion: 2`):**

1. `auth` (unchanged semantics) → `session.ready`.
2. `audio.start { sampleRate: 16000, encoding: "pcm16", channels: 1, language: "de" }` → the gateway opens the internal connection to `transcription` and answers `audio.started`.
3. Binary messages: raw PCM16 LE mono 16 kHz, nominally 100 ms (3200 bytes). Limits: at most 8 KiB per frame and 20 frames per second on average over 5 s. Binary data before `audio.start` or after `audio.stop` is an error.
4. `audio.stop` → the gateway flushes and closes the internal connection and answers `audio.stopped { reason: "client" }`.

Only one recording per session at a time; after `audio.stopped` a new `audio.start` is allowed. Text mode keeps working throughout.

**Server → client:** `audio.started`, `audio.stopped { reason }` with `reason` ∈ `client`, `recording_limit`, `overloaded`, `budget_exceeded`, `provider_error`, `privacy_mode`; errors keep the `error` message with new codes `audio_not_started`, `frame_too_large`, `frame_rate_exceeded`. Transcript segments reach the client as the existing `event` messages carrying `transcript.segment` envelopes (interim: `isFinal: false`).

**Gateway → `transcription` (internal, network `internal` only):** one WebSocket per recording to `ws://transcription:8080/v1/audio`. First message `{ type: "start", sessionId, recordingId, sampleRate, encoding, channels, language }` (schema in `packages/contracts/src/internal-audio.ts`), then the client's binary frames unchanged, then `{ type: "stop" }`. `transcription` answers `ready`, `stopped { reason }` or `error { code }`. No token: the network is internal (same trust model as Redis access; revisited with NetworkPolicies in phase 5).

**Backpressure:** the gateway does not buffer audio. If the internal socket's send buffer exceeds 64 KiB (≈ 2 s of audio), the recording is stopped with `overloaded` instead of silently dropping audio.

**Limits and budget:** `MAX_RECORDING_MINUTES` (default 60) ends a recording with `recording_limit`. Cloud STT is priced per audio second (`packages/providers/src/pricing.ts`) and booked by `transcription` against `CLOUD_DAILY_BUDGET_USD`, in the same Redis counter as LLM calls; when it is used up the recording ends with `budget_exceeded`.

**Transcript events:** `transcription` publishes final segments with `publishEvent(…, { toSession: true })` to `transcript.segments`; interim segments only to the session channel via a new `publishToSession` helper (brief 6.4). Audio is never written to disk or Redis; transcript text never appears in logs (`LOG_TRANSCRIPTS=false`, only lengths and ids).

## Alternatives

- **Browser → STT provider directly** (temporary provider token in the browser): less latency and no audio through our backend, but the provider becomes visible to the client, the budget and privacy mode can no longer be enforced server side, and CSP `connect-src` would need third-party hosts. Rejected.
- **Audio over Redis (Streams or Pub/Sub):** decouples gateway and `transcription`, but puts 32 KB/s per recording through Redis and needs ordering and cleanup; the brief names an internal WebSocket. Rejected for now; revisit if horizontal scaling of `transcription` needs it (phase 5).
- **Gateway and `transcription` as one service** (brief 5 allows proposing it): fewer hops, but mixes the public edge with provider credentials and egress; the gateway would then need internet access. Rejected.
- **Opus/WebM compression from `MediaRecorder`:** 5–10× less bandwidth, but providers and `stt-local` then need decoding, Safari's `MediaRecorder` formats differ, and LAN bandwidth is not the bottleneck. Rejected; PCM16 as in brief 6.2.

## Consequences

- Contract change: `WsClientMessage` / `WsServerMessage` v2 (own commit, contract tests, CI contract check). The web app and the stage 3 helpers switch to v2 in the same phase; v1 clients are rejected with `invalid_message`.
- `transcription` needs egress (cloud STT) and the provider secrets; the gateway stays without internet.
- One recording is bound to one `transcription` connection; a crashed `transcription` ends the recording (the client can start a new one). With several replicas in Kubernetes, connection-level load balancing is sufficient.
- We will notice a wrong frame budget in stage 4 (Chromium sends at its own pace) and on the iPhone smoke test.
