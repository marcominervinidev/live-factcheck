#!/bin/sh
# Create the local secret directory outside the repo. Internal secrets (passwords and keys
# only used between our own containers) get a random value; external API keys are created
# empty for the owner to fill in. Never overwrites existing files, never prints values.
# Usage: scripts/secrets-init.sh <secrets-dir>
set -eu
DIR=${1:?usage: secrets-init.sh <secrets-dir>}

# Make the path absolute first, so a relative path like "secrets" cannot slip past the check.
case "$DIR" in
  /*) ;;
  *) DIR="$(pwd)/$DIR" ;;
esac
REPO=$(cd "$(dirname "$0")/.." && pwd)
REPO_PHYSICAL=$(cd "$REPO" && pwd -P)
case "$DIR/" in
  "$REPO"/* | "$REPO_PHYSICAL"/*)
    echo "refusing: SECRETS_DIR must be outside the repository ($DIR)" >&2
    exit 1 ;;
esac

# One file per secret. Keep in sync with the `secrets:` block in docker-compose.yml.
INTERNAL="
redis_password
redis_mcp_password
searxng_secret
gateway_token
"
EXTERNAL="
anthropic_api_key
deepgram_api_key
assemblyai_api_key
brave_api_key
tavily_api_key
"

random_value() {
  LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 40
}

umask 077
mkdir -p "$DIR"
chmod 700 "$DIR"
for name in $INTERNAL $EXTERNAL; do
  file="$DIR/$name"
  if [ -e "$file" ]; then
    echo "kept       $file"
  elif printf '%s\n' $INTERNAL | grep -qx "$name"; then
    random_value > "$file"
    echo "generated  $file (random internal secret)"
  else
    : > "$file"
    echo "created    $file (empty, fill in your API key if you use this provider)"
  fi
  chmod 600 "$file"
done
