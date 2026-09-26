# Phase 1: Faktencheck im Textmodus – Plan

> Grundlage: `docs/PROJECT_BRIEF.md` (neue Fassung vom 2026-09-26, Commit `e0451a3`), `AGENTS.md`, ADR 0001–0006.
> Recherche: `.ai/research/llm-providers.md`, `.ai/research/research-pipeline.md`, `.ai/research/classifier-jev.md`, `.ai/research/evidence-sources.md`.
> Branch: `phase-1-faktencheck-textmodus` (gestapelt auf `phase-1/plan` → `phase-0/tp7-docs-reviews`, solange PR #5–#7 offen sind). Ersetzt den nicht freigegebenen Entwurf `phase-1-textmodus.md`.

## Context

Man tippt eine Behauptung ein; die App prüft sie gegen drei Quellenstufen (Faktenchecks, Wikipedia/Wikidata, Websuche), ein **Klassifikator** fällt das Urteil mit Wahrscheinlichkeiten, das Urteil erscheint sofort als Karte, und die Erklärung eines LLM wird nachgereicht. Der Weg ist schon der spätere Live-Weg: `gateway` → `claims.detected` → `fact-checker` → `claims.checked` → `explainer` → `claims.explained`, alles über Pub/Sub und WebSocket zum Browser. Phase 2 setzt nur noch Audio, Transkription und den dreistufigen `claim-extractor` davor.

**DoD (Brief 17):** Eine eingetippte Behauptung wird mit Claude, mit LM Studio bzw. Ollama und (falls verfügbar) mit Jev als Klassifikator geprüft. Alle Varianten funktionieren, das Urteil erscheint vor der Erklärung, und ein Eval-Report vergleicht Trefferquote, Kalibrierung, Latenz und Kosten.

## Gap-Analyse: Stand nach Phase 0 gegen den neuen Brief

Legende: **N** = Nachzieharbeit in TP0, **P1** = regulärer Phase-1-Scope, **später** = laut Brief spätere Phase, **ADR** = bewusste Abweichung, per ADR entschieden.

| # | Abschnitt | Soll laut Brief | Ist nach Phase 0 | Einordnung |
|---|---|---|---|---|
| 1 | 1.1, 1.3 | (neuer Brief) Docker-MCP ab Phase 0 | kein Docker-MCP | **erledigt**: Rücknahme war unbeabsichtigt (Marco, 2026-09-26); Brief wieder auf ADR 0006 gesetzt |
| 2 | 1.1, 1.4, 16 | (neuer Brief) `tools/antigravity/`-Vorlage + `make agent-setup` | `.agents/mcp_config.json` im Workspace | **erledigt**: Brief wieder auf ADR 0006 gesetzt |
| 3 | 1.1, 1.4 | (neuer Brief) Antigravity-Agenten bzw. Workflows | Subagents in `.agents/agents/` | **erledigt**: Brief wieder auf ADR 0006 gesetzt |
| 4 | 1.4, 16 | (neuer Brief) verschachtelte `AGENTS.md` direkt gelesen | Glob-Regeln `.agents/rules/` | **erledigt**: Brief wieder auf ADR 0006 gesetzt |
| 5 | 16 | (neuer Brief) `tools/antigravity/` | `tools/toolbox/` | **erledigt**: Brief wieder auf ADR 0001 gesetzt |
| 6 | 15.4 | `edge` für caddy, web, gateway | `edge` nur Caddy, internes `frontend`, `egress` | **erledigt**: Brief 15.4 erstmals an ADR 0004 angepasst |
| 7 | 1.1 | Playwright-MCP ab Phase 1 | fehlt in `.mcp.json` | **N** T0.4 |
| 8 | 1.2 | `.ai/summaries/` für stark veränderte Codebereiche | fehlt | **N** T0.1 |
| 9 | 5, 6, 16 | Service `explainer` | fehlt | **N** T0.5 (Skelett), **P1** T4.3 (Logik) |
| 10 | 9, 16 | `packages/research` | fehlt | **N** T0.5 (Skelett), **P1** TP3 |
| 11 | 9.1, 16 | `config/source-tiers.yaml` | fehlt | **N** T0.5 (Datei + Schema), **P1** T3.3 (Nutzung) |
| 12 | 8, 8.1 | Konfiguration pro Aufgabe: `EXTRACTOR_LLM_*`, `CHECKER_LLM_*`, `*_CLASSIFIER_PROVIDER`, Konfidenzschwellen; Erklärung per LLM | nur `EXTRACTOR_LLM_*`, `CHECKER_LLM_*` | **N** T0.6 (Konfigurationsschema, `.env.example`), **P1** TP2 |
| 13 | 9.2 | `EmbeddingProvider` | fehlt | **P1** T2.4 |
| 14 | 15.1 | Least Privilege: je Service nur seine Keys; `explainer` ohne Jev-Key | Secrets nur für Redis, SearXNG, Gateway-Token, Anthropic | **N** T0.6 (`secrets-init`, Compose-Secrets je Service) |
| 15 | 15.4 | Nur Services mit Internetbedarf bekommen Ausgang | `fact-checker` nur `internal` | **N** T0.6 (`fact-checker`, `explainer` zusätzlich `egress`; ADR 0004 ergänzt) |
| 16 | 7 | ClaimDetected v2, ClaimChecked v2, ClaimExplained, TopicDetected, Evidence | v1-Verträge ohne diese Felder | **P1** TP1 (vom Owner am 2026-09-26 ausdrücklich freigegeben) |
| 17 | 6.7, 6.8, 15.5 | `POST /api/claims/check`, `/ws/session`, Token-Schutz, Rate Limit, Größenlimits, Tagesbudget | Gateway ist Skelett | **P1** TP5 |
| 18 | 9.5, 9.6 | exakter Urteils-Cache, Such- und Seiten-Cache in Redis, keine vorgenerierten Frage-Antwort-Paare | fehlt | **P1** TP3/TP4, ADR 0008 |
| 19 | 11 | Karten mit Chip, Konfidenzbalken, Beleg, Badges, nachgereichter Erklärung, „unsicher“, Hinweis „automatische Einschätzung“, Zeitleiste, Einstellungsseite | leere App-Shell | **P1** TP6 (Transkript-Markierungen erst mit Transkript in Phase 2) |
| 20 | 13.5 | Coverage-Schwelle 80 % Zeilen und Branches | Coverage wird berichtet, keine Schwelle | **P1** T7.5 |
| 21 | 13.5 | Stryker nightly für `contracts`, `providers`, Deduplizierung; Score vertrauenswürdig | nur `contracts`, Score 44,7 % nicht belastbar | **P1** T7.5 (`providers` dazu, Ursache der „survived“-Mutanten klären); Deduplizierung in Phase 2 |
| 22 | 13.5, 16 | `evals/claims.de.jsonl` (≥ 200), `evals/detection.de.jsonl`, `evals/SOURCES.md`, `pnpm eval` mit Kalibrierung | fehlt; `make eval` meldet „ab Phase 1“ | **N** T0.5 (Workspace + `SOURCES.md`), **P1** TP7 (Urteils-Set), Erkennungs-Set **später** (Phase 2 laut 17) |
| 23 | 14.2, 15.2 | Renovate oder Dependabot ab Phase 1 | fehlt | **P1** T7.6 |
| 24 | 14.2 | Evals per `workflow_dispatch` in `nightly.yml` | Platzhalter | **P1** T7.6 |
| 25 | 15.6 | Jev: Pseudonyme, im lokalen Modus aus, Anbieter im Einwilligungsdialog | fehlt | **P1** T2.3 (Pseudonyme), T0.6 (lokaler Modus schlägt fehl, wenn Cloud-Provider konfiguriert), TP6 (Einstellungsseite nennt Anbieter); Einwilligungsdialog **später** (Phase 2, mit der Aufnahme) |
| 26 | 12 | `make eval`, `make up-local` | Platzhalter | `eval` **P1** T7.3; `up-local` **später** (Phase 2) |
| 27 | 13.6, 17 | `docs/testing/iphone-smoke.md` | fehlt | **später** (Phase 2 laut 17) |
| 28 | 8.1, 5 | `claim-extractor` dreistufig, `topic-tracker`, `local-model` | Skelett bzw. fehlt | **später** (Phase 2, 4, 7) |
| 29 | 17 | Phase 7 optional, eval-gesteuert, F1-Startwert 0,85 per ADR | – | **später**; Kennzahl F1 wird im Eval-Report für Phase 2 vorbereitet |
| 30 | 1.2 Schritt 7 | Abweichungen im selben PR im Brief bzw. ADR nachziehen | Zeilen 1–6 | **erledigt**: Brief angepasst, `docs/architecture.md` listet keine offenen Abweichungen |

## Geklärte Entscheidungen

Aus dem Entwurf vom 2026-09-26 (bleiben gültig): WebSocket `/ws/session` schon in Phase 1; lokale Modelle LM Studio **und** Ollama; **Renovate** (Owner installiert die GitHub-App); `CHECKER_RESEARCH_MODE=native` erst nach dem Eval-Vergleich.

Neu (eigene Festlegungen, jeweils im ADR begründet, Freigabe an Gate 0):

- **Klassifikator (ADR 0007):** Interface `ClassifierProvider.ask(state, questions)` mit `choice`, `score`, `bool`; jede Antwort hat `probabilities` und `confidence` (Konfidenzformel von Jev auch für `llm`, damit Evals vergleichbar sind). Implementierungen `llm` (Standard), `mock`, `typesafe` (hinter Konfiguration; ohne Key nicht wählbar). Mehrere Fragen pro Aufruf (Jev-„fan-out“; `llm` bündelt sie in einem zod-Schema).
- **Konfiguration:** `CHECKER_CLASSIFIER_PROVIDER` (`llm` | `typesafe` | `mock`), `CHECKER_CLASSIFIER_MODEL` (Jev-Version gepinnt, z. B. `jev-1.13.0`), Schwellen `CHECKER_CONFIDENCE_HIGH` / `CHECKER_CONFIDENCE_LOW` (Startwerte 0,75 / 0,45, per Eval nachjustiert). Der `llm`-Klassifikator nutzt `CHECKER_LLM_*`. Neu `EXPLAINER_LLM_*`. `DETECTOR_CLASSIFIER_*` erst in Phase 2.
- **Lokaler Modus:** `PRIVACY_MODE=local|cloud` (Default `cloud`). Bei `local` bricht jeder Worker beim Start ab, wenn ein Cloud-Anbieter konfiguriert ist (Anthropic, TypeSafe, Google Fact Check, Cloud-Embeddings). Damit ist „im lokalen Modus ist Jev deaktiviert“ (15.6) erzwungen statt nur dokumentiert.
- **Text-Modus-Behauptungen (ADR 0010):** Der Gateway schreibt `ClaimDetected` mit `originalText = standaloneText` = eingegebener Text, `checkworthiness: 1`, `provider: { classifier: "text-mode", model: "none" }`, leere `sourceSegmentIds`; `timings.detectMs = 0`.
- **Zusatzfelder in `ClaimChecked` v2** (aus dem freigegebenen Entwurf, über Brief 7 hinaus, weil „mindestens diese Schemas“): `usage { inputTokens, outputTokens, estimatedCostUsd | null }` für Kosten pro Behauptung (13.5, 14.5) und `reason` bei `nicht_pruefbar` (`budget_exceeded`, `invalid_llm_output`, `no_evidence`, `low_confidence`, `uncited_or_foreign_source`, `provider_error`). **Wird an Gate 1 von dir bestätigt oder gestrichen.**
- **Gateway-Token (ADR 0011):** REST per `Authorization: Bearer`; WebSocket: erste Nachricht `{type: "auth", token}` innerhalb von 5 s (Browser setzen beim Handshake keine Header, Token nie in die URL). Im Browser einmal auf der Einstellungsseite eingeben, gespeichert in `localStorage` (Risiko im ADR).
- **Tagesbudget:** `CLOUD_DAILY_BUDGET_USD` für Anthropic und TypeSafe; Zähler in Redis aus `usage` × Preistabelle; überschritten → `nicht_pruefbar` mit `reason: budget_exceeded`.
- **Offene ADRs (Status „proposed“):** 0012 Embedding-Modell (Kandidaten `bge-m3`, `multilingual-e5-large`, Qwen3-Embedding; Entscheidung nach Retrieval-Messung im Eval), 0013 Vektor-Speicher (pgvector vs. Qdrant vs. Redis; Entscheidung in Phase 4).

## Vorgeschlagene ADRs

| Nr. | Titel | Status nach TP0 |
|---|---|---|
| 0007 | Klassifikator-Architektur: Jev (`typesafe`) mit LLM-Fallback, Fragetypen, Konfidenzschwellen, lokaler Modus | proposed → accepted an Gate 0 |
| 0008 | Caching statt vorgenerierter Fragen: exakter Urteils-Cache (Phase 1), semantischer Cache mit Bestätigung (Phase 4), Such-/Seiten-Cache | proposed → accepted an Gate 0 |
| 0009 | `explainer` als eigener Service (Urteil vor Erklärung, eigene Skalierung bis null, kein Jev-Key) | proposed → accepted an Gate 0 |
| 0010 | Event-Verträge v2 (ClaimDetected v2, ClaimChecked v2, ClaimExplained v1, TopicDetected v1, Evidence) und API-/WS-Verträge v1 | geschrieben in TP1 |
| 0011 | Gateway-Authentifizierung für REST und WebSocket | geschrieben in TP5 |
| 0012 | Embedding-Modell | proposed (offen) |
| 0013 | Vektor-Speicher für den Evidenz-Speicher | proposed (offen, Phase 4) |
| 0004 | Ergänzung: `fact-checker` und `explainer` im Netz `egress` | Nachtrag in TP0 |

## Teilprojekte, Tasks und Review-Gates

Kürzel: `tb` = `scripts/tb`. Verifikationsläufe am Stack nur im isolierten Compose-Projekt (`AGENTS.md`). Tests neben dem Code (`*.test.ts`, `*.int.test.ts`).

---

### TP0 – Nachzieharbeiten aus der Gap-Analyse (keine Fachlogik)

**T0.1 Kurzbeschreibungen** (1.2 Schritt 2): `.ai/summaries/{service-kit,providers,contracts,gateway,fact-checker}.md` (Verantwortung, Datenfluss, zentrale Typen, Stolperfallen).
**T0.2 ADRs** 0007, 0008, 0009 (proposed), 0012, 0013 (proposed, offen); Nachtrag in ADR 0004.
**T0.3 Abweichungen** Brief ↔ ADR 0001/0004/0006: Brief auf die vereinbarten Entscheidungen zurückgesetzt (Marco, 2026-09-26: Rücknahme war unbeabsichtigt), `docs/architecture.md` nachgezogen.
**T0.4 Playwright-MCP** in `.mcp.json` und `.agents/mcp_config.json` (offizielles `@playwright/mcp`, Container-Start, headless), `docs/ai-tooling.md`. Verifikation: `node scripts/ci/check-mcp-parity.mjs`, `/mcp`.
**T0.5 Skelette** über die Skills:
- `services/explainer` per Skill `new-service` (Dockerfile, Compose-Eintrag, `AGENTS.md`/`CLAUDE.md`, Glob-Regel, CI-Image-Liste)
- `packages/research` (package.json mit `exports`, tsconfig, `AGENTS.md`/`CLAUDE.md`, Glob-Regel, depcruise-Regeln)
- `config/source-tiers.yaml` + Schema `packages/research/src/source-tiers.ts` mit Test (Datei validiert)
- `evals/README.md` und `evals/SOURCES.md`, noch ohne Daten; das Workspace-Paket entsteht mit dem ersten Code in T7.2 (kein leeres Paket)
- Verifikation: `tb pnpm install --frozen-lockfile && make lint && make test-unit`
**T0.6 Konfiguration und Secrets:**
- `packages/providers/src/llm/config.ts`: Task `EXPLAINER`; neu `src/classifier/config.ts` (Provider, Modell, Schwellen, Querprüfung HIGH > LOW) und `src/privacy.ts` (`PRIVACY_MODE`, Abbruch bei Cloud-Anbietern im lokalen Modus), jeweils mit Tests
- `scripts/secrets-init.sh`: `typesafe_api_key`, `google_factcheck_api_key`, `explainer_llm_api_key` (leere Platzhalter)
- `docker-compose.yml`: Secrets je Service nach Least Privilege; `fact-checker`, `explainer` zusätzlich in `egress`
- `.env.example`: alle neuen nicht-geheimen Variablen mit Beispielen (Claude: `claude-haiku-4-5` für Extraktion/Erklärung, `claude-opus-5` für das Urteil; LM Studio/Ollama über `host.docker.internal`; Jev `jev-1.13.0`)
- Verifikation: `make test-unit`, isolierter `make up` + `make ready` + `make check-ports`

**🛑 Gate 0** (Architektur angeglichen, ADRs 0007–0009 zur Freigabe)

---

### TP1 – Verträge (freigegeben am 2026-09-26)

**T1.1** `packages/contracts/src/evidence.ts` (`Evidence`, `SourceTier`, Snippet ≤ 300 Zeichen), `verdict.ts` (`Verdict`, `ConfidenceLevel`, `VerdictProbabilities` = Record über alle 5 Urteile, Summe 1 ± 1e-6).
**T1.2** `ClaimDetected` v2 (`originalText`, `standaloneText`, `normalizedText`, `checkworthiness` 0..1, `provider { classifier, model }`).
**T1.3** `ClaimChecked` v2 (ohne `explanation`; mit `probabilities`, `confidence`, `confidenceLevel`, `evidence[]` ≤ 10, `bestEvidenceId?` muss auf ein Evidence zeigen, `cacheHit`, `existingFactCheck?`, `timings`, `provider { classifier, model, search, embeddings }`; Regel: außer `nicht_pruefbar` braucht jedes Urteil Evidenz; `verdict` = argmax der `probabilities`, außer bei `nicht_pruefbar` wegen niedriger Konfidenz; ggf. `usage`, `reason`, s. o.).
**T1.4** `ClaimExplained` v1, `TopicDetected` v1; Envelope: Streams `claims.explained`, `topics.detected`.
**T1.5** API/WS v1: `CheckClaimRequest { text }`, `CheckClaimAccepted { sessionId, claimId }`, `ProviderStatus`, WS-Nachrichten (`auth`, `session.ready`, `error`, Events).
**T1.6** Verbraucher kompilieren wieder (Fixtures, Services).
- Je ein Commit pro Vertragsänderung, ADR 0010, Contract-Tests mit gültigen/ungültigen Fixtures. Verifikation: `tb pnpm --filter @lfc/contracts test:unit`, `scripts/check-contract-change.sh origin/main`.

**🛑 Gate 1**

---

### TP2 – Adapter in `packages/providers`

**T2.1 `LlmProvider`** (`generateStructured({ system, user, schema, effort? })` → `{ value, usage, model, provider }` oder typisierter Fehler): `anthropic` (`messages.parse` + `zodOutputFormat`, Refusal/`max_tokens`), `openai-compatible` (JSON-Modus, genau ein Reparaturversuch), `mock`. Prompts als Dateien mit Platzhaltern (`renderPrompt`).
**T2.2 `ClassifierProvider` `llm` + `mock`:** Choice/Score/Bool, Wahrscheinlichkeiten normalisiert, Konfidenzformel, `confidenceLevel` aus Schwellen.
**T2.3 `ClassifierProvider` `typesafe`:** `@typesafe-ai/sdk` (Version gepinnt), Key explizit aus Config, eigener Logger ohne Request-Bodies, Timeout/Retries aus Config, Sprechernamen → Platzhalter, `state` ≤ 32k Tokens (abschneiden mit Warnung). Tests gegen lokalen Fake-HTTP-Server (`baseURL`), kein Netz.
**T2.4 `EmbeddingProvider`:** `openai-compatible` (`/embeddings`), `mock` (Hash-Vektoren).
**T2.5 `SearchProvider` `searxng`**, Preistabelle (Anthropic, Jev; unbekannt → `null`), Budget-Zähler (Redis).
- Verifikation: `tb pnpm --filter @lfc/providers test:unit`, Coverage ≥ 80 %.

**🛑 Gate 2**

---

### TP3 – `packages/research`

**T3.1 Sicherer Abruf** `safe-fetch.ts` (SSRF nach `research-pipeline.md`, DNS-Pinning, Redirects ≤ 3, Größe, Zeit, robots.txt, User-Agent). **Angriffsfälle zuerst als Tests.**
**T3.2 Extraktion und Chunking:** Readability + jsdom, 300–500 Tokens mit Überlappung, Snippet-Funktion.
**T3.3 Quellen:** `factcheck.ts` (Google, Key im Header), `wikipedia.ts`, `wikidata.ts` (Allowlist-Properties), `web.ts` (SearchProvider + Abruf), `source-tiers.ts` (Zuordnung und Gewichtung aus YAML); alle Stufen parallel mit Einzel-Timeouts.
**T3.4 Ranking im Speicher:** Kosinus × Stufengewicht → Top-k; Such- und Seiten-Cache in Redis (TTL konfigurierbar).
- Verifikation: Unit-Tests mit lokalem Fake-Server für jede Quelle; `*.int.test.ts` für den Cache mit Testcontainers-Redis; Coverage ≥ 80 %.

**🛑 Gate 3** (sicherheitskritisch: SSRF, Prompt-Isolation)

---

### TP4 – Streams, `fact-checker`, `explainer`

**T4.1 Streams-Helfer** im service-kit (`XREADGROUP`, `XACK` nach Erfolg, `XAUTOCLAIM`, Idempotenz über `claimId`, Envelope-Validierung).
**T4.2 `fact-checker`:** exakter Urteils-Cache (normalisierter Hash) → Live-Recherche (Suchanfragen per LLM, Heuristik-Fallback; drei Stufen parallel) → Relevanz (Bool, Top-k) → „reicht die Evidenz?“ (Bool) → Urteil (Choice über 5 Urteile + Choice bester Beleg) → Schwellen → `claims.checked` + Pub/Sub. Snippets als abgegrenzte Daten; zitierte IDs müssen aus der abgerufenen Liste stammen. Metriken und `timings`.
**T4.3 `explainer`:** liest `claims.checked`, Prompt `services/explainer/prompts/explanation.md` (max. 2 Sätze, nur auf Basis der Evidenz), schreibt `claims.explained` + Pub/Sub; Fehler → kein Event, Metrik und Log (Karte behält Platzhalter).
- Verifikation: Stufe 2a pro Service mit echtem Redis und Mock-Providern; Urteil-vor-Erklärung als Test.

**🛑 Gate 4**

---

### TP5 – `gateway`

**T5.1** Token-Schutz (ADR 0011), **T5.2** `POST /api/claims/check` (zod, Größenlimit, Rate Limit), **T5.3** `/ws/session` (Auth per erster Nachricht, `session.ready`, Pub/Sub → Client, maximale Dauer, Nachrichtenlimit), **T5.4** `GET /api/status` (aktive Provider und welche Daten wohin gehen; Worker melden ihre Provider beim Start nach Redis, nie Keys).
- Verifikation: Stufe 3 in `tests/api/` (Auth, Rate Limit, Größenlimit, Behauptung rein → Urteil und danach Erklärung per WebSocket raus).

**🛑 Gate 5**

---

### TP6 – Frontend

**T6.1** WebSocket-Client mit Reconnect/Backoff (Zustand), Einstellungsseite (Token, aktive Provider, Datenflüsse inkl. Jev-Hinweis 15.6).
**T6.2** Textmodus (Eingabe, Absenden, Karte „wird geprüft …“).
**T6.3** Karten nach 11: Urteils-Chip (Icon + Text), Uhrzeit, Behauptung, Konfidenzbalken (Stufe; Verteilung nur in der Detailansicht, kein prominenter Prozentwert), „unsicher“ bei mittlerer Konfidenz (neutral, nicht rot/grün), stärkster Beleg mit Herausgeber/Datum/Stufe, Badges („bereits von … geprüft“, „aus früherer Prüfung“), Erklärung mit Platzhalter, Quellen-Links (`rel="noopener noreferrer"`), Hinweis „automatische Einschätzung“, keine Personenwertung; Zeitleiste oben. Alle Texte in `de.json`.
- Verifikation: Stufe 1, Stufe 2b (`page.routeWebSocket`, axe), Stufe 4 (Textmodus-Journey, drei Browser), Playwright-MCP-Durchlauf mit Screenshots.

**🛑 Gate 6** (erster sichtbarer Stand mit Mock-Providern)

---

### TP7 – Eval, echte Provider, Qualitätstore

**T7.1 Urteils-Set** `evals/claims.de.jsonl`: Kandidaten aus ClaimReview-Einträgen deutscher Faktenchecker (Google Fact Check API) plus eigene klare Fälle, mit Schieflage-Slices (Zahlen/Daten, Meinung/nicht prüfbar). Ziel ≥ 200; **jedes Label prüfst du**, bevor es ins Set kommt; Herkunft und Lizenz in `SOURCES.md`.
**T7.2 `pnpm eval`** (Workspace `evals/`, läuft als Client gegen den Stack): Trefferquote, Brier-Score, ECE, Reliability-Diagramm (SVG), Latenz p50/p95 pro Pfad (`cacheHit`), Kosten pro Behauptung; Report als Markdown unter `docs/evidence/phase-1/`.
**T7.3** `make eval` (Container), `nightly.yml` mit `workflow_dispatch` für Evals.
**T7.4 DoD-Läufe:** Claude, LM Studio, Ollama, Jev (falls Zugang). **Vor jedem bezahlten Lauf nenne ich dir die geschätzten Kosten und warte auf dein OK.**
**T7.5 Qualitätstore:** Coverage-Schwelle 80 % (gemessen, dann gesetzt); Stryker für `providers`, Ursache des unzuverlässigen Scores klären.
**T7.6 Renovate** (`renovate.json`: pnpm, Actions per SHA, Image-Digests, `minimumReleaseAge`); Aktivierung per GitHub-App durch dich.

**🛑 Gate 7**

---

### TP8 – Reviews, Doku, PR

`reviewer`, `security-reviewer`, `/code-review`, `/security-review`; `SECURITY.md` (SSRF, Prompt-Injection, Token, Budget, Jev-Datenschutz), README (Textmodus ausprobieren, Provider konfigurieren, `host.docker.internal`), Evidence-Index `docs/evidence/phase-1/README.md`.

**🛑 Gate 8**

## DoD-Verifikation

| DoD | Nachweis |
|---|---|
| Behauptung mit Claude geprüft | Eval-Report Claude + Screenshot der Karte (Playwright-MCP) |
| mit LM Studio bzw. Ollama geprüft | Eval-Reports LM Studio und Ollama |
| mit Jev als Klassifikator geprüft (falls Zugang) | Eval-Report Jev; ohne Zugang: `typesafe`-Adapter nur gegen Fake-Server getestet, im PR benannt |
| Urteil erscheint vor der Erklärung | Stufe-3-Test (Reihenfolge der WS-Nachrichten) + Stream-Einträge mit Zeitstempeln |
| Eval-Report vergleicht Trefferquote, Kalibrierung, Latenz, Kosten | `docs/evidence/phase-1/eval-*.md` |
| SSRF- und Prompt-Injection-Schutz | Unit-Tests der Angriffsfälle, Stufe-3-Test, Security-Review |
| Kein Key im Browser, in Logs oder Events | Tests + `security-reviewer` |

## Status

- [x] Plan freigegeben (2026-09-26, inkl. Vertragsänderungen aus Brief 7 und API-/WS-Verträgen)
- [x] TP0 erledigt (Nachweise: `docs/evidence/phase-1/tp0-gap-catch-up.txt`)
  - [x] T0.1 Kurzbeschreibungen `.ai/summaries/`
  - [x] T0.2 ADR 0007–0009 (proposed), 0012/0013 (offen), Nachtrag ADR 0004
  - [x] T0.3 Brief auf ADR 0001/0004/0006 zurückgesetzt (1.1, 1.3, 1.4, 15.4, 16, 17)
  - [x] T0.4 Playwright-MCP (Image per Digest, `https://lfc.local`)
  - [x] T0.5 `services/explainer`, `packages/research` + `config/source-tiers.yaml`, `evals/README.md` + `SOURCES.md`
  - [x] T0.6 Klassifikator-Config, `EXPLAINER`, `PRIVACY_MODE`, Secrets je Service, `egress`, `.env.example`
- Aktuelles Gate: **Gate 0 – wartet auf Marcos Review** (ADR 0007–0009 annehmen?)
- Offen an Gate 0:
  - isolierter Stack-Lauf mit dem neuen `explainer` (`make up/ready/check-ports`) fehlt: braucht `SECRETS_DIR=<tmp>` im Befehl, das blockiert der Secrets-Guard. Marco führt ihn aus oder erlaubt einen Lauf.
  - Zusatzfelder `usage`/`reason` in `ClaimChecked` v2: Bestätigung an Gate 1
  - ADR-Nummern 0010/0011 sind für TP1/TP5 reserviert
- Erkenntnis: nie zwei Edits parallel auf dieselbe Datei (Format-Hook hat `docker-compose.yml` dabei abgeschnitten; sofort aus dem Commit wiederhergestellt)
- Voraussetzung für den Merge: PR #5, #6, #7 zuerst
- Nächster Task nach Freigabe: T1.1 (Verträge)

## Session-Log
