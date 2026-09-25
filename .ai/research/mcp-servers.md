# MCP servers for this repo (research, 2026-09-25)

Selection rule (brief 1.1): few servers, official or well maintained, no tokens in config files.

| Server | Source | Transport | Pinned | Maintenance | Config |
|---|---|---|---|---|---|
| GitHub | `github/github-mcp-server` (official, GitHub) | `docker run -i` | `ghcr.io/github/github-mcp-server:v1.12.2` (2026-09-16, amd64+arm64) | very active, 33k stars | `GITHUB_PERSONAL_ACCESS_TOKEN`, `GITHUB_TOOLSETS`, `GITHUB_READ_ONLY=1` |
| Context7 | `upstash/context7` | remote HTTP `https://mcp.context7.com/mcp` | – (remote) | very active | optional API key header for higher rate limits; works without |
| Redis | `redis/mcp-redis` (official, Redis) | `docker run -i` | `mcp/redis@sha256:e886a7e9…fa0` (only `latest` published; built and signed by Docker, amd64+arm64) | active, last push 2026-09-21 | `REDIS_HOST`, `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PWD` |
| Docker | none official | – | – | `mcp/docker` is a stale gateway (~1 year), alternatives are community projects | **not used**, see ADR 0006 |
| Playwright (Phase 1) | `microsoft/playwright-mcp` | – | – | – | later |
| Kubernetes (Phase 5) | – | – | – | – | later, read-only |

## Decisions and findings

- **Tokens:** GitHub MCP gets its token at launch from `GITHUB_MCP_TOKEN` (fine-grained PAT, preferred) or falls back to `gh auth token`. Nothing is stored in the config.
- **Least privilege:** GitHub toolsets limited to `repos,issues,pull_requests,actions`. Redis MCP uses a dedicated read-only ACL user `mcp` (secret `redis_mcp_password`), created with the Compose stack in TP5.
- **Redis MCP tools** cover streams (read, consumer groups, pending, ack) and pub/sub. With the read-only ACL user, write tools fail at Redis level. The image has no read-only switch itself.
- **Network:** Redis MCP joins the Compose network `live-factcheck_internal` (exists from TP5), so Redis needs no host port.
- **GUI apps and PATH:** Antigravity is a GUI app and does not inherit shell env/PATH. Servers are launched through `/bin/zsh -lc` so `docker`, `gh` and the user's env are available. Claude Code uses the same commands for parity.
- **Docker socket:** every Docker MCP server needs the socket (root-equivalent on the Docker host). Agents already have a terminal with `docker compose ps|logs|exec`, which gives the same evidence without the extra attack surface.

Sources: github.com/github/github-mcp-server, github.com/redis/mcp-redis, hub.docker.com/r/mcp/redis, hub.docker.com/r/mcp/docker, docs.docker.com/ai/mcp-catalog-and-toolkit/toolkit/
