#!/usr/bin/env bash
# Checks /readyz of every service from inside the stack networks and the app through Caddy.
# Uses a throwaway curl container: runtime images have no shell tools (ADR 0003).
set -uo pipefail
CURL=curlimages/curl:8.22.0
# Honors COMPOSE_PROJECT_NAME, e.g. an isolated verification stack (AGENTS.md).
PROJECT=${COMPOSE_PROJECT_NAME:-live-factcheck}
status=0

check() { # network url label
  local body code
  body=$(docker run --rm --network "${PROJECT}_$1" "$CURL" -s -m 5 -w '\n%{http_code}' "$2" 2>&1)
  code=${body##*$'\n'}
  body=${body%$'\n'*}
  printf '%-18s %-3s %s\n' "$3" "$code" "$body"
  [ "$code" = 200 ] || status=1
}

for svc in gateway transcription claim-extractor fact-checker explainer; do
  check internal "http://${svc}:8080/readyz" "$svc"
done
check frontend "http://web:8080/healthz" web
check internal "http://searxng:8080/healthz" searxng

# End to end through Caddy with TLS (internal CA, hence -k). The SNI must be "localhost".
caddy_ip=$(docker inspect -f "{{(index .NetworkSettings.Networks \"${PROJECT}_edge\").IPAddress}}" "${PROJECT}-caddy-1")
code=$(docker run --rm --network "${PROJECT}_edge" "$CURL" -sk -m 5 -o /dev/null -w '%{http_code}' \
  --resolve "localhost:8443:${caddy_ip}" https://localhost:8443/)
printf '%-18s %-3s %s\n' "caddy -> web" "$code" "https://localhost/"
[ "$code" = 200 ] || status=1

exit $status
