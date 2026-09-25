#!/bin/sh
# Stop: unit tests of the workspaces affected on this branch must be green before the agent
# finishes (brief 1.1). Skips when nothing changed since the last green run.
. "$(dirname "$0")/lib.sh"

[ "$(json '.stop_hook_active')" = "true" ] && exit 0
cd "$REPO_ROOT" || exit 0

changed=$( { git diff --name-only main...HEAD; git status --porcelain | cut -c4-; } 2>/dev/null \
  | grep -E '^(apps|services|packages)/.*\.(ts|tsx|js|mjs|json)$' | sort -u)
[ -n "$changed" ] || exit 0

state_file=$(git rev-parse --git-path lfc-stop-hook-state)
fingerprint=$( { git rev-parse HEAD; git diff; git status --porcelain; } | git hash-object --stdin)
[ -f "$state_file" ] && [ "$(cat "$state_file")" = "$fingerprint" ] && exit 0

if ! out=$("$REPO_ROOT/scripts/tb" pnpm --filter "...[main]" --filter "!live-factcheck" --if-present test:unit 2>&1); then
  printf 'Unit tests of affected workspaces are failing. Fix them before finishing:\n%s\n' \
    "$(printf '%s' "$out" | tail -40)" >&2
  exit 2
fi
printf '%s' "$fingerprint" > "$state_file"
exit 0
