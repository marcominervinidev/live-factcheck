# syntax=docker/dockerfile:1.7
# Toolbox image: the only place where Node, pnpm and the dev CLIs run.
# Used by `scripts/tb`, lefthook, the Claude Code hooks and `.devcontainer/`.
FROM node:24.21.0-bookworm-slim

ARG PNPM_VERSION=12.6.0
ARG GITLEAKS_VERSION=8.30.1
ARG GITLEAKS_SHA256_ARM64=e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080
ARG GITLEAKS_SHA256_AMD64=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
ARG TARGETARCH

# hadolint ignore=DL3008
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git \
 && rm -rf /var/lib/apt/lists/*

# gitleaks, verified against the release checksum.
RUN set -eu; \
    case "${TARGETARCH}" in \
      arm64) asset=linux_arm64; sum="${GITLEAKS_SHA256_ARM64}" ;; \
      amd64) asset=linux_x64;   sum="${GITLEAKS_SHA256_AMD64}" ;; \
      *) echo "unsupported arch ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/gitleaks.tgz \
      "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_${asset}.tar.gz"; \
    echo "${sum}  /tmp/gitleaks.tgz" | sha256sum -c -; \
    tar -xzf /tmp/gitleaks.tgz -C /usr/local/bin gitleaks; \
    rm /tmp/gitleaks.tgz

RUN npm install -g "pnpm@${PNPM_VERSION}" && npm cache clean --force

ENV PNPM_HOME=/home/node/.local/share/pnpm \
    PNPM_STORE_DIR=/pnpm-store \
    CI=false
RUN mkdir -p /pnpm-store /workspace && chown node:node /pnpm-store /workspace

USER node
WORKDIR /workspace
# The repo is bind-mounted and owned by the host user; git must accept it.
RUN git config --global --add safe.directory /workspace

CMD ["sleep", "infinity"]
