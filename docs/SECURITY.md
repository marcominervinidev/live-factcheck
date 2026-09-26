# Security

Security is part of the definition of done from phase 0 (brief 15). This document holds the threat model, how secrets are handled, how to rotate a key, and what to do when one leaks. Decisions behind it: [ADR 0003](adr/0003-container-images-and-hardening.md) (images), [ADR 0004](adr/0004-compose-network-topology.md) (stack), [ADR 0006](adr/0006-agent-tooling-layout.md) (agent tooling).

## What we protect

| Asset | Why it matters |
|---|---|
| API keys (Anthropic, Deepgram/AssemblyAI, Brave/Tavily) | direct cost; a leaked key can run up a bill in hours |
| Conversation audio and transcripts | spoken words of people who did not publish them (§ 201 StGB, GDPR); audio is never stored, transcripts only with `PERSIST_TRANSCRIPTS=true` (from phase 4), transcript text is never logged |
| Gateway token, Redis password (Postgres from phase 4) | access to sessions and the event pipeline |
| Supply chain (dependencies, images, CI) | a poisoned dependency or action runs with the pipeline's permissions |
| The owner's machine | the dev toolbox mounts the Docker socket; coding agents run with terminal access |

## Who could attack, and how

| Attacker | Path | Main defences |
|---|---|---|
| Someone in the same LAN | calls the API or opens the app | gateway token (phase 1), TLS, only Caddy exposed, Redis and SearXNG unreachable from outside |
| A malicious web page found during research | prompt injection in fetched content; SSRF via crafted URLs | fetched text is delimited as data, no side-effect tools for the LLM, schema-validated output, cited URLs must be from the fetched list; SSRF guard on every fetch incl. redirects (phase 1, brief 15.5) |
| A compromised dependency or action | code execution in CI or at install time | lockfile with `--frozen-lockfile`, pnpm `minimumReleaseAge`, install scripts denied by default (`allowBuilds`), actions pinned by SHA, minimal `permissions`, Trivy, Semgrep, CodeQL |
| A coding agent making a mistake | reads or commits a secret, weakens a rule | secrets live outside the repo, agent hooks and permission deny rules, gitleaks pre-commit and in CI, branch protection with required checks, owner review of every diff |
| Someone who obtained a key | uses it elsewhere | spending limits per provider, separate project keys, rotation procedure below |

## Secrets

- **Where they live:** one file per secret in `SECRETS_DIR`, by default `~/.config/live-factcheck/secrets` (directory `0700`, files `0600`), outside the repository and outside every agent's workspace. `make secrets-init` creates the directory: internal secrets (Redis passwords, SearXNG key, gateway token) get random values, and external API keys stay empty for you to fill in.
- **How services get them:** as Compose secrets mounted under `/run/secrets/<name>`. Services read `<NAME>_FILE` (service-kit `loadConfig`); no secret value appears in the environment of any app container (`docs/evidence/phase-0/t5-security.txt`). The MCP server containers are the exception, see known risks.
- **Least privilege:** gateway and transcription get the Redis password, the two LLM workers additionally get the LLM key, and web gets nothing. Redis uses ACL users: services connect as `app` (no admin or dangerous commands), the Redis MCP server as the read-only `mcp` user, and `default` is disabled.
- **Never:** in git, in an image or build argument, in the frontend bundle or `/config.json`, in logs, errors, metrics or traces. Logs redact secret fields by name and additionally scrub every known secret value from each line (`packages/service-kit/src/logger.ts`, tested).
- **Recommended:** use a dedicated Anthropic API key in its own Claude Console workspace with a spending limit, and do the same with the STT and search providers. For the GitHub MCP server, prefer a fine-grained token limited to this repository (`GITHUB_MCP_TOKEN`) over the broad `gh` login.
- **Filling the files without plain text on disk (optional):** load them from the macOS keychain, for example
  `security find-generic-password -s lfc-anthropic -w > ~/.config/live-factcheck/secrets/anthropic_api_key`.

## Rotating a key

1. Create the new key at the provider (for internal secrets: `LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 40`).
2. Write it into the secret file, keeping the permissions: `chmod 600 <file>`.
3. **Recreate the containers.** Compose does not notice changed secret files, so running containers keep the old value:
   `docker compose up -d --force-recreate`
4. Check that everything is healthy: `make ready`.
5. Revoke the old key at the provider.

## If a key leaks

1. **Revoke** the key at the provider immediately. Do not wait for the investigation.
2. **Create** a new key and roll it out as described above.
3. **Check usage and logs:** the provider's usage dashboard and billing for the period in question, the GitHub audit log, and `make logs` for unexpected calls.
4. **Find the path:** was it committed (`gitleaks git .` over the full history), printed in CI logs, pasted into an agent session, or visible in `docker inspect`?
5. **If it reached git:** a revoked key is harmless, so history rewriting is optional. Document the incident in the PR that fixes the cause.

## Container and network hardening

- All containers run as numeric non-root users with a read-only root filesystem, `cap_drop: [ALL]`, `no-new-privileges`, CPU and memory limits and a healthcheck. Node runtime images are distroless with no shell, and the app code is root-owned, so the process cannot modify it.
- Networks: `edge` (Caddy only, carries the published ports), `frontend` (Caddy, web, gateway; internal), `internal` (services and Redis; no internet, no host access), `egress` (only for services that need the internet, today SearXNG). Only Caddy publishes host ports; web and gateway cannot reach the internet or the host.
- Caddy sets HSTS, a strict CSP (`script-src 'self'`, no `eval`; zod runs `jitless` for that reason), `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and a `Permissions-Policy` that allows only the microphone for the app itself. It sends no CORS headers.

## Known risks and trade-offs

| Risk | Why it is accepted | Mitigation |
|---|---|---|
| A dev container with the Docker socket (root-equivalent on the Docker host) | Testcontainers needs it | only the separate `toolbox-docker` container has it, started on demand by `make test-integration`; the toolbox used by agent hooks and lefthook, which run code without asking, has no socket |
| Docker Desktop lets non-root containers read `0600` secret files; Linux hosts do not | local dev convenience | in CI the throwaway secrets are `0644`; Kubernetes (phase 5) mounts secrets with explicit modes |
| Trivy in PRs ignores critical CVEs without an available fix | nothing we can change blocks every PR otherwise | `nightly.yml` reports HIGH and CRITICAL including unfixed ones |
| The GitHub MCP server falls back to the `gh` token, which has broad scopes | convenience | set a fine-grained `GITHUB_MCP_TOKEN` |
| MCP server containers get their token or password as an environment variable (visible via `docker inspect` while they run) | the official images accept credentials only via env | fine-grained GitHub token; the Redis MCP connects as the read-only `mcp` ACL user (no admin, no writes) |
| The edge-facing images (nginx, Caddy on Alpine) contain a BusyBox shell | upstream ships it; there are no distroless variants | both run non-root, read-only, without capabilities; web has no internet access, Caddy only the published ports |
| The agent-side secrets guard is a regex over the whole tool input (it also blocks in-container secret paths, but cannot catch every indirection, and it also blocks harmless text that merely mentions them) | comfort and early warning only | real secrets are outside the repo; gitleaks, CI and review are the enforcing layers |

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting ("Security" tab → "Report a vulnerability") instead of a public issue.
