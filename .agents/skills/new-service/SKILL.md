---
name: new-service
description: "Scaffold a new Node service under services/<name> following the reference service (services/gateway): service-kit, config validation, health/metrics, hardened Dockerfile with dev and runtime stages, Compose entry, own AGENTS.md and CLAUDE.md, tests. Use whenever a new service is added."
---

# New Node service

The reference service is `services/gateway`. Copy its structure and quality level (brief 4.2); do not invent a new layout. If the gateway does not exist yet, stop and say so.

## Inputs

Service name (kebab-case), its responsibility in one sentence, its config variables (non-secret and secret), and which Redis streams it reads or writes.

## Steps

1. **Package:** copy `services/gateway/{package.json,tsconfig.json,vitest.config.js}` to `services/<name>/`, set `"name": "@lfc/<name>"`, keep scripts and exact dependency versions. Add `{ "path": "./services/<name>" }` to the root `tsconfig.json` references.
2. **Config** `src/config.ts`: `baseConfigSchema.extend({ … })`. Required values have no defaults. List every secret in `secretKeys` so it works via `<KEY>_FILE`.
3. **Entry** `src/main.ts`: `await runService({ name: '<name>', configSchema, secretKeys, start })`. `start` returns `readiness` checks for every dependency and a `stop()` that finishes or hands back in-flight work. On startup, log which providers are configured, never their keys.
4. **Tests:** copy and adapt `test/startup.test.ts` (fails fast without required config). Add unit tests for any logic in the same commit.
5. **Dockerfile:** copy the gateway's multi-stage Dockerfile and change only the service name/path. Stages `dev` and `runtime`; runtime is distroless, non-root, without build tools.
6. **Compose:** copy the gateway's block in `docker-compose.yml`: no host ports, networks by need (`internal`; `egress` only if it must reach the internet), `read_only`, `tmpfs`, `cap_drop: [ALL]`, `no-new-privileges`, limits, healthcheck, only the secrets it needs. Add the `develop.watch` block in `compose.dev.yaml`.
7. **Rules:** `services/<name>/AGENTS.md` (only what applies to this service: responsibility, streams, pitfalls) and `CLAUDE.md` containing `@AGENTS.md`. Add a glob rule `.agents/rules/<name>.md` so Antigravity loads it (copy an existing one).
8. **Phase 5+:** Kustomize manifests in `deploy/k8s/base/<name>/` following the existing services.
9. **Verify:** `scripts/tb pnpm --filter @lfc/<name> test:unit`, `make lint`, `docker compose config --quiet`, `docker compose up -d <name>` and `/readyz` via `make ready`. Capture evidence (skill `evidence`).
