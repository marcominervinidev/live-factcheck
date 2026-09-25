#!/bin/sh
# SessionStart: show the status of the current phase plan (newest file in .ai/plans/).
. "$(dirname "$0")/lib.sh"

plan=$(ls -t "$REPO_ROOT"/.ai/plans/*.md 2>/dev/null | head -1)
[ -n "$plan" ] || exit 0
printf 'Current plan: %s (branch: %s)\n\n' "${plan#"$REPO_ROOT"/}" "$(git -C "$REPO_ROOT" branch --show-current)"
awk '/^## Status/{show=1} /^## /&&!/^## Status/{show=0} show' "$plan"
exit 0
