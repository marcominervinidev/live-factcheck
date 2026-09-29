# Summary: `services/gateway` (state after phase 1b)

**Responsibility (brief 5, 6):** the only public API entry (REST + WebSocket behind Caddy): sessions, text mode, provider status, pushing session events to the browser. Phase 2 adds audio forwarding to `transcription`.

**Files:**
- `main.ts` – `runService`, Redis, session store and hub, registers `api.ts` and `ws.ts`.
- `config.ts` – `REDIS_*`, `GATEWAY_TOKEN` (secret, ≥ 32 chars), `PRIVACY_MODE` (display only; workers enforce it), `WS_AUTH_TIMEOUT_MS` (5 s), `MAX_SESSION_MS` (2 h, also the session TTL), `RATE_LIMIT_CHECKS_PER_MINUTE` (20, shared via Redis).
- `auth.ts` – `bearerToken`, constant-time `tokenMatches`.
- `api.ts` – `POST /api/claims/check` (writes `ClaimDetected` to `claims.detected` and the session channel), `GET /api/status` (provider list from `status:v1:<worker>` keys), deny-by-default auth decided on the matched route (`PUBLIC_ROUTES`: ops endpoints and `/ws/session`), rate limit, error mapping to `ApiError`.
- `ws.ts` – `/ws/session`: `maxPayload` 64 KiB; the first message must be `WsAuth` within the timeout; then `sessions.create()`, `hub.join()` and `session.ready`; every valid `EventEnvelope` on `session:{id}:events` is forwarded as `WsEvent`. **Any further client message is `invalid_message` today** – phase 2 replaces this with the v2 protocol (`audio.start`, binary frames, `audio.stop`). Close codes 4400/4401/4408/4410/4500. Session ends after `MAX_SESSION_MS`.
- `sessions.ts` – `sessionStore` (Redis key `session:v1:{id}` with TTL, so any replica can serve REST for any session) and `sessionHub` (one Pub/Sub connection per gateway instance, multiplexed over its sessions; no session affinity needed).
- `normalize.ts` – text normalisation for the text-mode claim.

**Environment:** networks `frontend` (Caddy) and `internal` (Redis); no internet, no host access. Caddy routes `/api/*` and `/ws/*` here; CSP `connect-src 'self' wss://{host}`.

**Phase 2 changes (plan TP4, ADR 0015):**
- After `session.ready`: accept `audio.start` → open the internal WebSocket to `transcription` (network `internal`), then binary frames (≤ 8 KiB, rate-limited), `audio.stop`.
- Binary frames before `audio.start` → error; backpressure on the internal socket → stop with `overloaded`; recording limit → `recording_limit`.
- Closing the client socket closes the internal one; a failing `transcription` ends the recording with `audio.stopped { reason: "provider_error" }`, the session stays open (text mode keeps working).

**Pitfalls:**
- Tokens never in URLs (Caddy and Fastify log URLs); browsers cannot set headers on the WebSocket handshake.
- The `closed` flag guards races between `close` and the async session start; keep that pattern for the audio start too (a socket can close while the internal connection is being opened).
- `maxPayload` is per message: binary frames need their own, smaller check (8 KiB) inside the handler.
- Tests: `main.test.ts` (fail fast), `main.int.test.ts` (secret file, real Redis), `api.int.test.ts` (in-process gateway on port 8080 with Testcontainers Redis; `vi.waitFor` instead of `expect.poll` in hooks).
