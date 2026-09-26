# Phase 1: Faktencheck im Textmodus – Plan

> Grundlage: `docs/PROJECT_BRIEF.md` (Abschnitte 6–9, 11, 13, 15, 17 Phase 1). Recherche: `.ai/research/llm-providers.md`, `.ai/research/research-pipeline.md`.
> Voraussetzung: Phase 0 (PR #5–#7) ist gemergt, bevor Code dieser Phase entsteht.

## Context

Das erste echte Feature: Man tippt eine Behauptung ein, und die App prüft sie per Websuche und LLM, das Ergebnis erscheint als Karte. Der Weg ist bereits derselbe wie später im Live-Modus: `gateway` → Stream `claims.detected` → `fact-checker` → `claims.checked` → Pub/Sub → WebSocket → Karte. Phase 2 muss dann nur noch Audio und Extraktion davorsetzen.

**DoD (Brief 17):** Eine eingetippte Behauptung wird einmal mit Claude und einmal mit LM Studio bzw. Ollama geprüft, beides funktioniert, und ein Eval-Report liegt vor.

## Geklärte Entscheidungen (2026-09-26)

| # | Frage | Entscheidung |
|---|---|---|
| 1 | Ergebnis zum Browser | **WebSocket `/ws/session` schon jetzt**; Events über Redis Pub/Sub (Brief 6.7). In Phase 2 kommt über dieselbe Verbindung nur das Audio dazu. |
| 2 | Lokale Modelle | **LM Studio und Ollama**; der Eval-Report vergleicht Claude, LM Studio und Ollama. |
| 3 | Dependency-Updates | **Renovate** (Marco installiert die GitHub-App). |
| 4 | `CHECKER_RESEARCH_MODE=native` | **später**, nach dem Eval-Vergleich; Phase 1 baut nur den Standardweg `pipeline`. |

Eigene Festlegungen (je im ADR begründet):
- Strukturierte Ausgabe bei Claude über `messages.parse` + `zodOutputFormat`; bei OpenAI-kompatiblen Servern JSON-Modus plus zod, genau ein Reparaturversuch, danach `nicht_pruefbar` (Brief 8).
- Beispielmodelle nur in `.env.example` und im Eval-Setup: Extraktion `claude-haiku-4-5`, Urteil `claude-opus-5` (Alternative `claude-sonnet-5`). Im Code sind keine Modellnamen fest verdrahtet.
- **Gateway-Token:** REST über `Authorization: Bearer`. Beim WebSocket ist das **erste Nachrichtenpaket** `{type: "auth", token}` innerhalb von 5 s, denn Browser können beim WebSocket-Handshake keine Header setzen, und Tokens gehören nie in die URL (Brief 15.5). Im Browser wird das Token einmal auf der Einstellungsseite eingegeben und in `localStorage` gespeichert (Risiko und CSP-Begründung im ADR).
- **Tagesbudget** für Cloud-LLM-Aufrufe (`CLOUD_LLM_DAILY_BUDGET_USD`, Brief 15.5): Zähler in Redis aus `usage` × Preistabelle; ist das Budget überschritten, lautet das Urteil `nicht_pruefbar` mit Grund `budget_exceeded`.
- Der `claim-extractor` bleibt in Phase 1 unverändert (Textmodus schreibt direkt nach `claims.detected`).

## Vertragsänderungen (brauchen Marcos ausdrückliche Freigabe, Brief 4.2)

1. **`ClaimChecked` v2:** neues Pflichtfeld `usage: { inputTokens, outputTokens, estimatedCostUsd: number | null }` und optional `reason` (`budget_exceeded` | `invalid_llm_output` | `no_sources` | `uncited_or_foreign_source` | `provider_error`), Letzteres nur bei `nicht_pruefbar`. Grund: Kosten pro Behauptung für Eval und später das Kosten-Dashboard (Brief 13.5, 14.5); der Grund macht `nicht_pruefbar` nachvollziehbar.
2. **Neue API- und WebSocket-Verträge (v1):** `CheckClaimRequest { text }`, `CheckClaimAccepted { sessionId, claimId }`, WebSocket-Client-Nachrichten (`auth`, später `start`/`stop`/`rename`) und -Server-Nachrichten (`session.ready`, `error`, dazu die bestehenden `EventEnvelope`-Events).

Beides entsteht über den Skill `new-event-contract`: je ein ADR, eigener Commit, Contract-Tests.

## Teilprojekte, Tasks und Review-Gates

Kürzel: `tb` = `scripts/tb`. Verifikationsläufe nur im isolierten Compose-Projekt (`AGENTS.md`).

---

### TP1 – Verträge und Vorbereitung

**T1.1 Kurzbeschreibungen** (Brief 1.2 Schritt 2): `.ai/summaries/service-kit.md`, `.ai/summaries/gateway.md`, `.ai/summaries/fact-checker.md` (Verantwortung, Datenfluss, zentrale Typen, Stolperfallen).
**T1.2 Vertrag `ClaimChecked` v2** (nach Freigabe): `packages/contracts/src/claim-checked.ts`, Tests, ADR 0007. Verifikation: `tb pnpm --filter @lfc/contracts test:unit`, `scripts/check-contract-change.sh origin/main`.
**T1.3 API-/WebSocket-Verträge v1:** `packages/contracts/src/api.ts`, `src/ws.ts`, Tests, ADR 0008 (inkl. WebSocket-Authentifizierung per erster Nachricht).

**🛑 Gate 1** (Verträge sind die Grundlage für alles Weitere)

---

### TP2 – Adapter in `packages/providers`

**T2.1 `LlmProvider`-Interface:** `generateStructured<T>({ system, user, schema: z.ZodType<T>, effort? }) → { value: T; usage; model; provider }` bzw. ein typisierter Fehler. Dateien: `src/llm/provider.ts`, `src/llm/factory.ts` (`createLlmProvider(task, config)`).
**T2.2 `anthropic`:** `src/llm/anthropic.ts` (`messages.parse` + `zodOutputFormat`, Refusal- und `max_tokens`-Behandlung, Timeout und Retries aus der Konfiguration, Refusal-Fallback aktiv). Unit-Tests gegen einen lokalen Fake-HTTP-Server (kein Netz, kein Mock interner Module).
**T2.3 `openai-compatible`:** `src/llm/openai-compatible.ts` (JSON-Modus, zod, ein Reparaturversuch). Gleiche Testart.
**T2.4 `mock`:** `src/llm/mock.ts` (deterministisch, Fixtures).
**T2.5 Preistabelle:** `src/llm/pricing.ts` (nur für `estimatedCostUsd`; unbekanntes Modell → `null`).
**T2.6 `SearchProvider` + `searxng`:** `src/search/*.ts`.
**T2.7 Sicherer Abruf + Textextraktion:** `src/fetch/safe-fetch.ts` (SSRF-Schutz nach `.ai/research/research-pipeline.md`, DNS-Pinning, Redirects, Größe, Zeit, robots.txt), `src/fetch/extract.ts` (Readability). **Tests zuerst für die SSRF-Fälle:** private IPs, Metadaten-IP, `localhost`, Redirect auf intern, DNS-Rebinding, zu große Antwort.
- Verifikation: `tb pnpm --filter @lfc/providers test:unit`, Coverage ≥ 80 %.

**🛑 Gate 2** (der sicherheitskritischste Code der Phase: SSRF und Prompt-Isolation)

---

### TP3 – Streams und `fact-checker`

**T3.1 Redis-Streams-Helfer im service-kit:** `src/streams.ts` (Consumer Group anlegen, `XREADGROUP`, `XACK` erst nach Erfolg, `XAUTOCLAIM` für liegengebliebene Einträge, Idempotenz über `claimId`, Envelope-Validierung beim Lesen und Schreiben). Integrationstests mit Testcontainers.
**T3.2 Pipeline im `fact-checker`:**
- Ablauf: `claims.detected` lesen → Cache prüfen (normalisierte Behauptung, TTL) → 1–3 Suchanfragen → Quellen abrufen → Urteil nur auf Basis der Quellen (Prompt unter `services/fact-checker/prompts/verdict.md`) → zitierte URLs gegen die abgerufenen prüfen → `claims.checked` + Pub/Sub `session:{id}:events`.
- Budget-Zähler, Metriken (Dauer, Kosten, Urteile, Fehler).
**T3.3 Netzwerk:** `fact-checker` kommt zusätzlich ins Netz `egress` (Seitenabruf, Cloud-LLM, LM Studio/Ollama über `host.docker.internal`). ADR 0004 wird ergänzt.
- Verifikation: Stufe-2a-Test Ende-zu-Ende mit echtem Redis, Mock-LLM und Mock-Suche; Coverage ≥ 80 %.

**🛑 Gate 3**

---

### TP4 – `gateway`

**T4.1 Token-Schutz:** Konfiguration `GATEWAY_TOKEN` (Secret), REST-Hook für `/api/*`, konstante Vergleichszeit.
**T4.2 `POST /api/claims/check`:** zod-validiert, Größenlimit, Rate Limit (`@fastify/rate-limit`), schreibt `ClaimDetected` (leere `sourceSegmentIds`) nach `claims.detected`.
**T4.3 `/ws/session`:** `@fastify/websocket`, Auth per erster Nachricht, `session.ready { sessionId }`, abonniert `session:{id}:events` und pusht an den Client; maximale Sessiondauer, Nachrichtengrößen-Limit.
**T4.4 `GET /api/status`:** zeigt die aktiven Provider (die Worker schreiben ihre `describeLlmConfig`-Angaben beim Start nach Redis, nie Keys).
- Verifikation: Stufe-3-API-Tests in `tests/api/` (Auth, Rate Limit, Größenlimit, Textmodus Ende-zu-Ende mit Mock: Behauptung rein, Urteil per WebSocket raus).

**🛑 Gate 4**

---

### TP5 – Frontend (Textmodus, Karten)

**T5.1 WebSocket-Client** mit Reconnect und Backoff (Zustand-Store), Einstellungsseite (Token, aktive Provider, welche Daten an wen gehen, Brief 15.6).
**T5.2 Textmodus:** Eingabe, Absenden, Karte mit Zwischenstatus „wird geprüft …“.
**T5.3 Ergebnis-Karten:** farbcodiert **plus** Icon und Text pro Urteil (Brief 11), Konfidenz, aufklappbare Begründung, Quellen-Links (`rel="noopener noreferrer"`), neueste oben. Alle Texte in `de.json`.
- Verifikation: Stufe 1 (Stores, Formatierung), Stufe 2b (`page.routeWebSocket` mockt das Backend; axe), Stufe 4 (Textmodus-Journey gegen den Stack mit Mock-Providern, drei Browser).

**🛑 Gate 5** (erster sichtbarer Stand: du kannst mit Mock-Providern eine Behauptung prüfen)

---

### TP6 – Eval, echte Provider, Renovate, Qualitätstore

**T6.1 Eval-Set:** `evals/claims.de.jsonl` mit ~30 deutschen Behauptungen (klar wahr, klar falsch, übertrieben, Meinung/nicht prüfbar), jeweils mit erwartetem Urteil und kurzer Begründung. Du reviewst das Set vor dem ersten bezahlten Lauf.
**T6.2 `pnpm eval`:** Workspace `evals/` läuft gegen den Stack (HTTP + WebSocket, wie ein Client). Ausgabe: Trefferquote (exakt und „richtige Richtung“), Latenz p50/p95, Kosten pro Behauptung (aus `usage`). Report als Markdown unter `docs/evidence/phase-1/`.
**T6.3 DoD-Läufe:** Claude, LM Studio und Ollama (je ein Provider-Setup über `.env`). **Vor dem ersten Claude-Lauf nenne ich dir die geschätzten Kosten** (30 Behauptungen × Suchanfragen × Modellpreise) und warte auf dein OK.
**T6.4 Renovate:** `renovate.json` (pnpm-Workspace, Gruppen, `minimumReleaseAge` passend zu pnpm, Actions und Image-Digests pinnen); Aktivierung per GitHub-App durch dich.
**T6.5 Qualitätstore:** Coverage-Schwelle 80 % für `packages/*` und die Service-Logik (Brief 13.5), zuerst gemessen, dann gesetzt; `nightly.yml` bekommt `workflow_dispatch` für Evals.
**T6.6 CI:** Stufe-2a-Pipelinetest und die neuen Stufe-3/4-Tests laufen in `ci.yml`/`pr.yml` (mit Mock-Providern, ohne Keys).

**🛑 Gate 6**

---

### TP7 – Reviews, Doku, PR

Die Schritte folgen Phase 0:
- `reviewer`, `security-reviewer`, `/code-review`, `/security-review`
- `SECURITY.md` (SSRF, Prompt Injection, Token, Budget) und README (Textmodus ausprobieren, LLM konfigurieren) aktualisieren
- Evidence-Index `docs/evidence/phase-1/README.md`

**🛑 Gate 7**

## DoD-Verifikation

| DoD | Nachweis |
|---|---|
| Behauptung mit Claude geprüft | Eval-Report Claude + Screenshot der Karte |
| Behauptung mit LM Studio und Ollama geprüft | Eval-Reports LM Studio und Ollama |
| Eval-Report liegt vor | `docs/evidence/phase-1/eval-*.md` mit Trefferquote, Latenz, Kosten |
| SSRF- und Prompt-Injection-Schutz (Brief 15.5) | Unit-Tests der Angriffsfälle, Stufe-3-Test, Security-Review |
| Kein Key im Browser, in Logs oder Events | Tests + `security-reviewer` |

## Status

- [ ] Plan freigegeben
- [ ] Vertragsänderungen (ClaimChecked v2, API-/WS-Verträge v1) freigegeben
- Voraussetzung: PR #5, #6, #7 gemergt
- Nächster Task nach Freigabe: T1.1

## Session-Log
