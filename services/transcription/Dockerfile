# syntax=docker/dockerfile:1.7
# Build context: repository root (the service needs the workspace packages).
#   docker build -f services/transcription/Dockerfile --target runtime .
# Stages: base -> deps -> dev (hot reload) | build -> runtime (distroless, non-root).
# No secrets or environment values enter any stage (brief 4.1 factor V).

ARG SERVICE=transcription

FROM node:24.21.0-trixie-slim AS base
ARG PNPM_VERSION=12.6.0
ENV PNPM_HOME=/pnpm \
    PNPM_STORE_DIR=/pnpm/store \
    CI=true
RUN npm install -g "pnpm@${PNPM_VERSION}" && npm cache clean --force
WORKDIR /repo

# Dependencies first so source edits do not invalidate this layer.
FROM base AS deps
ARG SERVICE
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch
COPY package.json tsconfig.base.json ./
COPY packages/ packages/
COPY services/${SERVICE}/ services/${SERVICE}/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --filter "@lfc/${SERVICE}..."

# Development: sources are synced in by `docker compose watch`; tsx reloads on change.
FROM deps AS dev
ARG SERVICE
ENV SERVICE=${SERVICE}
RUN chown -R 1000:1000 /repo
USER 1000:1000
WORKDIR /repo/services/${SERVICE}
CMD ["pnpm", "run", "dev"]

FROM deps AS build
ARG SERVICE
RUN pnpm --filter "@lfc/${SERVICE}..." run build \
 && pnpm --filter "@lfc/${SERVICE}" deploy --prod /out

# Runtime: no shell, no package manager, no build tools. Numeric uid so Kubernetes
# can verify runAsNonRoot (65532 = distroless "nonroot").
FROM gcr.io/distroless/nodejs24-debian13:nonroot AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Code stays root-owned and read-only for the runtime user.
COPY --from=build /out/ ./
USER 65532:65532
CMD ["dist/main.js"]
