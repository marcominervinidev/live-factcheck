#!/bin/sh
# PreToolUse: block access to .env files and the secrets directory (brief 15.1).
. "$(dirname "$0")/lib.sh"

secrets_dir=${SECRETS_DIR:-$SECRETS_DIR_DEFAULT}
tool=$(json '.tool_name')

block() {
  echo "Blocked by guard-secrets: $1. Secrets are never read or written by agents (AGENTS.md, Security). Ask the owner instead." >&2
  exit 2
}

is_env_file() {
  base=$(basename -- "$1")
  case "$base" in
    .env.example) return 1 ;;
    .env | .env.*) return 0 ;;
  esac
  return 1
}

check_path() {
  [ -n "$1" ] || return 0
  case "$1" in
    "$secrets_dir"* | *"/.config/live-factcheck/secrets"* | "~/.config/live-factcheck/secrets"*)
      block "path is inside the secrets directory" ;;
  esac
  is_env_file "$1" && block "path is an .env file ($1)"
  return 0
}

case "$tool" in
  Bash)
    cmd=$(json '.tool_input.command')
    # .env.example is fine; remove it before looking for real .env files.
    printf '%s' "$cmd" | sed 's/\.env\.example//g' \
      | grep -Eq '(^|[^A-Za-z0-9_./-])(\./)?\.env(\.[A-Za-z0-9_-]+)?([^A-Za-z0-9_.-]|$)' \
      && block "command references an .env file"
    printf '%s' "$cmd" | grep -Eq 'live-factcheck/secrets|\$\{?SECRETS_DIR' \
      && block "command references the secrets directory"
    # Secrets mounted inside containers (docker compose exec … cat /run/secrets/…).
    printf '%s' "$cmd" | grep -Eq '/run/secrets' \
      && block "command references secrets mounted in a container"
    # Running the init target or script touches the secrets directory; mentioning the file does not.
    printf '%s' "$cmd" \
      | grep -Eq '(^|[;&|(]) *(make [^;&|]*secrets-init|((ba)?sh +)?(\./)?scripts/secrets-init\.sh)' \
      && block "command runs secrets-init"
    ;;
  *)
    check_path "$(json '.tool_input.file_path')"
    check_path "$(json '.tool_input.notebook_path')"
    check_path "$(json '.tool_input.path')"
    check_path "$(json '.tool_input.pattern')"
    ;;
esac
exit 0
