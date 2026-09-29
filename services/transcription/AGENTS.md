# AGENTS.md – services/transcription

Rules for this service only. Repo-wide rules: `/AGENTS.md`. Structure copied from the reference service `services/gateway`.

- Responsibility (brief 5, 6, 10; ADR 0015, 0016): the internal WebSocket `/v1/audio` takes one recording per connection from the gateway (`start`, binary PCM16 frames, `stop`), streams it to the configured `SttProvider` (`@lfc/providers`: `deepgram`, `assemblyai`, `local` → `stt-local`, `mock`) and publishes **final** segments to `transcript.segments` and the session channel, **interim** segments only to the session channel (`publishToSession`). Interim and final segments of one utterance share the `segmentId`.
- Never store audio and never log transcript text (brief 15.6); logs carry ids, byte counts and durations only.
- Cloud STT is booked against `CLOUD_DAILY_BUDGET_USD` in 10 s steps of audio; a used-up budget stops the recording with `budget_exceeded`. A provider that falls behind (`STT_MAX_BUFFERED_BYTES`) stops it with `overloaded` – never buffer without limit.
- Publishes its provider to `status:v1:transcription` (role `stt`) for the settings page and the consent dialog.
- Startup and shutdown go through `runService()` from `@lfc/service-kit`; `src/main.ts` stays a thin wiring file.
- Config lives in `src/config.ts` (`baseConfigSchema.extend`). Secrets listed in `secretKeys`: `REDIS_PASSWORD`, `DEEPGRAM_API_KEY`, `ASSEMBLYAI_API_KEY` (via `<KEY>_FILE` in containers; nothing else, brief 15.1).
- Tests live next to the code: `src/*.test.ts` (unit, real child process via `@lfc/service-kit/testing`), `src/*.int.test.ts` (Testcontainers).
- Dockerfile: build context is the repo root; stages `dev` and `runtime`. Runtime runs as uid 65532 with root-owned, read-only code. Change the service name only via `ARG SERVICE`.
