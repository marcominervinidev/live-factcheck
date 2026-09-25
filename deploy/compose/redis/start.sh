#!/bin/sh
# Starts Redis with ACL users built from the Compose secrets (brief 15.4):
#   default  disabled
#   app      services: everything except admin and dangerous commands
#   mcp      Redis MCP server for diagnostics: read-only (streams, groups, pending, pub/sub)
# Passwords are stored as SHA-256 hashes in an ACL file on tmpfs, never in plain text.
set -eu

hash_secret() {
  file="/run/secrets/$1"
  if [ ! -s "$file" ]; then
    echo "redis/start.sh: secret $1 is missing or empty (run: make secrets-init)" >&2
    exit 1
  fi
  tr -d '\n' < "$file" | sha256sum | cut -d' ' -f1
}

APP_HASH=$(hash_secret redis_password)
MCP_HASH=$(hash_secret redis_mcp_password)

umask 077
cat > /tmp/users.acl <<ACL
user default off
user app on #${APP_HASH} ~* &* +@all -@admin -@dangerous
user mcp on #${MCP_HASH} ~* &* -@all +@read +@connection +@pubsub -publish -spublish +xinfo +xpending +info +client|setinfo +client|setname
ACL

exec redis-server --aclfile /tmp/users.acl --appendonly yes --dir /data --protected-mode yes
