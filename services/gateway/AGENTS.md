# AGENTS.md – services/gateway

Rules for this service only. Repo-wide rules: `/AGENTS.md`. This service is the **reference service**: the skill `new-service` copies its structure, so keep it exemplary.

- Responsibility (brief 5, 6): the only public API entry point (REST + WebSocket), session handling, audio forwarding to `transcription`, pushing session events to clients. In phase 0 it only has the ops endpoints and a Redis connection.
- Startup and shutdown go through `runService()` from `@lfc/service-kit`; `src/main.ts` stays a thin wiring file.
- Config lives in `src/config.ts` (`baseConfigSchema.extend`). Secrets listed in `secretKeys`: `REDIS_PASSWORD` (via `REDIS_PASSWORD_FILE` in containers).
- Tests live next to the code: `src/*.test.ts` (unit, real child process via `@lfc/service-kit/testing`), `src/*.int.test.ts` (Testcontainers).
- Dockerfile: build context is the repo root; stages `dev` and `runtime`. Runtime runs as uid 65532 with root-owned, read-only code. Change the service name only via `ARG SERVICE`.
- From phase 1 on: authenticate every REST and WebSocket request with the gateway token from a header, never from the URL (brief 15.5); validate every payload with `@lfc/contracts`.
