# Phase 0: Fundament – Plan

> Grundlage: `docs/PROJECT_BRIEF.md` (Stand mit Abschnitt 1.4 Tool-Unabhängigkeit und 13 Teststrategie).

## Context

Das Repo enthält bisher nur den Brief. Phase 0 legt das Fundament:

- Monorepo, Verträge, service-kit
- lauffähige Service-Skelette in gehärteten Containern
- Compose-Stack mit HTTPS
- ein tool-neutrales Agent-Setup (Claude Code + Antigravity) mit tool-unabhängiger Absicherung über lefthook, CI und `CODEOWNERS`
- das Test-Setup für alle Stufen aus 13.2 mit je einem Beispieltest
- eine CI, die nach 13.3/14.2 geschnitten ist

Am Ende steht ein grüner PR, der alle DoD-Punkte aus Abschnitt 17 belegt.

## Geklärte Entscheidungen (Rückfragen vom 2026-09-25)

| # | Frage | Entscheidung |
|---|---|---|
| 1 | GitHub-Repo | Marco legt das öffentliche Repo `live-factcheck` an, setzt `origin` und authentifiziert `gh`. **Vorbedingung vor Gate 2**, weil ab dort die CI läuft. |
| 2 | Tool-Runtime | Ein dauerhaft laufender `toolbox`-Container (Compose-Profil `dev`). Agent-Hooks **und lefthook** rufen `docker compose exec -T toolbox …` auf. Dasselbe Image ist die Basis für `.devcontainer/`. |
| 3 | Vertragsformate | `schemaVersion: z.literal(1)`, IDs als UUID v4, Zeitstempel als ISO-8601-UTC, `language` als BCP-47, `startMs`/`endMs` als nicht-negative Integer. Dazu ein Envelope `{ type, schemaVersion, payload }`. Festgehalten in ADR 0002. |
| 4 | MCP-Anbindung | MCP-Server laufen als Container (`docker run -i --rm`, offizielle Images), Context7 als Remote-HTTP-Server. Tokens kommen per `${ENV}`. Für Antigravity gibt es dieselben Server als Vorlage. |

Weitere Festlegungen, über die ich selbst entschieden habe (jeweils im ADR begründet):
- Node 24 (aktive LTS), pnpm 10 über corepack, ESM/NodeNext, TypeScript Project References. Paket-`exports` mit der Condition `development` → `src`, default → `dist`.
- Runtime-Images: `gcr.io/distroless/nodejs24-debian12:nonroot` und `nginxinc/nginx-unprivileged`. Healthchecks laufen per Node-Skript aus dem service-kit, ohne curl.
- Grenzprüfung mit **dependency-cruiser**.
- **lefthook ohne Host-Installation:** `make hooks-install` legt einen Shim `.git/hooks/pre-commit` an, der `docker compose exec -T toolbox pnpm exec lefthook run pre-commit` aufruft. gitleaks ist im Toolbox-Image enthalten.
- **Testcontainers in der Toolbox:** Die Toolbox bekommt den Docker-Socket gemountet. Das Risiko (Socket = Root-Äquivalent auf dem Docker-Host) steht in `SECURITY.md`; das betrifft nur das Dev-Profil und nie die Runtime-Images.
- **Keine doppelten CI-Läufe:** `ci.yml` läuft nur auf `push`, `pr.yml` nur auf `pull_request` und enthält ausschließlich die Zusatzstufen. Die Pflicht-Checks im Branch-Schutz greifen auf dieselbe Commit-SHA, egal ob sie aus einem Push- oder einem PR-Lauf stammen (ADR 0005).
- `stt-local` ist nicht Teil von Phase 0. Das Profil `local-stt` wird vorbereitet und bleibt leer.
- Gateway-Token-Auth, Rate Limiting und Redis-Streams-Helper kommen in Phase 1, sobald es die erste API-Route bzw. den ersten Stream-Konsumenten gibt (kein Überbau).

Kürzel: `tb` = `docker compose --profile dev exec -T toolbox`.

---

## TP1 – Repo-Grundlagen, Toolbox, Secrets, lefthook

**T1.1 Repo-Hygiene**
- Dateien: `.gitignore` (`.env`, `.DS_Store`, `node_modules`, `dist`, `coverage`, `playwright-report`), `.dockerignore`, `.editorconfig`, `.nvmrc`
- Verifikation: `git check-ignore .env .DS_Store`

