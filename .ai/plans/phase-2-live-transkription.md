# Phase 2: Live-Transkription – Plan

> Grundlage: `docs/PROJECT_BRIEF.md` (Abschnitte 5, 6, 7, 8.1, 10, 11, 12, 13, 15, 17), `AGENTS.md`, ADR 0001–0014.
> Branch pro Gate: `phase-2/tpN-<thema>`, jeder PR direkt gegen `main` (keine gestapelten PRs).
> Voraussetzung: Phase 1b abgeschlossen (Gate 6, 2026-09-29); PR #26 (Folgearbeiten) sollte vor TP2 gemergt sein.

## Context

Bisher prüft die App nur eingetippte Behauptungen. Phase 2 setzt den Live-Weg davor: Das iPhone nimmt Audio auf, das `gateway` reicht es an `transcription` weiter, ein STT-Anbieter (Deepgram, AssemblyAI oder lokal `stt-local`) liefert Segmente, der `claim-extractor` erkennt darin prüfwürdige Behauptungen, und ab `claims.detected` läuft die bestehende Pipeline aus Phase 1. Im Browser erscheint ein Live-Transkript, in dem erkannte Behauptungen markiert und mit den Karten verknüpft sind.

**DoD (Brief 17):** Ich spreche ins iPhone, sehe das Transkript live und bekomme für eine falsche Behauptung innerhalb weniger Sekunden eine Karte.

Dazu laut Brief: Erkennungs-Eval-Set, Einwilligungsdialog, E2E-Tests mit WAV-Fixture (Chromium) und synthetischem MediaStream (WebKit), iPhone-Smoke-Checkliste einmal durchlaufen.

## Geklärte Entscheidungen (Marco, 2026-09-29)

| # | Frage | Entscheidung |
|---|---|---|
| 1 | Cloud-STT | Marco legt einen kostenlosen **Deepgram**-Account an (Startguthaben, keine Kreditkarte). Beide Adapter werden gebaut; Deepgram wird zusätzlich echt getestet, AssemblyAI nur gegen Mocks und die offizielle Doku. Standard-Anbieter per ADR 0016 nach dem Test. |
| 2 | `stt-local` | Standard im Container (Compose-Profil `local-stt`). Zusätzlich eine Anleitung für den nativen Start auf dem Mac über `uv` (schneller, optional). Agents installieren nichts auf dem Host. |
| 3 | Erkennungs-Eval-Set | Start mit **~150 Segmenten** aus Bundestagsprotokollen; ein Modell labelt vor, Marco prüft jedes Label. Ausbau auf mehrere hundert später. |

Eigene Festlegungen (jeweils im ADR begründet, Freigabe an Gate 0):

- **WebSocket-Protokoll v2 (ADR 0015):** Nach `auth` sendet der Client `audio.start { sampleRate: 16000, encoding: "pcm16", channels: 1, language: "de" }`, danach Binärframes (je ca. 100 ms = 3200 Byte, Obergrenze 8 KiB pro Frame), zum Schluss `audio.stop`. Der Server antwortet mit `audio.started` / `audio.stopped { reason }`. Audio ohne vorheriges `audio.start` oder nach Ablauf der maximalen Aufnahmedauer (`MAX_RECORDING_MINUTES`, Default 60) beendet die Aufnahme mit Fehlercode. Sprecher umbenennen folgt in Phase 3.
- **Gateway → `transcription`:** interner WebSocket pro Aufnahme (Brief 6.3), nur im Netz `internal`. Das Gateway puffert nicht: Staut sich der Weg (Backpressure), wird die Aufnahme mit `audio.stopped { reason: "overloaded" }` beendet statt Audio still zu verwerfen.
- **Interim-Segmente** gehen als `transcript.segment` mit `isFinal: false` nur per Pub/Sub an den Client, finale zusätzlich nach `transcript.segments` (Brief 6.4). Der vorhandene `TranscriptSegment`-Vertrag reicht dafür, keine Änderung.
- **STT-Budget:** Cloud-STT wird pro Audiominute nach Preistabelle bepreist und über dasselbe Tagesbudget `CLOUD_DAILY_BUDGET_USD` gebucht wie die LLM-Aufrufe (Brief 15.5). Ist es aufgebraucht, endet die Aufnahme mit `audio.stopped { reason: "budget_exceeded" }`.
- **Datenschutz:** `PRIVACY_MODE=local` verweigert Cloud-STT beim Start (wie bei den LLMs). Audio wird nie gespeichert; Transkripte werden nicht geloggt (`LOG_TRANSCRIPTS=false`).
- **`claim-extractor` (ADR 0017):** rollierendes Fenster pro Session (letzte N finale Segmente, in Redis mit TTL, damit der Worker zustandslos bleibt), deterministischer Vorfilter, Klassifikator `DETECTOR_CLASSIFIER_PROVIDER` (Standard `llm`, Jev optional) mit Bool „enthält prüfwürdige Tatsachenbehauptung“ und Score „Prüfwürdigkeit 1–5“, Schwellen `DETECTOR_CONFIDENCE_HIGH` / `_LOW`, Umformulierung nur für positive Fälle über `EXTRACTOR_LLM_*`, Deduplizierung über normalisierten Hash plus Abgleich mit den bisherigen Behauptungen der Session (Bool „dieselbe Aussage“).

