#!/usr/bin/env bash
# DoD (brief 17, phase 0): no container except caddy publishes a host port.
set -euo pipefail
published=$(docker compose ps --format json |
  jq -s 'map(select(.Publishers != null)
    | {svc: .Service, ports: [.Publishers[] | select(.PublishedPort != 0) | "\(.URL):\(.PublishedPort)->\(.TargetPort)"]}
    | select(.ports | length > 0))')
echo "$published" | jq -r '.[] | "\(.svc): \(.ports | join(", "))"'
offenders=$(echo "$published" | jq -r '.[] | select(.svc != "caddy") | .svc')
if [ -n "$offenders" ]; then
  echo "FAIL: host ports published by: $offenders" >&2
  exit 1
fi
echo "ok: only caddy publishes host ports"
