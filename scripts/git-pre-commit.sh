#!/bin/sh
# Installed as .git/hooks/pre-commit by `make hooks-install`.
# Delegates to lefthook inside the toolbox, so the host needs no Node tooling.
ROOT=$(git rev-parse --show-toplevel)
exec "$ROOT/scripts/tb" pnpm exec lefthook run pre-commit "$@"
