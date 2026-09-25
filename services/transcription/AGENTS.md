# AGENTS.md – services/transcription

Rules for this service only. Repo-wide rules: `/AGENTS.md`. Structure copied from the reference service `services/gateway`.

- Responsibility (brief 5, 6): streaming speech-to-text via provider adapters or forwarding to `stt-local`; publishes final transcript segments with speaker labels to the Redis stream `transcript.segments` (from phase 2 on). In phase 0 it only has the ops endpoints and a Redis connection.
- Startup and shutdown go through `runService()` from `@lfc/service-kit`; `src/main.ts` stays a thin wiring file.
- Config lives in `src/config.ts` (`baseConfigSchema.extend`). Secrets listed in `secretKeys`: `REDIS_PASSWORD` (via `REDIS_PASSWORD_FILE` in containers).
- Tests live next to the code: `src/*.test.ts` (unit, real child process via `@lfc/service-kit/testing`), `src/*.int.test.ts` (Testcontainers).
- Dockerfile: build context is the repo root; stages `dev` and `runtime`. Runtime runs as uid 65532 with root-owned, read-only code. Change the service name only via `ARG SERVICE`.
