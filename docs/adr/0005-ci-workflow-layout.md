# 0005: CI workflow layout

- Status: accepted
- Date: 2026-09-25

## Context

Brief 13.3 and 14.2 split the pipeline by trigger: fast stages on every push, expensive stages (images, scans, system and E2E tests) on every PR to `main`, a second run against the pushed images after merge, and a nightly run. A push to a branch with an open PR triggers both a `push` and a `pull_request` event for the same commit; running the fast stages twice wastes minutes and doubles flaky-test noise. The brief leaves the de-duplication strategy to an ADR.

## Decision

- **`ci.yml` runs on `push` only** (all branches) and contains stage 0 plus unit and integration tests, split into backend and frontend jobs that run in parallel with one matrix entry per affected workspace (`scripts/ci/affected.mjs`).
- **`pr.yml` runs on `pull_request` only** and contains nothing that `ci.yml` already does: image build (amd64), Trivy, SAST, hadolint, the contract check, system/API and E2E tests.
- **`main.yml`** runs after the merge (multi-arch build, push to GHCR, stages 3 and 4 against the pushed images). **`nightly.yml`** runs stage 5.
- **One aggregate check per workflow** (`ci passed`, later `pr passed`) is the required status check in the branch ruleset. Matrix job names change with the affected workspaces, so requiring them individually would break.
- Branch protection sees checks per commit SHA, so a required check from the `push` run satisfies the PR, because the PR head is the same commit.
- "Affected" means changed since `origin/main` plus all dependents (`pnpm --filter "...[origin/main]"`); on `main` everything runs.
- All workflows use minimal `permissions`, actions pinned by commit SHA and `concurrency` with `cancel-in-progress` per ref.

## Alternatives

- **Everything on `pull_request`:** no duplicates, but no feedback on branches without a PR, and no CI on `main` pushes.
- **Everything on both events with `paths`/`if` filters to skip duplicates:** fragile and hard to read.
- **Turborepo or Nx affected detection:** more precise caching, but another tool; pnpm filters are enough for now.

## Consequences

- A PR's required checks come from two workflows; both aggregate jobs must be listed in the ruleset.
- A PR opened from a fork would get no `push` run; that is acceptable for a personal portfolio repo with no external contributors.
- When a workspace is added, it is picked up automatically as soon as it has a `test:unit` or `test:int` script.

## Update 2026-09-25 (TP6): full layout

| Workflow | Trigger | Stages |
|---|---|---|
| `ci.yml` | push, all branches | 0, 1, 2a (backend), 2b (frontend, Playwright container); aggregate `ci passed` |
| `pr.yml` | pull request to `main` | contract check, hadolint, Semgrep, image build (amd64) + Trivy per image, stages 3 and 4 via `stack-tests.yml` (E2E in 2 shards); aggregate `pr passed` |
| `codeql.yml` | PR, `main`, weekly | CodeQL for JS/TS and Actions |
| `main.yml` | push to `main` | multi-arch build, push to GHCR (`:<sha>`, `:main`), stages 3 and 4 against the pushed images; aggregate `main passed` |
| `nightly.yml` | daily, manual | Stryker (contracts), full browser matrix incl. Firefox + Lighthouse via `stack-tests.yml`, Trivy HIGH/CRITICAL incl. unfixed (report only) |
| `stack-tests.yml` | `workflow_call` | reusable: start the Compose stack (built locally or pulled from GHCR), API tests, sharded E2E, optional Lighthouse, merged HTML report |

- The image list for all matrices comes from `scripts/ci/images.mjs` (every workspace with a Dockerfile plus `deploy/compose/*` infrastructure images such as Caddy).
- Stack tests reuse one workflow instead of copying steps: YAML anchors cannot cross files, and a composite action could not hold the shard matrix.
- Compose image names are parameterised (`LFC_REGISTRY`, `LFC_TAG`), so `main.yml` tests exactly the images it pushed.