## Vorgeschlagene ADRs

| Nr. | Titel | Status nach Gate 0 |
|---|---|---|
| 0015 | Audio-Pfad und WebSocket-Protokoll v2: Frames, Limits, Backpressure, maximale Dauer, STT-Budget | accepted |
| 0016 | STT-Anbieter: Deepgram und AssemblyAI (Streaming, Deutsch, Diarization, Preis), `stt-local` mit faster-whisper und VAD, Mock | proposed → accepted nach dem Deepgram-Test in TP2 |
| 0017 | Behauptungserkennung: Fenster, Vorfilter, Klassifikatorfragen, Schwellen, Umformulierung, Deduplizierung | accepted |

---

## TP0 – Recherche, Zusammenfassungen, ADRs

- **T0.1 Recherche** (Context7 und offizielle Doku, kompakt):
  - `.ai/research/stt-providers.md`: Deepgram und AssemblyAI – Streaming-API, Deutsch, Diarization, Interim-Ergebnisse, Audioformat, Preise, Startguthaben, Limits, offizielle SDKs
  - `.ai/research/faster-whisper.md`: Modellgrößen für Deutsch, VAD-Chunking, Geschwindigkeit auf CPU (Docker) und Apple Silicon (nativ), Speicherbedarf bei 16 GB
  - `.ai/research/browser-audio.md`: AudioWorklet, Resampling auf 16 kHz, Safari/iOS-Eigenheiten (Secure Context, Displaysperre, App-Wechsel, AudioContext-Start nur nach Nutzeraktion), Playwright-Fake-Audio
- **T0.2 Zusammenfassungen:** `.ai/summaries/gateway.md` auf den Stand nach Phase 1b gebracht (Session, Auth, Pub/Sub, geplanter Audio-Pfad) und neu `.ai/summaries/pipeline-streams.md` (Streams, Consumer Groups, Dead Letter)
- **T0.3 ADRs 0015–0017** als Entwurf
- Verifikation: Dateien vorhanden, Quellen verlinkt; `make lint`

**🛑 Gate 0:** Marco gibt Recherche und ADRs frei (PR `phase-2/tp0-research`).

## TP1 – Verträge

- **T1.1** `packages/contracts/src/ws.ts` → v2: `WsAudioStart`, `WsAudioStop` (Client), `WsAudioStarted`, `WsAudioStopped { reason }` (Server), neue Fehlercodes (`audio_not_started`, `frame_too_large`, `recording_limit`, `overloaded`, `budget_exceeded`); Konstanten für Frame-Größen
- **T1.2** internes Protokoll Gateway ↔ `transcription` in `packages/contracts/src/internal-audio.ts` (Start-Nachricht mit `sessionId`, Sprache, Format; Stop; Fehler)
- **T1.3** Contract-Tests (gültige und ungültige Fixtures, alte v1-Nachrichten werden abgelehnt), `schemaVersion` erhöht, ADR 0015 referenziert
- **T1.4** `ClaimDetected` v3 mit Pflichtfeld `detectMs` (Textmodus: 0), damit der fact-checker `timings.detectMs` nicht mehr fest auf 0 setzt (ADR 0017); Gateway und fact-checker im selben PR angepasst
- Verifikation: `scripts/tb pnpm --filter @lfc/contracts test:unit`; Vertrags-Check in CI grün

**🛑 Gate 1:** Vertragsänderung (eigener Commit mit ADR, Brief 4.2).

## TP2 – `transcription` mit STT-Adaptern