**T1.2 pnpm-Workspace + TS-Basis**
- Dateien: `package.json` (root; Scripts `lint`, `typecheck`, `test:unit`, `test:int`, `depcruise`, `format`), `pnpm-workspace.yaml` (`apps/*`, `services/*`, `packages/*`, `tests/*`), `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), `tsconfig.json` (references), `vitest.workspace.ts`
- Verifikation: `tb pnpm install --frozen-lockfile && tb pnpm typecheck`

**T1.3 Stufe 0: Lint, Format, Grenzen**
- Dateien:
  - `eslint.config.js` (`typescript-eslint` strict-type-checked, `no-explicit-any`, `ban-ts-comment` nur mit Beschreibung)
  - `.prettierrc`
  - `.dependency-cruiser.cjs` mit den Regeln: kein `services/* → services/*` oder `apps/*`, keine Deep-Imports in `packages/*/src`, keine Zyklen
- Verifikation: `tb pnpm lint && tb pnpm depcruise`. Dazu ein Negativtest mit einem temporären Verstoß; die Ausgabe kommt in die Evidence.

**T1.4 Toolbox**
- Dateien: `tools/toolbox/Dockerfile` (node:24-bookworm-slim, corepack, git, gitleaks-Binary per Checksum, Non-Root) und `compose.dev.yaml` (Service `toolbox`, Profil `dev`, Repo-Mount, pnpm-Store-Volume, Docker-Socket)
- DevOps-Notiz: Das pnpm-Store-Volume hält Installs schnell und verhindert, dass auf dem Host ein `node_modules` mit falscher Architektur landet.
- Verifikation: `make toolbox && tb node --version` meldet v24.x

**T1.5 Secrets außerhalb des Repos**
- Dateien:
  - Make-Ziel `secrets-init`: legt `${SECRETS_DIR:-~/.config/live-factcheck/secrets}` mit Rechten `700` an, dazu leere Platzhalter mit `600` (`redis_password`, `searxng_secret`, `anthropic_api_key`, `gateway_token` …). Bestehende Dateien werden nie überschrieben.
  - `.env.example`: nur nicht-geheime Werte plus `SECRETS_DIR`
- Verifikation: `make secrets-init` zweimal ausführen, dann `stat -f '%Lp %N'` auf Verzeichnis und Dateien. Die Rechte kommen in die Evidence, die Inhalte nie.

**T1.6 lefthook (tool-unabhängige Absicherung)**
- Dateien: `lefthook.yml` mit `pre-commit`, parallel und nur auf gestagte bzw. betroffene Pakete: gitleaks (`protect --staged`), Prettier-Check, ESLint, Typecheck, `vitest related --run`, depcruise. Dazu das Make-Ziel `hooks-install` mit dem Shim.
- Verifikation:
  1. Ein Commit mit einem Dummy-Key wird blockiert.
  2. `time git commit` auf eine normale Änderung liegt unter 30 s (**DoD**).

**T1.7 Regeldateien + ADR 0001**
- Dateien:
  - `AGENTS.md`: maßgeblich; Stack, `make`-/`tb`-Befehle, Konventionen, Architekturüberblick, Regel „Plan-Datei so aktuell halten, dass eine neue Session ohne Rückfragen weitermacht“, Übergabe zwischen den Tools
  - `CLAUDE.md`: `@AGENTS.md` plus die Regel zu `/compact` bei 60–70 % und der Hinweis „vor `/compact` den Plan aktualisieren“
  - `docs/adr/0000-template.md`, `docs/adr/0001-monorepo-and-toolchain.md`

**🛑 Gate 1** (nur Konfiguration, keine Logik)

---

## TP2 – Verträge, service-kit, Push-CI, Vertragsschutz

**T2.1 `packages/contracts`** (erstmalige Anlage, freigegeben über diesen Plan und ADR 0002)
- Dateien: `src/{common,transcript-segment,claim-detected,claim-checked,envelope,index}.ts`, `AGENTS.md`, `CLAUDE.md`, `README.md`
- Form: `export const ClaimChecked = z.object({ schemaVersion: z.literal(1), … }).strict(); export type ClaimChecked = z.infer<typeof ClaimChecked>;`. Optional ist nur `sources[].snippet`.
- Tests: `src/*.test.ts` mit gültigen und ungültigen Fixtures (falsches Verdict, 3 Sätze, fremde `schemaVersion`, zusätzliches Feld)
- Verifikation: `tb pnpm --filter @lfc/contracts test:unit`

**T2.2 `packages/service-kit`**
- Module:
  - `config.ts`: `loadConfig(schema, { secretKeys }, env)` löst `<KEY>_FILE` auf. Sind `KEY` und `_FILE` beide gesetzt, ist das ein Fehler. `ConfigError` listet alle Probleme auf, ohne Werte.
  - `logger.ts`: pino mit `redact` (Secret-Keys, `*.apiKey`, `*.password`, `headers.authorization`); Pflichtfeld `service`, Korrelation über `sessionId`/`claimId`
  - `http.ts`: `createOpsServer` baut Fastify mit `/healthz`, `/readyz` (200/503 + Status pro Check) und `/metrics` (prom-client)
  - `redis.ts`: `createRedis` liefert einen ioredis-Client plus einen `ReadinessCheck` per `PING`
  - `lifecycle.ts`: `runService({ name, configSchema, secretKeys, start })` behandelt SIGTERM/SIGINT mit Timeout. Ein `ConfigError` führt zu einer JSON-Logzeile und Exit 1.
  - `bin/healthcheck.ts`
- Tests:
  - Stufe 1: `config.test.ts`, `logger.test.ts` (Key taucht in keiner Zeile auf, auch nicht verschachtelt oder in Error-Objekten), `lifecycle.test.ts` (echter Kindprozess, SIGTERM → Exit 0)
  - Stufe 2a (erstes Beispiel): `redis.int.test.ts` mit Testcontainers-Redis inklusive Passwort; Readiness wechselt von 503 auf 200. Parallel-sicher durch ein eigenes Key-Präfix pro Worker.
- Verifikation: `tb pnpm --filter @lfc/service-kit test:unit test:int`

**T2.3 `ci.yml` (jeder Push)**
- Jobs, parallel und per `needs` fail-fast:
  - `static`: Typecheck, Lint, depcruise, gitleaks
  - `backend-unit`, `backend-int`, `frontend-unit`, `frontend-int`: Matrix über die betroffenen Pakete via `pnpm --filter "...[origin/main]"`. Die Frontend-Jobs entstehen hier als Hülle und werden ab TP4/TP6 gefüllt.
  - JUnit-Reports als Check-Annotation, Coverage-Report pro Paket (noch ohne Schwelle; die kommt in Phase 1)
- Querschnitt: `concurrency` mit `cancel-in-progress`, minimale `permissions`, Actions per SHA gepinnt, Cache für pnpm-Store
- ADR: `docs/adr/0005-ci-workflow-layout.md`

**T2.4 Vertragsschutz**
- Dateien:
  - `scripts/check-contract-change.sh`: Ändert sich etwas unter `packages/contracts/`, muss im Diff gegen die Basis ein ADR neu oder geändert sein, und bei einem geänderten Schema muss `schemaVersion` gestiegen sein. Neue Schemas mit `1` sind erlaubt.
  - `CODEOWNERS` für `packages/contracts/`, `.github/`, `deploy/` und `infra/`
  - Der Check wird in `pr.yml` eingebunden (neu, zunächst nur dieser Job).
- Verifikation: Push des Branches, Draft-PR öffnen, `ci.yml` und der Vertrags-Check sind grün. In einem Wegwerf-Branch ohne ADR schlägt der Check fehl; die Ausgabe kommt in die Evidence.

**🛑 Gate 2** (kritischster Diff: Verträge und service-kit)

---

## TP3 – Tool-neutrales Agent-Setup (1.1 / 1.4)

**T3.1 Recherche**
- `.ai/research/mcp-servers.md`: verifizierte offizielle Images/Endpoints für GitHub, Context7, Docker-MCP und Redis-MCP. Pro Server: Wartungsstatus, Env-Variablen, Risiken, Antigravity-Format.
- `.ai/research/antigravity.md`: wie Antigravity `AGENTS.md`, `.agents/skills` und `mcp_config.json` liest und wie Agenten bzw. Workflows eingebunden werden

**T3.2 Prompts + Claude-Hüllen**
- Prompts: `.ai/prompts/{reviewer,security-reviewer,platform-engineer}.md`. Modellneutral, kein Claude-spezifisches Ausgabeformat, Befunde mit Datei:Zeile, der Reviewer schreibt keinen Code.
- Claude-Hüllen: `.claude/agents/*.md` bestehen nur aus Frontmatter (Name, Beschreibung, read-only Tools) und dem Verweis auf den Prompt.

**T3.3 Skills**
- `.agents/skills/{new-service,new-event-contract,adr,evidence}/SKILL.md` plus `templates/`
- Symlink `.claude/skills -> ../.agents/skills`
- `new-service` erzeugt auch `AGENTS.md` + `CLAUDE.md`; der Referenzservice ist der Gateway aus T4.1.

**T3.4 Agent-Hooks (Komfort, nicht die eigentliche Absicherung)**
- `.claude/settings.json` + `.claude/hooks/*.sh`:
  - `guard-secrets.sh` (PreToolUse `Read|Edit|Write|Bash|Grep|Glob`): blockiert `.env` (nicht `.env.example`) und jeden Pfad unter `${SECRETS_DIR}` bzw. `~/.config/live-factcheck/secrets`
  - `warn-contracts.sh` (PreToolUse `Edit|Write`): **warnt** bei `packages/contracts/**`, blockiert aber nicht
  - `format-lint.sh` (PostToolUse): `tb prettier --write` + `eslint --fix` auf die Datei. Ohne laufende Toolbox gibt es nur eine Warnung.
  - `stop-tests.sh` (Stop): führt `tb pnpm --filter "...[main]" test:unit` aus; Exit 2 bei Rot, `stop_hook_active` verhindert Schleifen
  - `session-start.sh`: gibt `## Status` der aktuellen Plan-Datei aus
  - `pre-compact.sh`: hängt Zeitstempel, `git status` und `diff --stat` an `## Session-Log` an. *Einschränkung:* Inhaltliche Erkenntnisse schreibt Claude selbst vor `/compact`; das regelt `CLAUDE.md`.
- Verifikation: Read auf `.env` wird blockiert, ein Edit in contracts erzeugt eine Warnung. Die Ausgaben kommen in die Evidence.

**T3.5 MCP für beide Tools**
- Dateien: `.mcp.json` (github, context7, docker, redis im Netz `lfc_internal`, ohne Tokens) und `tools/antigravity/mcp_config.example.json` (dieselben Server, Platzhalter `__REPO_ROOT__`)
- Make-Ziel `agent-setup`: erzeugt `~/.gemini/antigravity/mcp_config.json` mit absoluten Pfaden. Eine vorhandene Datei wird nur mit Rückfrage bzw. Backup überschrieben.
- `docs/ai-tooling.md`: Einrichtung beider Tools auf einem neuen Rechner, Übergabe-Ablauf nach 1.4, Hinweis auf die Freigabepflicht für Terminal-Befehle
- Verifikation: `/mcp` in Claude Code zeigt vier Server. Der Redis-MCP wird nach TP5 funktional geprüft.

**🛑 Gate 3**

---

## TP4 – Services, Web, Dockerfiles, PR-Build

**T4.1 `services/gateway` (Referenzservice)**
- Dateien: `src/config.ts`, `src/main.ts`, `Dockerfile`, `AGENTS.md`, `CLAUDE.md`, `test/startup.test.ts`
- Dockerfile-Stages: `base` → `deps` (`pnpm fetch`) → `dev` (tsx watch) → `build` (`pnpm deploy --prod /out`) → `runtime` (distroless nonroot)
- `startup.test.ts`: Start ohne `REDIS_URL` → Exit 1 mit einer klaren Meldung (**DoD: fail-fast**)
- `secrets.int.test.ts`: startet das gebaute Image mit Compose-Secret-Mount (`REDIS_PASSWORD_FILE=/run/secrets/redis_password`) und prüft, dass `/readyz` gegen einen Redis mit Passwort 200 liefert (**DoD: Secrets aus `${SECRETS_DIR}`**; die Testdatei entsteht in einem Temp-Verzeichnis, das als `SECRETS_DIR` übergeben wird)
- ADR: `docs/adr/0003-container-images-and-hardening.md`

**T4.2 `transcription`, `claim-extractor`, `fact-checker`** über den Skill `new-service`, je ein Subagent mit engem Briefing
- Extractor und Checker validieren `EXTRACTOR_LLM_*` bzw. `CHECKER_LLM_*` und loggen nur, welcher Provider aktiv ist.
- `fact-checker/test/secret-redaction.test.ts`: Kindprozess mit einem zufälligen Key; die komplette Ausgabe wird durchsucht (**DoD: kein Key im Log**)

**T4.3 `apps/web`**
- Vite + React + TS + Tailwind + Zustand; App-Shell mit `data-testid="app-shell"`, Texte aus `src/i18n/de.json`
- Stufe 1 Frontend: `src/app/useRuntimeConfig.test.ts` (lädt `/config.json`, Fehlerzustand) mit Testing Library
- Runtime: nginx-unprivileged, ein Entrypoint erzeugt `/tmp/config.json` aus `WEB_GATEWAY_URL`; read-only + tmpfs

**T4.4 `pr.yml`: Image, Scan, SAST**
- Jobs:
  - Image-Build pro Service **nur `linux/amd64`** mit gha-Cache
  - Trivy (`CRITICAL` → Fail)
  - hadolint, Semgrep, CodeQL (`codeql.yml` oder als Job)
  - dazu der Vertrags-Check aus T2.4

**🛑 Gate 4**

---

## TP5 – Compose-Stack, Dev-Modus, Makefile

**T5.1 `docker-compose.yml`**
- Netzwerke:
  - `edge`: caddy, web, gateway
  - `internal` (`internal: true`): Services, redis
  - `egress`: searxng; ab Phase 1 auch die Worker
- Compose-Secrets: `file: ${SECRETS_DIR}/…`, nur an die Services, die das jeweilige Secret brauchen
- `redis`: Ein Entrypoint erzeugt ein ACL-File in tmpfs (`user default off`, `user app on >…`).
- `searxng`: `deploy/compose/searxng/settings.yml` mit JSON-Format
- `caddy`: `deploy/compose/Caddyfile` mit `tls internal` für `localhost` und `{$LAN_HOST}`, CSP, HSTS, `Permissions-Policy: microphone=(self)`, CORS; `/api/*` und `/ws/*` gehen an den gateway. **Einzige Host-Ports: 80 und 443.**
- Für alle Services: `read_only`, `tmpfs`, `cap_drop: [ALL]`, `no-new-privileges`, Limits, Healthchecks
- ADR: `docs/adr/0004-compose-network-topology.md`

**T5.2 Dev-Modus**
- `compose.dev.yaml` mit `target: dev` und `develop.watch` (Quellen per `sync`, Manifeste per `rebuild`)
- `.devcontainer/devcontainer.json` auf Basis der Toolbox

**T5.3 Makefile**
- Ziele: `up`, `up-local`, `dev`, `down`, `logs`, `lint`, `test-unit`, `test-integration`, `test-api`, `test-e2e`, `test` (Stufen 0–4), `eval`, `scan`, `secrets-init`, `agent-setup`, `hooks-install`, `toolbox`, `ready`, `check-ports`
- `eval` und `up-local` melden in Phase 0 ehrlich „ab Phase 1/2“.
- Verifikation: `make up`, `make ready`, `make check-ports`, `make scan`

**🛑 Gate 5** (erster lokaler DoD-Durchlauf)

---

## TP6 – Teststufen 2b–5 und restliche Workflows

**T6.1 Stufe 2b Frontend-Integration**
- Ort: `apps/web/tests/`, mit `playwright.config.ts`, Page Object `app-shell.page.ts` und Fixture für Token + `config.json`
- Beispieltest: `app-shell.spec.ts` läuft gegen `vite preview`; `/config.json` kommt per `page.route`, dazu ein `@axe-core/playwright`-Check
- Projekte: `chromium-desktop`, `chromium-mobile`, `webkit-iphone`
- Ausführung im offiziellen Playwright-Image

**T6.2 Stufe 3 API**
- Dateien: `tests/api/` mit `playwright.config.ts` (nur `APIRequestContext`)
- Beispieltest: `ops.spec.ts` prüft `/healthz` und `/readyz` aller Services im Compose-Netz sowie 404 auf eine unbekannte Route über Caddy

**T6.3 Stufe 4 E2E**
- Dateien: `tests/e2e/`, Beispieltest `smoke.spec.ts` gegen `https://localhost` über `network_mode: service:caddy`
- Drei Projekte wie in 2b, mit `fullyParallel`
- DevOps-Notiz: Durch `network_mode` landet `localhost` im Testcontainer direkt bei Caddy, ohne weiteren Host-Port.

**T6.4 Stufe 5 (Setup)**
- Stryker für `packages/contracts` (`stryker.config.mjs`) und Lighthouse CI gegen `web` (`lighthouserc.json`)
- Eval, k6 und die iPhone-Checkliste folgen in späteren Phasen, wie im Brief festgelegt.

**T6.5 Workflows**
- `pr.yml` erweitert um: Compose-Stack aus den eben gebauten Images, Stufe 3 und 4 mit `--shard=i/n`, Blob-Reports zusammenführen, Artefakte (Report + Traces)
- `main.yml`: Multi-Arch-Build (amd64/arm64 via QEMU), Push nach GHCR mit SHA-Tag, Stufe 3 und 4 gegen die gepushten Images
- `nightly.yml`: Stryker, Lighthouse, volle Browser-Matrix, erneuter Trivy-Scan; Evals als `workflow_dispatch`-Platzhalter
- Verifikation: Die PR-Checks sind grün, und im Actions-Graph laufen Backend- und Frontend-Jobs parallel (Screenshot → **DoD**).

**🛑 Gate 6**

---

## TP7 – Dokumentation, Reviews, PR

- **T7.1 `docs/SECURITY.md`:** Threat Model, Key-Rotation, Notfallablauf, Risiken von Docker-Socket und Toolbox/MCP, Secrets außerhalb des Repos
- **T7.2 `README.md`:**
  - Badges, Mermaid-Diagramm, „Was dieses Projekt zeigt“
  - Schnellstart (`secrets-init` → `up`)
  - iPhone-Zertifikat plus cloudflared-Alternative
  - Empfehlungen zu Branch-Protection und zum Claude-Console-Workspace
  - Schlüsselbund-Beispiel
- **T7.3 `AGENTS.md`/`CLAUDE.md`** aller Pakete gegen den Endstand abgleichen
- **T7.4 Antigravity-Probe:** In einer frischen Antigravity-Session „Lies `AGENTS.md` und den aktuellen Plan“ ausführen und prüfen, ob der nächste Task ohne Rückfragen benannt wird (Screenshot bzw. Transkript, **DoD**). Das braucht Marcos Antigravity-Zugang.
- **T7.5 Evidence** unter `docs/evidence/phase-0/` über den Skill `evidence`
- **T7.6 Reviews:** `reviewer`, `security-reviewer`, `/code-review`, `/security-review`
- **T7.7 PR auf „Ready“:** mit Zusammenfassung, Nachweisen, Review-Hinweisen, benannten Abweichungen und der Angabe, welche Tasks mit welchem Tool entstanden sind

**🛑 Gate 7**: Marco reviewt Datei für Datei und merged selbst.

## Abweichungen und Präzisierungen gegenüber dem Brief (werden im PR benannt)

1. lefthook läuft per Shim in der Toolbox statt als Host-Binary, damit auf dem Host nur Docker nötig ist.
2. `pre-compact.sh` sichert nur Metadaten; inhaltliche Notizen sichert eine Regel in der `CLAUDE.md`.
3. Zusätzliches Netzwerk `egress`, weil `internal: true` jeden ausgehenden Verkehr sperrt.
4. Die Toolbox bekommt den Docker-Socket, damit Testcontainers läuft. Das gilt nur für das Dev-Profil.

## DoD-Verifikation

| DoD | Nachweis |
|---|---|
| `make up`, `https://localhost` zeigt die App, alle `/readyz` grün | `make ready` + E2E-Screenshot |
| Nur Caddy hat Host-Ports | `make check-ports` |
| `make scan` ohne kritische Befunde | Trivy-Ausgabe |
| Fail-fast bei fehlender Config | `gateway/test/startup.test.ts` |
| Kein API-Key im Log | `fact-checker/test/secret-redaction.test.ts`, `service-kit/logger.test.ts` |
| Erster PR grün, Badge in der README | CI-Links + README |
| Pre-Commit unter 30 s, Push-Jobs BE/FE parallel | `time git commit`, Actions-Graph |
| Kein Secret im Repo, Services lesen aus `${SECRETS_DIR}` | gitleaks über die gesamte Historie + `gateway/test/secrets.int.test.ts` |
| Antigravity benennt den nächsten Task ohne Rückfragen | T7.4-Transkript |

## Status

- [x] Plan freigegeben (2026-09-25)
- Aktuelles Gate: vor Gate 1 (TP1 in Arbeit)
- Nächster Task: T1.1

## Session-Log
