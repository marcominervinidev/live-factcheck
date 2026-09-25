#!/usr/bin/env bash
# Contract guard (brief 1.4, 4.2): a change to the contract schemas needs, in the same PR,
#   1. a new or changed ADR under docs/adr/ (not the template), and
#   2. a higher schemaVersion in every changed schema file that already existed.
# Changing an existing shared building block (a file without schemaVersion, e.g. common.ts)
# changes several schemas at once and requires at least one schemaVersion bump in the PR.
# Not contract changes: tests, fixtures, docs and src/index.ts (re-exports only).
#
# Usage: scripts/check-contract-change.sh <base-ref>   (e.g. origin/main)
set -euo pipefail

BASE=${1:?usage: check-contract-change.sh <base-ref>}
MERGE_BASE=$(git merge-base "$BASE" HEAD)

mapfile -t changed < <(
  git diff --name-only --diff-filter=ACMRD "$MERGE_BASE" HEAD -- 'packages/contracts/src/*.ts' \
    | grep -vE '\.test\.ts$|/testing/|/src/index\.ts$' || true
)

if [ ${#changed[@]} -eq 0 ]; then
  echo "contract check: no schema changes"
  exit 0
fi

echo "contract check: schema files changed:"
printf '  %s\n' "${changed[@]}"

errors=()

adrs=$(git diff --name-only --diff-filter=AM "$MERGE_BASE" HEAD -- 'docs/adr/*.md' \
  | grep -v '0000-template.md' || true)
if [ -z "$adrs" ]; then
  errors+=("no new or changed ADR under docs/adr/")
fi

# Highest `schemaVersion: z.literal(N)` in a file at a revision; empty if none.
version_at() {
  git show "$1:$2" 2>/dev/null \
    | grep -oE 'schemaVersion: z\.literal\([0-9]+\)' \
    | grep -oE '[0-9]+' | sort -n | tail -1 || true
}

bumped=0
shared=()
for file in "${changed[@]}"; do
  old=$(version_at "$MERGE_BASE" "$file")
  new=$(version_at HEAD "$file")
  if [ -z "$old" ] && [ -z "$new" ]; then
    if git cat-file -e "$MERGE_BASE:$file" 2>/dev/null; then
      shared+=("$file")
    else
      echo "  $file: new shared building block"
    fi
  elif [ -z "$old" ]; then
    echo "  $file: new schema (schemaVersion $new)"
  elif [ -z "$new" ]; then
    echo "  $file: schema removed (was schemaVersion $old)"
    bumped=1
  elif [ "$new" -gt "$old" ]; then
    echo "  $file: schemaVersion $old -> $new"
    bumped=1
  else
    errors+=("$file: schema changed but schemaVersion stayed at $old")
  fi
done

if [ ${#shared[@]} -gt 0 ] && [ "$bumped" -eq 0 ]; then
  errors+=("shared building blocks changed (${shared[*]}) without any schemaVersion bump")
fi

if [ ${#errors[@]} -gt 0 ]; then
  echo "contract check FAILED:" >&2
  printf '  - %s\n' "${errors[@]}" >&2
  echo "See packages/contracts/AGENTS.md for how to change a contract." >&2
  exit 1
fi

echo "contract check: ok (ADR: $(echo "$adrs" | tr '\n' ' '))"
