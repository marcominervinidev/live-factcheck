# 0004: Compose stack topology and hardening

- Status: accepted
- Date: 2026-09-25

## Context

`make up` must start the whole system locally in containers (brief 12) with the same topology Kubernetes will use later (factor X). Brief 15.3–15.5 require: only Caddy publishes host ports; separate networks for edge and internal traffic; outbound internet only where needed; Redis with password (ACL); non-root, read-only containers with `cap_drop: [ALL]`, `no-new-privileges` and resource limits; secrets from a directory outside the repo. The iPhone needs HTTPS for the microphone, so TLS is terminated locally.

## Decision

**Three networks**

| Network | Members | Purpose |
|---|---|---|
| `edge` | caddy | carries the published host ports (a network with published ports cannot be internal) |
| `frontend` (`internal: true`) | caddy, web, gateway | the only path from Caddy to the app; web and gateway get no internet or host access |
| `internal` (`internal: true`) | gateway, transcription, claim-extractor, fact-checker, redis, searxng | service-to-service traffic; no route to the internet or the host |
| `egress` | searxng (later: LLM, STT and fetch clients) | outbound internet |

The brief names `edge` and `internal`. `frontend` was split off after the phase 0 security review: in a normal bridge network, web and gateway could have reached the internet and `host.docker.internal`. `egress` exists because `internal: true` blocks all outbound traffic; it is the Compose equivalent of a Kubernetes egress NetworkPolicy.

**Edge (Caddy)**
- Own image based on `caddy:2.11.4-alpine`, running as uid 1000. It listens on 8080/8443 inside the container, published as `${LFC_HTTP_PORT:-80}` and `${LFC_HTTPS_PORT:-443}`, so it needs no `NET_BIND_SERVICE`. The upstream binary's file capability is removed, because the kernel refuses to exec it under `cap_drop: ALL` + `no-new-privileges`.
- `tls internal` for `localhost` and `${LAN_HOST}`; the local CA lives in the `caddy-data` volume, so the iPhone trusts it once.
- Security headers: HSTS, CSP (`script-src` can be relaxed only by the dev overlay for Vite's inline refresh preamble), `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` (`microphone=(self)`), COOP. No CORS headers, so the app is same-origin only.
- `/api/*` and `/ws/*` go to the gateway, everything else to web. `http://` redirects to HTTPS; `/healthz` on the HTTP port serves the container healthcheck.

**Redis**
- The official image with an entrypoint script that builds an ACL file on tmpfs from the Compose secrets. Passwords are stored as SHA-256 hashes, never in plain text.
- Users:
  - `default`: off.
  - `app` (services): everything except `@admin` and `@dangerous`.
  - `mcp` (Redis MCP server): `@read`, `@connection`, `@pubsub` subscribe, `XINFO` and `XPENDING`; all writes are denied by Redis itself.
- AOF persistence on a named volume.

**SearXNG** runs as its own user (977) with the settings file mounted read-only and its cache on tmpfs. Its secret key comes from the Compose secret via `SEARXNG_SECRET`, and it refuses to start without one.

**Every container** is read-only with a tmpfs for `/tmp`, has `cap_drop: [ALL]`, `no-new-privileges`, CPU and memory limits, a healthcheck and `init: true`. Services get only the secrets they use: the gateway and transcription get the Redis password, the LLM workers additionally get the Anthropic key file, and web gets none.

**Secrets** are Compose secrets with `file: ${SECRETS_DIR}/<name>`, where `SECRETS_DIR` defaults to `~/.config/live-factcheck/secrets` outside the repo. Services read them via `<NAME>_FILE`. Empty values (e.g. an unused provider's key file, or `${VAR:-}`) count as "not set" (service-kit).

**Dev mode** (`compose.dev.yaml`, `make dev`):
- Dev stages with tsx and Vite, synced by `docker compose watch`.
- The root filesystem is writable, because watch syncs files into the container.
- Caddy proxies to Vite (`WEB_UPSTREAM=web:5173`) and allows inline scripts, in dev only.

## Alternatives

- **One flat network:** simpler, but any compromised container could reach Redis and the internet.
- **Traefik or nginx as edge proxy:** Caddy's `tls internal` makes a trusted local CA a one-liner, which matters for the iPhone.
- **Caddy as root with `NET_BIND_SERVICE`:** works, but needs capabilities and root; unprivileged ports plus port mapping need neither.
- **Redis `requirepass` only:** one shared password; ACL users allow a read-only MCP user and deny admin commands to services.
- **Secrets in `.env`:** simplest, but lands in the agents' workspace and in `docker inspect` output.

## Consequences

- On macOS, Apache may already hold port 80; `LFC_HTTP_PORT` moves the redirect port. HTTPS should stay on 443 so URLs need no port.
- Compose secrets are bind mounts. Docker Desktop lets non-root containers read `0600` files; on a Linux host the files need the container's uid or group permissions (relevant only if the stack runs on Linux without Kubernetes).
- The dev overlay trades the read-only filesystem and a strict CSP for hot reload; the production overlay (`docker-compose.yml` alone) is what CI and evidence use.
- The same segmentation becomes NetworkPolicies in phase 5.