- **T2.1** `SttProvider` in `packages/providers/src/stt/`: Streaming-Interface (Audio rein, Interim- und Final-Segmente mit Sprecher raus), Konfiguration `STT_PROVIDER` (`mock` | `deepgram` | `assemblyai` | `local`), `STT_MODEL`, `STT_LANGUAGE`, Secrets `deepgram_api_key` / `assemblyai_api_key` per `_FILE`, `LOCAL_STT_URL`; Privacy-Prüfung (Cloud-STT bei `PRIVACY_MODE=local` verboten)
- **T2.2** Adapter `mock` (spielt ein Skript mit Segmenten ab), `deepgram`, `assemblyai` (je mit offiziellem SDK, falls es Streaming sauber abbildet, sonst WebSocket direkt), `local` (WebSocket zu `stt-local`)
- **T2.3** Service `services/transcription`: interner WebSocket-Server, Weiterleitung an den Adapter, finale Segmente nach `transcript.segments`, alle Segmente auf `session:{id}:events`, STT-Budget pro Audiominute, maximale Dauer, sauberes Beenden bei Verbindungsabbruch
- **T2.4** Compose: `transcription` bekommt `egress` (nur für Cloud-STT) und die zwei Secrets; `scripts/secrets-init.sh` legt die leeren Dateien an; `.env.example` dokumentiert alle Variablen
- Tests: Stufe 1 für jeden Adapter gegen einen Fake-Server an der Systemgrenze (Interim/Final, Diarization-Label, Abbruch, Timeout, fehlender Key); Stufe 2a `main.int.test.ts` mit Testcontainers-Redis und `mock`-Adapter (Audio rein → Stream-Eintrag + Pub/Sub)
- **T2.5 Echter Deepgram-Test** (Marco trägt den Key in `deepgram_api_key` ein): deutsche WAV-Datei durch den Adapter, Latenz und Qualität notiert; Ergebnis in ADR 0016. Kosten: wenige Cent aus dem Startguthaben, Start nur nach Marcos OK
- Verifikation: `scripts/tb pnpm --filter @lfc/transcription test:unit test:int`; Nachweis unter `docs/evidence/phase-2/`

## TP3 – `stt-local` (Python)

- **T3.1** `services/stt-local/`: FastAPI, faster-whisper, VAD-basierte Chunks („Pseudo-Streaming“), WebSocket-Endpunkt im selben Protokoll wie der `local`-Adapter, alle Segmente `speaker: "A"`, Health/Readiness, strukturierte Logs ohne Transkript-Inhalt
- **T3.2** Qualität: `pyproject.toml` mit `uv`, ruff, mypy strict, pytest (Stufe 0/1 laut Brief 13.1); eigene `AGENTS.md`, `CLAUDE.md` und Glob-Regel in `.agents/rules/`
- **T3.3** Dockerfile mit `dev`- und `runtime`-Stage (non-root, read-only, Modell-Cache als Volume), Compose-Profil `local-stt`, `make up-local`
- **T3.4** Anleitung für den nativen Start auf dem Mac (`uv run …`, `LOCAL_STT_URL=http://host.docker.internal:<port>`) in der Service-README; Agents führen sie nicht aus
- **T3.5** CI: Job für Python (ruff, mypy, pytest) in `ci.yml`, Image-Build und Trivy wie bei den anderen Services
- Verifikation: `docker compose --profile local-stt run --rm stt-local pytest`; WAV-Fixture → Segmente über den `local`-Adapter im isolierten Stack

**🛑 Gate 2:** `transcription` und `stt-local` (PRs `phase-2/tp2-transcription`, `phase-2/tp3-stt-local`).

## TP4 – Audio-Pfad im Gateway

- **T4.1** `services/gateway/src/ws.ts`: Nachrichten nach `auth` gemäß v2, Binärframes nur nach `audio.start`, Größenlimit pro Frame, Rate Limit (Frames pro Sekunde), Weiterleitung an `transcription`, Backpressure → `overloaded`, maximale Aufnahmedauer
- **T4.2** Aufräumen: Client trennt oder schickt `audio.stop` → interne Verbindung wird geschlossen; `transcription` fällt aus → Client bekommt `audio.stopped { reason: "provider_error" }`
- **Erinnerung (Review Gate 1, Marco/Antigravity 2026-09-29):** Für **jeden** der vier Audio-Fehlercodes aus TP1 (`audio_not_started`, `audio_already_started`, `frame_too_large`, `frame_rate_exceeded`) gibt es einen eigenen Integrationstest in `services/gateway/src/api.int.test.ts` (Stufe 2a); ohne diese vier Tests ist TP4 nicht fertig
- Tests: Stufe 2a (Gateway mit Fake-`transcription`), Stufe 3 `tests/api/audio.spec.ts`: WAV-Fixture als Frames über `/ws/session` → Interim- und Final-Segmente kommen zurück (mock-STT); Fehlerfälle (Frame zu groß, Audio ohne Start, falsches Token)

