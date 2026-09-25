#!/bin/sh
# Create the local secret directory outside the repo with empty placeholder files.
# Never overwrites existing files and never prints secret values.
# Usage: scripts/secrets-init.sh <secrets-dir>
set -eu
DIR=${1:?usage: secrets-init.sh <secrets-dir>}

case "$DIR" in
  "$(cd "$(dirname "$0")/.." && pwd)"/*)
    echo "refusing: SECRETS_DIR must be outside the repository ($DIR)" >&2
    exit 1 ;;
esac

# One file per secret. Keep in sync with the `secrets:` block in docker-compose.yml.
SECRETS="
redis_password
redis_mcp_password
searxng_secret
gateway_token
anthropic_api_key
deepgram_api_key
assemblyai_api_key
brave_api_key
tavily_api_key
"

umask 077
mkdir -p "$DIR"
chmod 700 "$DIR"
for name in $SECRETS; do
  file="$DIR/$name"
  if [ -e "$file" ]; then
    echo "kept     $file"
  else
    : > "$file"
    echo "created  $file (empty, fill in yourself)"
  fi
  chmod 600 "$file"
done
