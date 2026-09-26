#!/bin/sh
# Regression test for the Claude Code hooks: feeds synthetic hook input (no real secrets are
# touched) and prints the decision per case. Plan-file hooks run against a scratch copy.
# Usage: .claude/hooks/test-hooks.sh
set -u
HOOKS=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HOOKS/../.." && pwd)
SCRATCH=$(mktemp -d)
trap 'rm -rf "$SCRATCH"' EXIT

expect() { # label expected-exit hook json
  printf '%s' "$4" | CLAUDE_PROJECT_DIR=$REPO "$HOOKS/$3" >"$SCRATCH/out" 2>&1
  code=$?
  if [ "$code" = "$2" ]; then verdict=ok; else verdict="FAIL (expected $2)"; fi
  printf '%-52s exit %s  %s\n' "$1" "$code" "$verdict"
}

S="$HOME/.config/live-factcheck/secrets"
echo "== guard-secrets.sh (2 = blocked)"
expect "Read .env"                         2 guard-secrets.sh '{"tool_name":"Read","tool_input":{"file_path":"'"$REPO"'/.env"}}'
expect "Read .env.local"                   2 guard-secrets.sh '{"tool_name":"Read","tool_input":{"file_path":"'"$REPO"'/.env.local"}}'
expect "Read .env.example"                 0 guard-secrets.sh '{"tool_name":"Read","tool_input":{"file_path":"'"$REPO"'/.env.example"}}'
expect "Read file in secrets dir"          2 guard-secrets.sh '{"tool_name":"Read","tool_input":{"file_path":"'"$S"'/redis_password"}}'
expect "Glob in secrets dir"               2 guard-secrets.sh '{"tool_name":"Glob","tool_input":{"pattern":"*","path":"'"$S"'"}}'
expect "Read AGENTS.md"                    0 guard-secrets.sh '{"tool_name":"Read","tool_input":{"file_path":"'"$REPO"'/AGENTS.md"}}'
expect "Bash: cat .env"                    2 guard-secrets.sh '{"tool_name":"Bash","tool_input":{"command":"cat .env"}}'
expect "Bash: source ./.env.local"         2 guard-secrets.sh '{"tool_name":"Bash","tool_input":{"command":"source ./.env.local"}}'
expect "Bash: cp .env.example .env"        2 guard-secrets.sh '{"tool_name":"Bash","tool_input":{"command":"cp .env.example .env"}}'
expect "Bash: cat .env.example"            0 guard-secrets.sh '{"tool_name":"Bash","tool_input":{"command":"cat .env.example"}}'
expect "Bash: cat \$SECRETS_DIR/x"         2 guard-secrets.sh '{"tool_name":"Bash","tool_input":{"command":"cat \"$SECRETS_DIR/redis_password\""}}'
expect "Bash: ls secrets dir"              2 guard-secrets.sh '{"tool_name":"Bash","tool_input":{"command":"ls ~/.config/live-factcheck/secrets"}}'
expect "Bash: make secrets-init"           2 guard-secrets.sh '{"tool_name":"Bash","tool_input":{"command":"make secrets-init"}}'
expect "Bash: scripts/secrets-init.sh x"   2 guard-secrets.sh '{"tool_name":"Bash","tool_input":{"command":"scripts/secrets-init.sh /tmp/x"}}'
expect "Bash: cd . && sh scripts/secrets-init.sh" 2 guard-secrets.sh '{"tool_name":"Bash","tool_input":{"command":"cd . && sh scripts/secrets-init.sh"}}'
expect "Bash: git add scripts/secrets-init.sh" 0 guard-secrets.sh '{"tool_name":"Bash","tool_input":{"command":"git add scripts/secrets-init.sh"}}'
expect "Bash: exec cat in-container secret" 2 guard-secrets.sh '{"tool_name":"Bash","tool_input":{"command":"docker compose exec redis cat /run/secrets/redis_password"}}'
expect "Bash: grep SECRETS_DIR Makefile"   0 guard-secrets.sh '{"tool_name":"Bash","tool_input":{"command":"grep -n SECRETS_DIR Makefile"}}'
expect "Bash: node process.env"            0 guard-secrets.sh '{"tool_name":"Bash","tool_input":{"command":"node -e process.env.PORT"}}'

echo "== warn-contracts.sh (asks the owner, never blocks)"
expect "Edit packages/contracts/src/common.ts" 0 warn-contracts.sh '{"tool_name":"Edit","tool_input":{"file_path":"'"$REPO"'/packages/contracts/src/common.ts"}}'
printf '   -> %s\n' "$(jq -r '.hookSpecificOutput.permissionDecision' "$SCRATCH/out")"
expect "Edit AGENTS.md"                    0 warn-contracts.sh '{"tool_name":"Edit","tool_input":{"file_path":"'"$REPO"'/AGENTS.md"}}'
printf '   -> %s\n' "$(cat "$SCRATCH/out" || true)(no output = allowed)"

echo "== session-start.sh / pre-compact.sh (scratch copy of the plan)"
mkdir -p "$SCRATCH/repo/.ai/plans" && cp "$REPO"/.ai/plans/*.md "$SCRATCH/repo/.ai/plans/"
git -C "$SCRATCH/repo" init -q && git -C "$SCRATCH/repo" -c user.email=t@example.invalid -c user.name=t commit -q --allow-empty -m init
printf '{}' | CLAUDE_PROJECT_DIR="$SCRATCH/repo" "$HOOKS/session-start.sh" | head -3
printf '{"trigger":"manual"}' | CLAUDE_PROJECT_DIR="$SCRATCH/repo" "$HOOKS/pre-compact.sh"
printf 'pre-compact appended: %s\n' "$(grep -c 'compaction (manual)' "$SCRATCH"/repo/.ai/plans/*.md)"

echo "== stop-tests.sh"
expect "stop_hook_active=true is a no-op"  0 stop-tests.sh '{"stop_hook_active":true}'