## TP5 – `claim-extractor` und Erkennungs-Eval

- **T5.1** Vorfilter (deterministisch: Mindestlänge, Fragen, Grußformeln, reine Meinungsmarker) mit ausführlichen Unit-Tests
- **T5.2** Fenster pro Session in Redis (TTL), Klassifikatorfragen (Bool + Score) über den vorhandenen `ClassifierProvider`, Schwellen `DETECTOR_*`
- **T5.3** Umformulierung in eine eigenständige Aussage (Prompt `services/claim-extractor/prompts/standalone.md`, Pronomen und Bezüge aufgelöst), nur für positive Fälle
- **T5.4** Deduplizierung: normalisierter Hash plus Abgleich mit den bisherigen Behauptungen der Session; Stryker nightly für die Deduplizierung (Brief 13.5)
- **T5.5** Ergebnis `ClaimDetected` nach `claims.detected` und auf den Session-Kanal; Timings (`detectMs`)
- **T5.6** Erkennungs-Eval: `evals/detection.de.jsonl` (~150 Segmente aus Bundestagsprotokollen, vorgelabelt, **jedes Label von Marco geprüft**), `SOURCES.md` ergänzt, `pnpm eval` misst Precision, Recall, F1 und Latenz
- Tests: Stufe 1 (Vorfilter, Fenster, Dedupe, Prompt-Rendering), Stufe 2a mit Testcontainers-Redis und mock-Klassifikator; Stufe 3: Segmente → `claims.detected` → Karte
- Verifikation: kompletter Pfad im isolierten Stack mit mock-Providern, belegt durch Stream-Einträge (Redis-MCP) und Logs

**🛑 Gate 3:** Backend-Pfad komplett (PRs `phase-2/tp4-gateway-audio`, `phase-2/tp5-claim-extractor`). Nachweis: WAV rein → Transkript-Events → Behauptung → Urteil.

## TP6 – Frontend: Aufnahme und Live-Transkript

- **T6.1 Einwilligungsdialog** (Brief 11, 15.6): vor jeder Aufnahme, nennt alle aktiven externen Anbieter (aus `/api/status`), ohne Bestätigung keine Aufnahme; Texte in `i18n/de.json`
- **T6.2 Aufnahme:** AudioWorklet (PCM16, mono, 16 kHz, ca. 100 ms), Start/Stopp-Button, Aufnahme- und Verbindungsstatus, Verhalten bei Displaysperre und App-Wechsel (Aufnahme sauber beenden und anzeigen)
- **T6.3 Live-Transkript:** Sprecher-Labels, interim grau, final schwarz; erkannte Behauptungen unterstrichen (grau „erkannt“ → Animation „wird geprüft“ → Farbe des Urteils, immer zusätzlich Icon/Text); Tipp auf die Markierung springt zur Karte; Zeitleiste zeigt auch Live-Behauptungen
- **T6.4** Store-Erweiterungen (Zustand) für Segmente und Aufnahme, Reconnect-Verhalten während einer Aufnahme
- **T6.5 Design-Durchgang (Marco, 2026-09-30):** Bevor das Frontend weiter ausgebaut wird, geht ein Design-Skill über die ganze Oberfläche (Aufnahme, Einwilligung, Live-Transkript, Karten, Zeitleiste, Einstellungen) und passt sie an die Zielgruppen an. Die Zielgruppen sind im Brief nicht ausdrücklich beschrieben; sie werden zu Beginn von T6.5 mit Marco festgelegt. T6.1–T6.4 liefern nur die funktionale Basis mit Tests; Politur und Layout kommen erst nach T6.5
- Tests: Stufe 1 (Stores, Worklet-Umrechnung, Komponenten), Stufe 2b mit `page.routeWebSocket` und Fake-Audio (Chromium) bzw. synthetischem MediaStream (WebKit), axe-Prüfung

