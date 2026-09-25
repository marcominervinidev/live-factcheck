# 0003: Container images and hardening

- Status: accepted
- Date: 2026-09-25

## Context

Every service runs in its own container, in development and in production (brief 4, 12). Images are built once per commit and must run unchanged in Compose and Kubernetes (factor V), be small, non-root and without build tools or shell (14.1, 15.3), and build for `linux/arm64` (Apple Silicon) and `linux/amd64` (CI, later VMs). Services are pnpm workspace members that depend on `packages/*`.

## Decision

**One multi-stage Dockerfile per Node service, built from the repo root:**

| Stage | Base | Purpose |
|---|---|---|
| `base` | `node:24.21.0-trixie-slim` + pnpm 12.6 | shared tooling |
| `deps` | `base` | `pnpm fetch` on the lockfile (cached layer), then offline install for `@lfc/<service>...` only |
| `dev` | `deps` | `tsx watch` with sources synced by `docker compose watch`; uid 1000 |
| `build` | `deps` | `tsc -b` for the service and its workspace dependencies, `pnpm deploy --prod /out` |
| `runtime` | `gcr.io/distroless/nodejs24-debian13:nonroot` | only `/out`; no shell, no package manager |

- **Numeric users** (`1000:1000` in dev, `65532:65532` in runtime), so Kubernetes can enforce `runAsNonRoot`.
- **Code is root-owned** in the runtime image; the process cannot modify it even if the root filesystem were writable.
- **Build and runtime share Debian 13 (trixie)**, so native modules would match glibc.
- **Healthchecks without curl:** `node node_modules/@lfc/service-kit/dist/bin/healthcheck.js` calls `/healthz`.
- **Versions are pinned by tag** now and by digest from phase 6 (brief 4.1 factor II).
- The service name is the only difference between Dockerfiles (`ARG SERVICE`), which keeps the `new-service` skill mechanical.
- Runtime hardening that is not part of the image (read-only root filesystem, `tmpfs`, `cap_drop: [ALL]`, `no-new-privileges`, limits) is set in Compose (ADR 0004) and later in Kubernetes manifests.

## Alternatives

- **Alpine / `node:*-alpine` runtime:** smaller, but still has a shell and uses musl.
- **Chainguard or Wolfi images:** similar to distroless, but free tags are "latest" only, which conflicts with version pinning.
- **Per-service build context:** would need publishing or copying the workspace packages; the root context with a strict `.dockerignore` is simpler.
- **Bundling with esbuild into one file:** smaller images, but source maps and stack traces get worse and it adds a build tool; revisit if image size becomes a problem.

## Consequences

- The runtime image is ~180 MB, of which ~160 MB is the distroless Node base. Third-party packages ship their own test files; pruning them is not worth the complexity now.
- There is no shell for debugging in production containers; use `docker compose logs` and the dev target instead.
- Building an image in an integration test via Testcontainers fails with BuildKit (`invalid tar header`), so image-level checks run against the Compose stack (stage 3) instead.
