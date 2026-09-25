#!/bin/sh
# PreCompact: append git state to the plan's session log. Written notes on open points are the
# agent's job before /compact (CLAUDE.md); a shell hook cannot summarise the conversation.
. "$(dirname "$0")/lib.sh"

plan=$(ls -t "$REPO_ROOT"/.ai/plans/*.md 2>/dev/null | head -1)
[ -n "$plan" ] || exit 0
{
  printf '\n### %s – compaction (%s)\n\n' "$(date -u +%Y-%m-%dT%H:%MZ)" "$(json '.trigger')"
  printf -- '- branch: `%s`, HEAD `%s`\n' "$(git -C "$REPO_ROOT" branch --show-current)" "$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
  printf -- '- uncommitted:\n\n```\n%s\n```\n' "$(git -C "$REPO_ROOT" status --short | head -30)"
} >> "$plan"
exit 0
