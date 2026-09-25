# Shared helpers for Claude Code hooks. Hooks are comfort and early warning only;
# the real guards are lefthook and CI (AGENTS.md, brief 1.4).
# Requires only /bin/sh, git and jq (ships with macOS 15 at /usr/bin/jq).

REPO_ROOT=${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}
TOOLBOX_CONTAINER=lfc-toolbox-toolbox-1
SECRETS_DIR_DEFAULT="$HOME/.config/live-factcheck/secrets"

hook_input=$(cat)
json() { printf '%s' "$hook_input" | jq -r "$1 // empty"; }

toolbox_running() {
  [ "$(docker inspect -f '{{.State.Running}}' "$TOOLBOX_CONTAINER" 2>/dev/null)" = "true" ]
}

# Run a command in the toolbox at the repo root (fast path: docker exec, no compose).
in_toolbox() {
  docker exec -w /workspace "$TOOLBOX_CONTAINER" "$@"
}
