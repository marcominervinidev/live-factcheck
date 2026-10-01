#!/bin/sh
# Runs one Compose command against a fresh mock stack and always removes the stack afterwards:
# stages 3 and 4 and the ZAP scan (make test-api, test-e2e, zap), like CI does.
# - Settings come only from .env.example (the mock defaults); .env and exported shell settings
#   never reach the test stack, so no test calls a paid provider.
# - Secrets are generated for this run only; no real API key is mounted.
# - Project, host ports (localhost only) and image tag are fixed: the teardown runs `down -v`,
#   which must never reach the owner's project, its volumes or its images.
# Usage: scripts/stack-test.sh run --rm api-tests
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

# Every variable docker-compose.yml interpolates; HOME stays because Docker needs it for its
# context.
for name in $(grep -o '\${[A-Z_][A-Z0-9_]*' docker-compose.yml | cut -c3- | sort -u); do
  [ "$name" = HOME ] || unset "$name"
done

SECRETS=$(mktemp -d)
compose() {
  COMPOSE_PROJECT_NAME=lfc-test LFC_HTTP_PORT=127.0.0.1:8084 LFC_HTTPS_PORT=127.0.0.1:8446 \
    LFC_TAG=test SECRETS_DIR="$SECRETS" \
    docker compose --env-file .env.example -f docker-compose.yml -f compose.test.yaml "$@"
}
cleanup() {
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$SECRETS"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

scripts/secrets-init.sh "$SECRETS" >/dev/null
# Throwaway values; on Linux, containers with other uids cannot read 0600 bind-mounted secret
# files (ADR 0004), as in CI.
chmod 644 "$SECRETS"/*

compose down -v --remove-orphans
compose up -d --build --wait
compose "$@"
