# AGENTS.md – packages/service-kit

Rules for this package only. Repo-wide rules: `/AGENTS.md`.

- This is the shared runtime of every Node service. Services start via `runService()` and do not re-implement config loading, logging, ops endpoints, Redis setup or shutdown.
- Config: extend `baseConfigSchema`; every secret key goes into `secretKeys` so it can come from `<KEY>_FILE` and is redacted. Never add defaults that hide a missing required value.
- Logging: only `createLogger()`. Never log config objects, request bodies or transcript text on purpose; redaction is the second line of defence, not the first.
- `ConfigError` messages name variables, never values. Keep it that way in every new check.
- `/readyz` returns only check names and `ok`/`failed`; error details go to the log.
- `REDIS_URL` never contains credentials; the password is a separate secret.
- Public API = `src/index.ts` plus the `./healthcheck` entry point. Anything else is internal; add new exports deliberately.
- Tests: unit tests use real files and real child processes (see `lifecycle.test.ts`), integration tests (`*.int.test.ts`) use Testcontainers. No mocks of internal modules.
- Streams: publish only with `publishEvent` (validates the envelope, mirrors to the session channel) and consume only with `startStreamConsumer` (`XACK` after success, `XAUTOCLAIM` for stale entries, invalid entries acknowledged and logged). Handlers throw only for failures worth a retry and use `processedMarker` to stay idempotent.