## TP7 – E2E, iPhone, Phasenabschluss

- **T7.1 Stufe 4:** Live-Modus mit WAV-Fixture in Chromium (Fake-Audio-Flags), in WebKit per Init-Script mit synthetischem MediaStream; Einwilligungsdialog; Reconnect während der Aufnahme
- **T7.2** `docs/testing/iphone-smoke.md` anlegen (HTTPS-Zertifikat, Mikrofonfreigabe, Home-Bildschirm, Displaysperre, App-Wechsel); **Marco** läuft sie einmal auf dem echten iPhone durch (DoD)
- **T7.3** Nachweise nach 1.3 unter `docs/evidence/phase-2/`, README (Live-Modus, `up-local`, Deepgram-Key), `AGENTS.md`-Dateien aktualisiert, Anleitung zum lokalen Testen mit manuellen Testfällen
- **T7.4** Reviews (`reviewer`, `security-reviewer`, `/code-review`, `/security-review`), ZAP-Lauf (neue WebSocket-Oberfläche), `make llm-scan`
- **T7.5 Red-Team am Meilenstein** (Brief 15.7, Angriffsfläche geändert: Audio-Pfad, Extraktions-Prompt): Lauf mit dem lokalen Modell und – **Marco erinnern** – der verschobene Vergleichslauf mit Claude Opus 5 (Key und Guthaben nötig, Kosten vorher schätzen, Start nur nach OK)

**🛑 Gate 4:** Phasenabschluss (PRs `phase-2/tp6-web-live`, `phase-2/tp7-e2e`). Marco prüft das DoD auf dem iPhone.

## DoD → Tests

Jede Anforderung hat genau einen belegenden Test auf der niedrigsten passenden Stufe (`tests/AGENTS.md`); Tests, die ein DoD belegen, tragen `@dod` im Titel. Fehlerfälle liegen darunter (Stufe 1/2a) und stehen hier nicht einzeln.

| Anforderung (Brief 11, 13.2, 17) | Stufe | Test | Stand |
|---|---|---|---|
| **DoD:** ins iPhone sprechen, Transkript live, Karte für eine falsche Behauptung in wenigen Sekunden | manuell | `docs/testing/iphone-smoke.md` (Marco, T7.2) | Checkliste fertig, Lauf offen |
| Dasselbe automatisiert: Live-Modus bis zur Karte | 4 | `tests/e2e/live.spec.ts` `@dod` – synthetischer MediaStream in allen Browsern (das Mock-STT ignoriert den Ton, eine WAV-Datei brächte nichts) (T7.1) | grün |
| Ohne Einwilligung keine Aufnahme; Dialog nennt die aktiven Anbieter | 2b + 4 | 2b: `recording.spec.ts` (Anbieterliste, Abbrechen); 4: `live.spec.ts` `@dod` (T6.1, T7.1) | grün |
| Reconnect während einer Aufnahme | 1 + 2b | 1: `recording.test.ts`, `connection.test.ts`; 2b: `recording.spec.ts` `@dod` (Mock-Backend trennt; im echten Stack kann der Test den Gateway nicht neu starten) (T6.4, T7.1) | grün |
| Live-Transkript: interim grau, final schwarz, Markierungen, Sprung zur Karte | 1 + 2b | Komponenten- und Store-Tests; 2b mit `mock-backend.ts` (T6.3) | geplant |
| Audio-Weg Browser → Gateway → `transcription` → Transkript-Events | 3 | `tests/api/audio.spec.ts` (T4) | vorhanden |
| Audio-Fehlercodes, Budget, Backpressure, Aufnahmelimit | 1 + 2a | `services/gateway/src/audio.test.ts`, `api.int.test.ts`, `services/transcription/src/recording.test.ts` (T2, T4) | vorhanden |
| Segmente → `claims.detected` → Karte | 2a + 3 | `claim-extractor/src/main.int.test.ts`; Stufe 3 `tests/api/live-claims.spec.ts` (T5) | vorhanden |
| Erkennungsqualität (Precision, Recall, F1) | 5 | `pnpm eval --set detection` (T5.6) | geplant |
| Echte STT-Anbieter (Deutsch, Latenz, Sprecher) | manuell | `make stt-probe` (Deepgram, `stt-local`), Nachweise TP2/TP3 | vorhanden |
| Kein Audio gespeichert, kein Transkripttext und kein Key in Logs | 1 + 2a | `recording.test.ts`, `main.test.ts` (transcription), `test_app.py` (stt-local) | vorhanden |

