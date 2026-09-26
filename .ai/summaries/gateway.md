# Summary: `services/gateway` (state after phase 0)

**Responsibility (brief 5, 6):** the only public API entry (REST + WebSocket behind Caddy): sessions, text mode, pushing session events to the browser; later audio forwarding to `transcription`.

**Current state:** skeleton. `main.ts` runs `runService` with Redis readiness; `config.ts` = base config + `REDIS_URL`, `REDIS_USERNAME`, `REDIS_PASSWORD` (secret). No routes besides the ops endpoints.

**Environment:** networks `frontend` (Caddy) and `internal` (Redis); no internet. Caddy routes `/api/*` and `/ws/*` here; CSP `connect-src 'self' wss://{host}`. Secret `gateway_token` already exists in `secrets-init` but is not mounted yet.

**Phase 1 adds:** token auth (REST header, WS first message), `POST /api/claims/check`, `/ws/session`, `GET /api/status`, rate limit, size limits, Pub/Sub fan-out.

**Pitfalls:**
- Tokens never in URLs (Caddy and Fastify log URLs).
- Browsers cannot set headers on the WebSocket handshake.
- Fastify body limit is 64 KiB globally (service-kit); text mode needs far less, set a route limit.
- Tests: `main.test.ts` (fail fast), `main.int.test.ts` (secret file, real Redis).
