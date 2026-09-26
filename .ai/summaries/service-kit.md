# Summary: `packages/service-kit` (state after phase 0)

**Responsibility:** everything every Node service shares: config loading, logging, ops HTTP server, Redis connection, lifecycle. No business logic.

**Data flow:** `runService(definition)` → `loadConfig(schema, { secretKeys })` (exit 1 with `ConfigError` issues on failure) → pino logger with redaction → Fastify with `/healthz`, `/readyz`, `/metrics` → `definition.start(ctx)` returns `{ readiness, stop }` → listen on `PORT` → SIGTERM/SIGINT: close HTTP, `stop()`, exit 0 (timeout `SHUTDOWN_TIMEOUT_MS` → exit 1).

**Central types:**
- `baseConfigSchema` (`PORT`, `LOG_LEVEL`, `SHUTDOWN_TIMEOUT_MS`); services `extend` it. `ServiceConfigSchema = z.ZodObject & z.ZodType<BaseConfig>` enforces the base fields by type.
- `loadConfig`: `<KEY>_FILE` for every secret key (both set = error), file content trimmed, empty string = not set; returns `secretValues` for scrubbing.
- `createLogger({ service, level, secretKeys, secretValues })`: pino `redact` on secret keys and common paths **plus** a stream hook that replaces any secret value in every line.
- `createHttpServer` → Fastify instance (`HttpServer`); services add routes on `ctx.http`. Body limit 64 KiB. Ops paths are not request-logged.
- `createRedis({ url, username, password, logger })` → `{ client, readiness, close }`; ioredis fail-fast (`enableOfflineQueue: false`, `maxRetriesPerRequest: 1`); rejects credentials in the URL.
- `@lfc/service-kit/testing`: `startServiceProcess`, `freePort`, `jsonLines`, `silentLogger` (tests only).

**Pitfalls:**
- Every secret must be listed in `secretKeys`, otherwise neither `_FILE` nor scrubbing works.
- Readiness checks must reject, not hang (1 s timeout per check).
- No Redis Streams helper yet: arrives in phase 1 (T4.1) as `src/streams.ts`.
- Shutdown closes HTTP first; readiness-based draining is phase 5.
