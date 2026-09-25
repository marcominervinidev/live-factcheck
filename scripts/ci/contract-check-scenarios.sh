#!/usr/bin/env bash
# Regression test for scripts/check-contract-change.sh: runs six scenarios in a throwaway
# clone and prints the result of each. Run inside the toolbox:
#   scripts/tb bash scripts/ci/contract-check-scenarios.sh
# Never touches /workspace: every git write happens in $REPO, verified before use.
set -euo pipefail
WORK=$(mktemp -d)
REPO="$WORK/repo"
git -c safe.directory='*' clone -q --no-hardlinks /workspace "$REPO"
cd "$REPO"
[ "$(pwd -P)" = "$(cd "$REPO" && pwd -P)" ] || { echo "not in clone, aborting" >&2; exit 99; }
git config core.hooksPath /dev/null
git config user.email ci@example.invalid
git config user.name scenario
cp /workspace/scripts/check-contract-change.sh scripts/
git add scripts/check-contract-change.sh && git commit -qm "check script under test"
START=$(git rev-parse HEAD)

run() {
  local title=$1 base=$2
  echo; echo "### $title"
  set +e; bash scripts/check-contract-change.sh "$base" 2>&1; local code=$?; set -e
  echo "exit code: $code"
}
scenario() { git reset -q --hard "$START"; }

run "A: this branch vs main (new contracts package + ADR 0002)" origin/main

scenario
sed -i 's/sources: z.array(Source).max(10)/sources: z.array(Source).max(20)/' packages/contracts/src/claim-checked.ts
git commit -qam "change ClaimChecked"
run "B: ClaimChecked changed, no ADR, no version bump" "$START"

printf '# 0099: test\n' > docs/adr/0099-test.md; git add -A; git commit -qm "add ADR"
run "C: ClaimChecked changed with ADR, schemaVersion unchanged" "$START"

sed -i '0,/schemaVersion: z.literal(1)/s//schemaVersion: z.literal(2)/' packages/contracts/src/claim-checked.ts
git commit -qam "bump"
run "D: ClaimChecked changed with ADR and schemaVersion 1 -> 2" "$START"

scenario
sed -i 's/max(64)/max(80)/' packages/contracts/src/common.ts
printf '# 0099: test\n' > docs/adr/0099-test.md; git add -A; git commit -qm "common change"
run "E: existing common.ts changed with ADR, no schemaVersion bump" "$START"

scenario
sed -i 's/rejects an unknown event type/rejects an unknown event type name/' packages/contracts/src/envelope.test.ts
git commit -qam "test only"
run "F: only a contract test changed" "$START"

rm -rf "$WORK"