## Risiken

- **Latenz „innerhalb weniger Sekunden“:** STT-Finalisierung (ca. 1 s) + Erkennung (LLM) + Prüfung (Live-Recherche 5–10 s, Brief 9.6). Mit lokalen Modellen auf dem 16-GB-Mac deutlich langsamer; das DoD wird mit Deepgram und Claude bzw. einem Cache-Treffer realistisch, mit rein lokalen Modellen eher nicht. Gemessen wird pro Pfad (`timings`).
- **Safari/iOS:** AudioContext, Displaysperre und Hintergrundverhalten weichen von Playwrights WebKit ab; deshalb die manuelle Checkliste.
- **Speicher:** `stt-local` im Container plus lokales LLM passen kaum gleichzeitig in 16 GB; für den lokalen Modus empfiehlt die Anleitung den nativen Start.

## Status

- [x] Plan freigegeben (Marco, 2026-09-29: „einfach jetzt mal weitermachen“)
- [x] TP0 erledigt (im PR des Plans, `phase-2/plan`): Recherche `.ai/research/stt-providers.md`, `faster-whisper.md`, `browser-audio.md`; Zusammenfassungen `gateway.md` (aktualisiert), `pipeline-streams.md` (neu); ADR 0015–0017 als Entwurf
- [x] **Gate 0** freigegeben (Marco, 2026-09-29): ADR 0015–0017 angenommen; Deepgram als Standard, Anbieter per Konfiguration austauschbar (`STT_PROVIDER`); faster-whisper bleibt, Messung in TP3 vor jeder Engine-Entscheidung
- [x] TP1 Verträge (PR `phase-2/tp1-contracts`): WebSocket v2 mit Audio, `audio.ts` (Frame-Budget, Stop-Gründe, internes Protokoll), `ClaimDetected` v3 mit `detectMs` (T1.4); Verbraucher im selben PR umgestellt; Nachweis `docs/evidence/phase-2/tp1-contracts.txt`
- [x] **Gate 1** freigegeben und PR #28 gemergt (Marco, 2026-09-29); dazu `ProviderStatus` v2 mit Rolle `stt`
- [x] TP2 T2.1–T2.4 (PR `phase-2/tp2-transcription`): STT-Adapter in `packages/providers/src/stt/` (Deepgram, AssemblyAI, local, mock), `publishToSession` in service-kit, Service `transcription` mit `/v1/audio`, Budget, Backpressure, Status; Compose und `.env.example`; Nachweis `docs/evidence/phase-2/tp2-transcription.txt`
- [x] T2.5 echter Deepgram-Test (Marcos Key und Freigabe, 5 Läufe, ca. 1,25 Cent): Standard bestätigt; Befund „Deepgram finalisiert in langen Blöcken“ behoben (Sätze aus Wort-Zeitstempeln, eigene Stille-Erkennung → `Finalize`, Ordinalzahlen); offen: „Weltkrieg“ → „2. Welt“ bei synthetischer Stimme, mit echter Stimme in TP7 prüfen. Werkzeug `make stt-probe`
- [x] Entschieden (Marco, 2026-09-29): Der Klassifikator bekommt in TP5 das ganze Segmentfenster als Kontext, **auch Jev**; Sprechernamen werden immer durch A, B, … ersetzt (ADR 0017, `packages/providers/AGENTS.md` angepasst)
- [x] TP3 `stt-local` (PR #31, gemergt): Python-Service mit faster-whisper, ruff/mypy/pytest (19 Tests), Image und Compose-Profil `local-stt`, `make up-local`, CI-Job, native Anleitung; echter Lauf mit `small`: drei korrekte Segmente, 1,7–2,2 s nach jeder Pause; Nachweis `docs/evidence/phase-2/tp3-stt-local.txt`
- [x] TP4 Audio-Pfad im Gateway (PR #32, gemergt): `src/audio.ts`, je ein Integrationstest pro Audio-Fehlercode, Stufe 3 `audio.spec.ts` über den echten Stack; neue depcruise-Regel gegen Dev-Abhängigkeiten im Produktionscode; Nachweis `docs/evidence/phase-2/tp4-gateway-audio.txt`
- [x] TP5 T5.1–T5.5 `claim-extractor` (PR #33): Vorfilter, Fenster in Redis, DETECTOR-Klassifikator, eigenständige Formulierung, Deduplizierung, `ClaimDetected` v3; Stufe 3 Audio → Behauptung → Urteil „falsch“; Nachweis `docs/evidence/phase-2/tp5-claim-extractor.txt`
- [ ] T5.6 Erkennungs-Eval-Set (PR #35): `evals/detection.de.jsonl` (161 Segmente aus Plenarprotokoll 20/213 mit Zitaten, 47 positiv), Labels nach zwei KI-Prüfungen zusammengeführt und von Marco als Ganzes angenommen (2026-09-30, Regel in `evals/README.md`); `make eval EVAL_SET=detection` (Runner im internen Netz, Trockenlauf mit Mock grün). Offen: Messlauf mit echtem Klassifikator (kostenpflichtig, Freigabe); Stryker für die Deduplizierung in PR #41
- Aktuelles Gate: Gate 2 (PR #31) und Gate 3 (PR #33) gemergt; rhetorische Fragen (PR #37, Entscheidung Marco 2026-09-30) offen
- [x] TP6 T6.1–T6.4 funktionale Basis (PR #36): Einwilligungsdialog mit allen Cloud-Anbietern (ohne Anbieterliste keine Aufnahme), Aufnahme per AudioWorklet (PCM16, 16 kHz, 100 ms), Beenden bei Displaysperre/App-Wechsel und Verbindungsverlust, Live-Transkript mit Markierungen und Sprung zur Karte; Stufe 1 (Stores, Encoder, Komponenten) und Stufe 2b in Chromium und WebKit mit synthetischem Mikrofon (39/39)
- [x] TP7 T7.1–T7.4 (PR `phase-2/tp7-e2e`, auf #36): Stufe-4-Journey Live-Modus grün in drei Browsern, Reconnect in Stufe 2b, iPhone-Checkliste, README und AGENTS, ZAP 0 Befunde, Security-Review ohne Befunde; Nachweis `docs/evidence/phase-2/tp7-e2e.txt`. Offen: `make llm-scan` (LM Studio)
- Nächster Task: **T6.5 Design-Durchgang** mit Marco (Zielgruppen festlegen), iPhone-Lauf (T7.2, Marco), T7.5 Red-Team (Guthaben oder LM Studio); danach Gate 4
- Review Gate 1 eingearbeitet: exakter Cache-Treffer-Test für `totalMs` (fact-checker); Audio-Fehlercodes → eigene Integrationstests in TP4 (Erinnerung in T4)
- Erinnerungen: Opus-5-Red-Team-Lauf in T7.5
- Offen (Marco, 2026-09-30): Das Claude-Abo-Guthaben ist nicht für API-Aufrufe der App nutzbar; der Opus-Red-Team-Lauf und bezahlte Eval-Läufe brauchen Guthaben in der Claude Console (API-Key). Vor T7.5 klären: Console-Guthaben aufladen, lokales Modell oder Lauf verschieben
- Security-Review PR #33 eingearbeitet (Marco, 2026-09-29): Budget „fail closed“ in `transcription`; Aufbewahrung 15 Min für Streams und Extractor-Speicher, Redis ohne AOF/RDB (ADR 0018); nosemgrep im Vorfilter **behalten** (Marco)
- Beobachten: Ein Redis-Neustart setzt den Tages-Budgetzähler zurück (ADR 0018, von Marco vorerst akzeptiert). Macht das Probleme, nur den Budgetzähler persistieren
- Nach Phase 2: Distroless-Runtime-Image für `stt-local` (Marco: „definitiv“; 44 HIGH-Befunde im Debian-Basisimage, 0 kritisch)
- Offen für Marco: CodeQL-Alerts #7–#11; alte Volume `live-factcheck_redis-data` einmal löschen (`docker volume rm`, enthält AOF-Daten)
- **Beim Phasenwechsel nach Phase 2 (Marco erinnern, 2026-09-29):** Umstieg von Docker Desktop auf **OrbStack** prüfen. Grund: Die Docker-VM (8 GB RAM, 58 GB Platte) ist auf dem 16-GB-Mac knapp – starkes Swapping bei lokalen Modellen, die Platte lief dreimal voll (zuletzt `stt-local` konnte sein Modell nicht laden). Vorher: die Caddy-CA sichern (iPhone-Zertifikat; Redis hält seit ADR 0018 nichts mehr), und `make up`, `make test`, `make up-local` danach einmal komplett prüfen
