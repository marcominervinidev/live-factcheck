#!/bin/sh
# Starts Redis with ACL users built from the Compose secrets (brief 15.4):
#   default  disabled
#   app      services: everything except admin and dangerous commands
#   mcp      Redis MCP server for diagnostics: read-only (streams, groups, pending, pub/sub)
# Passwords are stored as SHA-256 hashes in an ACL file on tmpfs, never in plain text.
set -eu

# Same normalisation as the services (service-kit loadConfig trims): leading and trailing
# whitespace, including CR/LF, is not part of the secret.
read_secret() {
  sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' "/run/secrets/$1" | tr -d '\r\n'
}

hash_secret() {
  value=$(read_secret "$1")
  if [ -z "$value" ]; then
    echo "redis/start.sh: secret $1 is missing or empty (run: make secrets-init)" >&2
    exit 1
  fi
  printf '%s' "$value" | sha256sum | cut -d' ' -f1
}

APP_HASH=$(hash_secret redis_password)
MCP_HASH=$(hash_secret redis_mcp_password)

# mcp: +@connection also grants CLIENT KILL/PAUSE/NO-EVICT, which are @admin/@dangerous;
# the trailing removals keep the diagnostics user unable to disrupt the services.
umask 077
cat > /tmp/users.acl <<ACL
user default off
user app on #${APP_HASH} ~* &* +@all -@admin -@dangerous
user mcp on #${MCP_HASH} ~* &* -@all +@read +@connection +@pubsub -publish -spublish +xinfo +xpending +info +client|setinfo +client|setname -@admin -@dangerous
ACL

exec redis-server --aclfile /tmp/users.acl --appendonly yes --dir /data --protected-mode yes
