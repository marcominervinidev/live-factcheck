# syntax=docker/dockerfile:1.7
# Build context: repository root.
#   docker build -f apps/web/Dockerfile --target runtime .
# Stages: base -> deps -> dev (Vite dev server) | build -> runtime (nginx, non-root).
# The bundle contains no environment values; /config.json is generated at container start
# from WEB_GATEWAY_URL (brief 4.1, frontend exception).

FROM node:24.21.0-trixie-slim AS base
ARG PNPM_VERSION=12.6.0
ENV PNPM_HOME=/pnpm \
    PNPM_STORE_DIR=/pnpm/store \
    CI=true
RUN npm install -g "pnpm@${PNPM_VERSION}" && npm cache clean --force
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch
COPY package.json tsconfig.base.json ./
COPY apps/web/ apps/web/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --filter "@lfc/web..."

# Development: sources are synced in by `docker compose watch`; Vite serves with HMR.
FROM deps AS dev
RUN chown -R 1000:1000 /repo
USER 1000:1000
WORKDIR /repo/apps/web
EXPOSE 5173
# Call vite directly: `pnpm run` would re-verify and reinstall the whole workspace at start.
CMD ["node_modules/.bin/vite", "--host", "0.0.0.0", "--port", "5173"]

FROM deps AS build
RUN pnpm --filter @lfc/web run build

# Runtime: static files only; runs as uid 101 with a read-only root filesystem (tmpfs /tmp).
FROM nginxinc/nginx-unprivileged:1.30-alpine AS runtime
USER 0
# Drop entrypoint scripts that rewrite /etc/nginx at start; the image ships its final config.
RUN rm -f /docker-entrypoint.d/10-listen-on-ipv6-by-default.sh \
          /docker-entrypoint.d/20-envsubst-on-templates.sh
COPY apps/web/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chmod=0755 apps/web/docker/40-runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh
COPY --from=build /repo/apps/web/dist/ /usr/share/nginx/html/
USER 101:101
EXPOSE 8080
