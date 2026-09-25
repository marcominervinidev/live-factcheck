#!/bin/sh
# PreToolUse: contracts are read-only for agents (brief 4.2). Ask the owner before any edit;
# CI (scripts/check-contract-change.sh) enforces ADR + schemaVersion regardless of this hook.
. "$(dirname "$0")/lib.sh"

file=$(json '.tool_input.file_path')
case "$file" in
  "$REPO_ROOT"/packages/contracts/* | packages/contracts/*)
    jq -n --arg f "${file#"$REPO_ROOT"/}" '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: ("Contract change: \($f). Contracts are read-only for agents; approve only if you explicitly agreed to this change (needs ADR + schemaVersion bump, skill new-event-contract).")
      }
    }'
    ;;
esac
exit 0
