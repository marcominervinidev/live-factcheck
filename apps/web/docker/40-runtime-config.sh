#!/bin/sh
# Writes /tmp/config.json from environment variables at container start (brief 4.1: the
# frontend image contains no environment values). Only non-secret settings belong here.
set -eu

: "${WEB_GATEWAY_URL:?WEB_GATEWAY_URL is required, e.g. /api or https://factcheck.local/api}"

# Allow only an absolute path or an http(s) URL with a safe character set, so the value can be
# embedded in JSON without escaping and cannot inject markup.
if ! printf '%s' "$WEB_GATEWAY_URL" | grep -Eq '^(https?://[A-Za-z0-9.:-]+)?/[A-Za-z0-9._~/-]*$'; then
  echo "40-runtime-config.sh: invalid WEB_GATEWAY_URL" >&2
  exit 1
fi

printf '{"gatewayUrl":"%s"}\n' "$WEB_GATEWAY_URL" > /tmp/config.json
echo "40-runtime-config.sh: wrote /tmp/config.json"
