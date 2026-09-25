#!/bin/sh
# PostToolUse: format and lint the edited file inside the toolbox. Reports remaining
# lint errors back to the agent; never blocks when the toolbox is not running.
. "$(dirname "$0")/lib.sh"

file=$(json '.tool_input.file_path')
rel=${file#"$REPO_ROOT"/}
[ "$rel" != "$file" ] || exit 0          # outside the repo
[ -f "$file" ] || exit 0

case "$rel" in
  *.ts | *.tsx | *.js | *.cjs | *.mjs) lint=1 ;;
  *.json | *.yaml | *.yml | *.css | *.html) lint=0 ;;
  *) exit 0 ;;
esac

if ! toolbox_running; then
  jq -n '{systemMessage: "format-lint hook skipped: toolbox not running (make toolbox)"}'
  exit 0
fi

in_toolbox pnpm exec prettier --write --log-level warn "$rel" >/dev/null 2>&1
if [ "$lint" = 1 ]; then
  if ! out=$(in_toolbox pnpm exec eslint --fix --max-warnings 0 "$rel" 2>&1); then
    printf 'ESLint findings in %s (fix before finishing):\n%s\n' "$rel" "$out" >&2
    exit 2
  fi
fi
exit 0
