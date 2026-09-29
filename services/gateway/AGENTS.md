# AGENTS.md – services/gateway

Rules for this service only. Repo-wide rules: `/AGENTS.md`. This service is the **reference service**: the skill `new-service` copies its structure, so keep it exemplary.

- Responsibility (brief 5, 6): the only public API entry point (REST + WebSocket), session handling, audio forwarding to `transcription`, pushing session events to clients. Phase 1: token auth (ADR 0011), `POST /api/claims/check`, `GET /api/status`, `/ws/session` with Pub/Sub fan-out. `src/api.ts` (REST), `src/ws.ts` (WebSocket), `src/sessions.ts` (session records and the per-instance Pub/Sub hub), `src/main.ts` wiring only.
- Startup and shutdown go through `runService()` from `@lfc/service-kit`; `src/main.ts` stays a thin wiring file.
- Config lives in `src/config.ts` (`baseConfigSchema.extend`). Secrets listed in `secretKeys`: `REDIS_PASSWORD`, `GATEWAY_TOKEN` (via `<KEY>_FILE` in containers).
- Tests live next to the code: `src/*.test.ts` (unit, real child process via `@lfc/service-kit/testing`), `src/*.int.test.ts` (Testcontainers).
- Dockerfile: build context is the repo root; stages `dev` and `runtime`. Runtime runs as uid 65532 with root-owned, read-only code. Change the service name only via `ARG SERVICE`.
- From phase 1 on: authenticate every REST and WebSocket request with the gateway token from a header, never from the URL (brief 15.5); validate every payload with `@lfc/contracts`.
- Every error leaves as `ApiError` with a stable code; WebSocket errors as `error` messages with close codes 44xx. Never put internals into messages.
- Never log claim text or tokens; log session and claim ids only (brief 15.6).
- Sessions are records in Redis, events arrive via Pub/Sub, so any replica can serve any request (no session affinity needed; brief 5).
- Audio (phase 2, ADR 0015): `src/audio.ts` holds one recording per session and forwards it over an internal WebSocket to `transcription` (`TRANSCRIPTION_URL`). Never buffer audio: a slow internal socket, a frame rate above real time or the recording limit end the **recording** with `audio.stopped`; an oversized frame is dropped with an error. Audio errors never end the session; only a second `auth` or an invalid message closes it. Every audio error code has its own integration test in `src/api.int.test.ts`.
