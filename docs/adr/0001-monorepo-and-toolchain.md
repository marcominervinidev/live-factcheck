# 0001: Monorepo layout and toolchain

- Status: accepted
- Date: 2026-09-25

## Context

The brief asks for one repository with independently deployable services (factor I), shared packages for contracts and infrastructure code, strict TypeScript and technically enforced module boundaries (4.2). The host may only need Docker, Git, VS Code and a coding agent (12). Git hooks must protect commits no matter which agent produced them (1.4).

## Decision

- **pnpm workspaces** (`apps/*`, `services/*`, `packages/*`, `tests/*`) without an extra task runner. Affected packages are selected with `pnpm --filter "...[<ref>]"`.
- **Node 24 LTS** (24.21.0) and **pnpm 12.6**, pinned via `packageManager` and in the toolbox image.
- **TypeScript 6.0.3**, strict, ESM with `module: NodeNext`, project references. TypeScript 7 (native compiler) is out, but typescript-eslint 8.70 supports only `<6.1`; we upgrade once it does.
- **ESLint 10** with `typescript-eslint` `strictTypeChecked`. `no-explicit-any` is an error, `@ts-ignore`/`@ts-expect-error` and ESLint disable comments require a written reason.
- **Prettier** for code and config. Markdown is excluded because padded tables make review diffs unreadable.
- **dependency-cruiser** enforces the module boundaries as its own check (pre-commit and CI): no service-to-service imports, no deep imports into packages, no cycles, no undeclared dependencies.
- **Toolbox container** (`tools/toolbox`, `compose.toolbox.yaml`, `scripts/tb`) is the only place where Node tooling runs. It is its own Compose project so stopping the app stack does not stop it.
- **pnpm supply-chain policies stay on.** pnpm 12 refuses packages younger than its `minimumReleaseAge` and denies dependency install scripts unless `allowBuilds` in `pnpm-workspace.yaml` allows them. We pin the newest release that passes the age check instead of adding exclusions, and every `allowBuilds` entry carries a comment explaining why the script is denied or allowed.
- **lefthook** runs inside the toolbox. `make hooks-install` writes a small shim to `.git/hooks/pre-commit` instead of relying on lefthook's postinstall (which is denied via `allowBuilds`).

## Alternatives

- **Nx or Turborepo**: remote caching and task graphs are more than this repo needs now; pnpm filters cover "affected". Can be added later without restructuring.
- **npm or Yarn workspaces**: pnpm's strict `node_modules` layout catches undeclared dependencies early and its store keeps CI fast.
- **TypeScript 7**: faster, but would lose type-aware linting today.
- **eslint-plugin-boundaries**: works, but ties boundary checks to the lint run; dependency-cruiser gives a separate, readable CI check and also catches cycles and undeclared dependencies.
- **Tooling on the host** (nvm, Homebrew): contradicts the brief and drifts from CI.
- **lefthook as host binary**: one more host tool to install and keep in sync.

## Consequences

- Every Node command goes through `scripts/tb`; the first call after a reboot takes a few seconds to start the container.
- `node_modules` sits in the bind-mounted repo but is only used by the toolbox and the devcontainer, never by host tools.
- Upgrading TypeScript to 7 is a tracked follow-up once typescript-eslint supports it.
- The toolbox mounts the Docker socket for Testcontainers. That is root-equivalent on the Docker host and documented in `docs/SECURITY.md`; it is limited to the dev toolbox.
