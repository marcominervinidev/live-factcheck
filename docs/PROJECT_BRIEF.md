# Projekt-Brief: Live-Faktencheck (`live-factcheck`)

> Dieses Dokument ist der Ausgangspunkt für die Arbeit mit einem Coding-Agent. Primär ist das Claude Code, als Ausweichwerkzeug Google Antigravity (siehe Abschnitt 1.4). Lies es vollständig, bevor du irgendetwas anlegst.

## 1. Deine Rolle und Arbeitsweise

- Du arbeitest als Senior Full-Stack- und Platform-Engineer. Ich bin Senior Test Automation Engineer (TypeScript, Playwright, Docker, Jenkins) und baue gerade DevOps- und Kubernetes-Know-how auf. Erkläre DevOps-relevante Entscheidungen deshalb kurz. Grundlagen zu TypeScript oder Testing brauchst du mir nicht zu erklären.
- Arbeite strikt in den Phasen aus Abschnitt 17 und nach dem Ablauf in Abschnitt 1.2. Ich führe die Architektur, du beschleunigst die Umsetzung. Die Verantwortung für Korrektheit, Sicherheit und Architektur bleibt bei mir.
- Bevor du mit Phase 0 beginnst, stellst du mir maximal 5 Rückfragen zu Punkten, die wirklich unklar sind.
- Lege zu Beginn eine Root-`AGENTS.md` an (Stack, gemeinsame Befehle, übergreifende Konventionen, Architekturüberblick) und halte sie aktuell. Sie ist die **maßgebliche Regeldatei für alle Agent-Tools** (siehe 1.4). Jeder Service und jedes Paket bekommt zusätzlich eine eigene `AGENTS.md` neben seinem Code, mit dem, was nur dort gilt (Stack-Besonderheiten, Stolperfallen, Verträge). Das gilt besonders für `stt-local`, weil dort Python mit eigenen Konventionen läuft. Eine Regel gehört immer in den engsten passenden Scope. Regeldateien enthalten Regeln, keine Schritt-für-Schritt-Anleitungen, keinen aktuellen Arbeitsstand und keine Secrets.
- Neben jeder `AGENTS.md` liegt eine schlanke `CLAUDE.md`. Sie bindet die `AGENTS.md` per `@AGENTS.md` ein und enthält nur, was ausschließlich Claude Code betrifft (z. B. `/compact`, Subagents, Hooks). Regeln werden nie doppelt gepflegt.
- **Zweimal-Regel:** Korrigiere ich dich zum zweiten Mal beim selben Punkt, schlägst du vor, die Regel in die passende `AGENTS.md`, einen Skill oder einen Review-Prompt aufzunehmen. Nutze dafür keine persönliche Memory, weil Projektregeln committet sein müssen.
- Dokumentiere jede nicht-triviale Architekturentscheidung als ADR unter `docs/adr/NNNN-titel.md` (Kontext, Entscheidung, Alternativen, Konsequenzen).
- **Du committest nicht auf `main` und mergst nie selbst.** Jede Phase (bei großen Phasen jedes Teilprojekt) läuft auf einem eigenen Feature-Branch. Commits sind klein und folgen dem Conventional-Commits-Format. Am Ende öffnest du einen PR. Gemergt wird erst, nachdem ich den Diff Datei für Datei gelesen habe. Automatische Reviews (Subagents, CI, AI-Review) sind ein erster Filter, kein Ersatz für meine Freigabe.
- Code, Bezeichner und Kommentare schreibst du auf Englisch. Alle UI-Texte sind Deutsch und werden i18n-fähig abgelegt.
- Secrets gehören niemals in Code, Commits oder das Frontend.
- **Das Projekt ist mein öffentliches DevOps-Portfolio.** README, Pipeline-Historie, ADRs und Architekturdiagramme sollen für Recruiter und technische Interviewer ohne Erklärung nachvollziehbar sein. Die README bekommt deshalb Status-Badges, ein Architekturdiagramm (Mermaid) und einen Abschnitt „Was dieses Projekt zeigt“.

### 1.1 Agent-Setup im Repo

Richte in Phase 0 folgendes ein und committe es mit (ohne Secrets). Die Inhalte (Prompts, Skills, Regeln) liegen tool-neutral im Repo; die tool-spezifischen Dateien sind nur dünne Hüllen darum (siehe 1.4).

- **Review- und Rollen-Prompts unter `.ai/prompts/`** (`reviewer.md`, `security-reviewer.md`, `platform-engineer.md`). Für Claude Code verweisen Subagents unter `.claude/agents/` auf diese Prompts, in Antigravity werden dieselben Prompts als eigene Agenten bzw. Workflows eingebunden:
  - `reviewer` prüft Änderungen gegen diesen Brief: 12 Faktoren (4.1), Modulgrenzen und Verträge (4.2), Sicherheit (15), Tests (13) und Konventionen aus den `AGENTS.md`-Dateien. Er achtet gezielt auf die typischen Agent-Fehler:
    - aufgeweichte Typen (`any`-Äquivalente, nachträglich optionale Pflichtfelder, stille Default-Werte, die schlechte Eingaben verdecken)
    - Grenzverletzungen (Importe oder Aufrufe über Service- bzw. Paketgrenzen hinweg)
    - Drive-by-Änderungen, die nicht zum Task gehören
    - erfundene Muster, obwohl es schon eine Abstraktion oder einen Helper gibt
    - Tests, die den Mock testen statt das Verhalten
    - Features oder Flags, die niemand verlangt hat
    - Er meldet Befunde mit Datei und Zeile, schreibt aber keinen Code.
    - Er erwähnt kein bestimmtes Modell und setzt kein Claude-spezifisches Ausgabeformat voraus, damit der Prompt auch mit Gemini funktioniert.
  - `security-reviewer` legt den Fokus auf Secrets, SSRF, Prompt-Injection, Container-Härtung und Kubernetes-Manifeste.
  - `platform-engineer` ist zuständig für Dockerfiles, Compose, Kubernetes-Manifeste, Terraform und Pipelines.
- **Agent-Hooks in `.claude/settings.json`** sind ein Komfort- und Frühwarnsystem, nicht die eigentliche Absicherung. Die gilt für jedes Tool und liegt in Git-Hooks und CI (siehe 1.4).
  - Nach Dateiänderungen laufen Formatierung und Lint für die betroffenen Pakete.
  - Vor dem Abschluss einer Aufgabe (`Stop`) müssen die Tests des betroffenen Services grün sein.
  - Ein Hook blockiert das Lesen und Schreiben von `.env` sowie jeden Zugriff auf das Secret-Verzeichnis außerhalb des Repos (siehe 15.1).
  - Ein Hook warnt bei Änderungen unter `packages/contracts/`, solange ich sie nicht ausdrücklich freigegeben habe (siehe 4.2).
  - Beim Sessionstart wird der Stand der aktuellen Phase aus `.ai/plans/` eingeblendet. Vor einer Kompaktierung (`PreCompact`) werden offene Punkte und Erkenntnisse in die Plan-Datei geschrieben.
- **Skills unter `.agents/skills/`** (tool-neutraler Speicherort; `.claude/skills` ist ein Symlink darauf). Sie sind schmal und kombinierbar statt eines Mega-Skills und so formuliert, dass sie ohne Claude-spezifische Annahmen auch in Antigravity funktionieren:
  - `new-service` legt einen Service nach Schema an: service-kit, Konfigurationsvalidierung, Health/Metrics, Dockerfile mit `dev`- und `runtime`-Stage, Compose-Eintrag, eigene `AGENTS.md` und `CLAUDE.md`, ab Phase 5 auch Kustomize-Manifeste.
  - `new-event-contract` legt ein neues zod-Schema mit `schemaVersion`, Contract-Tests und Dokumentation an.
  - `adr` erzeugt ein neues ADR aus der Vorlage mit der nächsten freien Nummer.
  - `evidence` sammelt die Nachweise eines Tasks im festen Format (siehe 1.3).
  - Einen neuen Skill schlägst du vor, sobald ich dir denselben Ablauf zum zweiten Mal erkläre.
- **MCP-Server,** bewusst wenige, weil jeder Server Kontext kostet. Für Claude Code stehen sie in `.mcp.json` im Projekt-Scope. Für Antigravity liegt unter `tools/antigravity/mcp_config.example.json` eine Vorlage mit denselben Servern. Antigravity erwartet die Konfiguration unter macOS in `~/.gemini/antigravity/mcp_config.json` und verlangt absolute Pfade; `make agent-setup` erzeugt die Datei aus der Vorlage.
  - ab sofort GitHub (Issues, PRs) und Context7 (aktuelle Bibliotheksdoku, vor allem für Fastify, KEDA, Argo CD, Terraform-Provider),
  - ab Phase 0 ein Docker-MCP (Container-Status, Logs, `exec`) und ein Redis-MCP (Streams, Consumer Groups, Pending-Einträge, Pub/Sub) für die Selbstverifikation,
  - ab Phase 1 Playwright MCP, um UI-Änderungen im echten Browser zu prüfen,
  - ab Phase 5 ein Kubernetes-MCP im Read-only-Modus für Cluster-Diagnose.
  - Nur offizielle bzw. gut gepflegte Server, keine Produktions-Secrets in MCP-Konfigurationen. Tokens kommen aus Umgebungsvariablen und stehen in keiner MCP-Konfiguration.

### 1.2 Ablauf pro Phase und Session-Disziplin

1. **Planen vor dem Code.** Zu Beginn jeder Phase legst du `.ai/plans/phase-N-<titel>.md` an. Der Plan zerlegt die Phase in Teilprojekte und Tasks, jeweils mit exakten Dateipfaden, erwarteter Code-Form und Verifikationsbefehl. Er enthält auch die Review-Gates, also nach welchen Tasks du anhältst. Offene Designfragen klärst du vorher mit mir; nicht-triviale Entscheidungen werden zum ADR. Code schreibst du erst nach meiner Freigabe des Plans.
2. **Kontext vorbereiten.** Für neue oder komplexe Abhängigkeiten (z. B. STT-Anbieter, KEDA mit Redis Streams, Argo CD, SearXNG) erstellst du zuerst eine kompakte Zusammenfassung unter `.ai/research/`, gestützt auf Context7 und die offizielle Doku. Für bestehende Codebereiche, die eine Phase stark verändert, legst du eine Kurzbeschreibung unter `.ai/summaries/` an (Verantwortung, Datenfluss, zentrale Typen, Stolperfallen). Die Implementierung lädt diese Dateien statt der Rohquellen. Verweise auf Dateien, statt Inhalte in den Chat zu kopieren.
3. **Umsetzen mit Orchestrator-Muster.** Bei Phasen, die mehrere Services berühren (vor allem Phase 2, 5 und 6), hält die Hauptsession Plan, Verträge und Entscheidungen. Jeder klar abgegrenzte Task geht an einen Subagent mit einem engen Briefing: die Dateien, der Vertrag, die erwartete Ausgabe und der Verifikationsbefehl. Du überprüfst und integrierst das Ergebnis, bevor der nächste Task startet.
4. **Review-Gates einhalten.** Du arbeitest nur bis zum nächsten Gate im Plan und hältst dort an, auch mitten in einer Phase. Die Batch-Größe ist so gewählt, dass ich den Diff wirklich lesen kann.
5. **Selbst verifizieren, mit Nachweisen** (siehe 1.3).
6. **Review.** Du lässt `reviewer` und `security-reviewer` laufen, zusätzlich `/code-review` und `/security-review`. Befunde werden behoben oder begründet zurückgestellt.
7. **Übergabe.** Du öffnest den PR mit Zusammenfassung, Nachweisen und Hinweisen, wo ich beim Review genau hinschauen sollte, vor allem an den Schnittstellen zwischen Services. Weicht die Umsetzung von diesem Brief ab, sagst du das ausdrücklich und aktualisierst den Brief bzw. das ADR im selben PR.

**Session-Disziplin:** Eine Session verfolgt ein zusammenhängendes Ziel, typischerweise ein Teilprojekt oder einen Task-Block. Ändert sich das Ziel, beginnt eine neue Session, die mit der `AGENTS.md` und der Plan-Datei startet. Die Plan-Datei ist stets so aktuell, dass eine neue Session (auch in einem anderen Tool) ohne Rückfragen weitermachen kann: erledigte Tasks abgehakt, nächster Task benannt, offene Punkte notiert. In die `CLAUDE.md` gehört außerdem der Hinweis, bei etwa 60–70 % Kontextauslastung manuell `/compact` auszuführen, statt auf die automatische Kompaktierung zu warten. Fragst du bereits geklärte Punkte erneut ab, ist das das Signal für eine frische Session.

### 1.3 Beweise statt Behauptungen

„Fertig“, „Tests sind grün“ oder „funktioniert“ sind Behauptungen, keine Nachweise. Jeder abgeschlossene Task liefert Artefakte:

- **Tests und Checks:** die tatsächliche Ausgabe der Test-, Lint- und Scan-Befehle, inklusive übersprungener Tests (und warum)
- **Backend:** echte HTTP-Anfragen gegen den laufenden Stack mit Request und Response, dazu der Zustand in Redis über den Redis-MCP. Beispiel: Eine eingetippte Behauptung erscheint nacheinander in `claims.detected` und `claims.checked`, die Consumer Groups haben keine hängenden Einträge.
- **Frontend:** Durchlauf des betroffenen Nutzerflusses per Playwright-MCP, Screenshots an den Entscheidungspunkten, Konsolenfehler
- **Service-übergreifend:** der komplette Pfad, belegt durch Stream-Einträge und Logauszüge der beteiligten Container über den Docker-MCP
- **Infrastruktur (ab Phase 5):** `kubectl`-Ausgaben, Argo-CD-Sync-Status und Grafana-Screenshots

Die Nachweise landen in der PR-Beschreibung und kompakt unter `docs/evidence/phase-N/`. Diese Selbstverifikation ergänzt die automatisierten Tests, ersetzt sie aber nicht. Ohne Artefakt gilt ein Task als nicht erledigt.

### 1.4 Tool-Unabhängigkeit (Claude Code und Antigravity)

Ich arbeite primär mit Claude Code in VS Code. Wenn mein Nutzungslimit erreicht ist, mache ich mit Google Antigravity weiter. Das Projekt muss deshalb so aufgebaut sein, dass beide Tools mit denselben Regeln arbeiten und die wichtigen Schutzmaßnahmen unabhängig vom Tool greifen.

| Baustein | Tool-neutrale Quelle | Claude Code | Antigravity |
|---|---|---|---|
| Regeln | `AGENTS.md` (Root und pro Service) | `CLAUDE.md` mit `@AGENTS.md` plus Claude-Spezifika | liest `AGENTS.md` direkt; `GEMINI.md` nur bei Bedarf für Antigravity-Spezifika |
| Skills | `.agents/skills/*/SKILL.md` | `.claude/skills` als Symlink | liest `.agents/skills` |
| Review- und Rollen-Prompts | `.ai/prompts/*.md` | Subagents in `.claude/agents/`, die auf die Prompts verweisen | eigene Agenten bzw. Workflows mit denselben Prompts |
| MCP-Server | Liste in `docs/ai-tooling.md` | `.mcp.json` | `~/.gemini/antigravity/mcp_config.json`, erzeugt aus `tools/antigravity/mcp_config.example.json` |
| Plan und Stand | `.ai/plans/`, ADRs, Git-Historie | gleich | gleich |

**Schutzmaßnahmen, die für jedes Tool gelten.** Agent-Hooks greifen nur in Claude Code. Alles, was wirklich zählt, wird deshalb zusätzlich über Git-Hooks (lefthook) und die CI erzwungen:

- **Secrets:** Echte Secrets liegen nie im Repo-Ordner (siehe 15.1). Damit landen sie weder versehentlich im Agent-Kontext noch in einem Commit, egal welches Tool läuft.
- **Pre-Commit (lefthook):** gitleaks, Formatierung, Lint, Typecheck, Unit-Tests der betroffenen Pakete und die Grenzprüfung aus 4.2 (siehe 13.3)
- **Verträge:** Ein CI-Check schlägt fehl, wenn sich Dateien unter `packages/contracts/` ändern, ohne dass im selben PR ein neues oder geändertes ADR und eine höhere `schemaVersion` enthalten sind. Zusätzlich verlangt eine `CODEOWNERS`-Datei für `packages/contracts/`, `.github/`, `deploy/` und `infra/` mein Review.
- **Branch-Protection** auf `main` gilt unabhängig davon, wer oder was die Commits erzeugt hat.

**Übergabe zwischen den Tools:**

1. Gewechselt wird nur an einem Review-Gate, nie mitten in einem Task.
2. Vor dem Wechsel: Plan-Datei aktualisieren, Zwischenstand auf dem Feature-Branch committen (Commit-Präfix `wip:` ist erlaubt, wird beim Merge zusammengefasst).
3. Die neue Session startet mit: „Lies `AGENTS.md` und `.ai/plans/phase-N-….md` und mach beim nächsten offenen Task weiter.“
4. Im PR steht, welche Tasks mit welchem Tool entstanden sind, damit ich beim Review weiß, wo ich genauer hinschauen muss.

`docs/ai-tooling.md` beschreibt die Einrichtung beider Tools auf einem neuen Rechner in wenigen Schritten.

## 2. Produktziel

Wir bauen eine mobile-first Web-App (PWA), die ein Gespräch live über das Mikrofon mithört und transkribiert. Sie unterscheidet die Sprecher, erkennt prüfbare Tatsachenbehauptungen und bewertet sie per Web-Recherche und LLM. Die Ergebnisse erscheinen noch während des Gesprächs als Karten-Feed.

Ein Beispiel: Jemand sagt „Der Zweite Weltkrieg ist erst 20 Jahre vorbei.“ Die App zeigt daraufhin eine Karte mit ❌ falsch, Konfidenz hoch, der Begründung „Der Zweite Weltkrieg endete 1945, also vor über 80 Jahren.“ und den Quellen.

Die Gespräche finden primär auf Deutsch statt. Getestet wird auf dem iPhone (Safari/PWA) und im Desktop-Browser.

## 3. Nicht-Ziele (vorerst)

- Keine native iOS-App. Später ist eine per Capacitor möglich; dann kommen Appium-Tests dazu (siehe 13.6)
- Kein Login und keine Multi-User-Verwaltung; ein einfacher Zugriffsschutz per Token reicht
- Kein Deployment bei einem großen Hyperscaler und kein Managed Kubernetes. Das Zielbild ist: Docker Compose lokal, dann k3d auf dem Mac, dann ein selbst betriebener k3s-Cluster auf VMs, provisioniert per Terraform (siehe Abschnitt 14)
- Keine Hintergrundaufnahme bei gesperrtem Bildschirm

## 4. Architekturprinzipien

- **Ein Service pro Verantwortung, ein Container pro Service.** Jeder Service lässt sich einzeln bauen, starten und skalieren.
- **Stateless Services.** Zustand liegt in Redis (Streams, Cache, Session-State) und später in Postgres. Jede Instanz ist jederzeit ersetzbar.
- **Event-getriebene Pipeline** über Redis Streams mit Consumer Groups. So skalieren die Worker horizontal: Mehrere Replicas teilen sich die Arbeit.
- **12-Factor-App.** Die gesamte Software folgt konsequent den zwölf Faktoren (Details in Abschnitt 4.1). Abweichungen sind nur mit ADR erlaubt.
- **Alles läuft von Anfang an in Containern**, auch in der Entwicklung (Details in Abschnitt 12).
- **Security by Design.** Sicherheit gehört ab Phase 0 zur Definition of Done (Details in Abschnitt 15).
- **Adapter-Pattern für alle externen Abhängigkeiten** (LLM, Speech-to-Text, Websuche). Anbieter sind per Konfiguration austauschbar. Das gilt auch für lokale Alternativen und einen Mock-Provider für Tests.
- **Contract-first.** Alle Events und API-Payloads sind zod-Schemas in einem Shared-Package; die Typen werden daraus abgeleitet. Verträge entstehen vor der Implementierung und sind danach verbindlich (Details in Abschnitt 4.2).
- **Betriebsfähigkeit von Anfang an.** Jeder Service bietet `/healthz` (Liveness), `/readyz` (Readiness mit Prüfung der Abhängigkeiten) und `/metrics` (Prometheus). Er loggt strukturiert als JSON und fährt bei SIGTERM sauber herunter, indem er laufende Arbeit abschließt oder zurückgibt.
- **Kubernetes-ready, Kubernetes selbst aber erst in Phase 5.** Bis dahin wird nichts eingebaut, was nur in Kubernetes funktioniert.

### 4.1 Die zwölf Faktoren in diesem Projekt

| Faktor | Umsetzung |
|---|---|
| I. Codebase | Ein Git-Repo (Monorepo). Jeder Service ist eine eigenständig deploybare App mit eigenem Image, gebaut aus demselben Commit. |
| II. Abhängigkeiten | Explizit deklariert und gelockt (`pnpm-lock.yaml`, für Python z. B. `uv.lock`). Keine Annahmen über systemweit installierte Tools; alles Nötige steckt im Image. Base-Images mit fester Version, ab Phase 6 per Digest gepinnt. |
| III. Konfiguration | Ausschließlich Umgebungsvariablen (Secrets zusätzlich als Datei, siehe 15.1). Jeder Service validiert seine Konfiguration beim Start mit zod und bricht mit klarer Fehlermeldung ab, wenn etwas fehlt oder ungültig ist (fail fast). Keine umgebungsspezifischen Config-Dateien im Code. |
| IV. Unterstützende Dienste | Redis, Postgres, SearXNG sowie LLM- und STT-Anbieter sind angehängte Ressourcen, erreichbar nur über URL und Zugangsdaten aus der Konfiguration. Ein Wechsel (z. B. LM Studio → Claude oder lokales → verwaltetes Redis) braucht keine Code-Änderung. |
| V. Build, Release, Run | Ein Image wird einmal gebaut und mit dem Git-SHA getaggt. Dasselbe Image läuft in Compose und in Kubernetes, nur die Konfiguration unterscheidet sich. Zur Build-Zeit fließen weder Secrets noch Umgebungswerte ein. |
| VI. Prozesse | Stateless und share-nothing. Kein lokaler Zustand in Dateisystem oder Speicher, der einen Neustart überleben muss. |
| VII. Port-Bindung | Jeder Service bringt seinen eigenen HTTP-Server mit und lauscht auf `PORT`. |
| VIII. Nebenläufigkeit | Skaliert wird über Prozesstypen (`web`, `gateway`, `transcription`, Worker) und die Anzahl der Replicas, nicht über größere Instanzen. |
| IX. Einweggebrauch | Schneller Start, sauberes Herunterfahren bei SIGTERM. Da Redis Streams at-least-once liefern, verarbeiten die Worker idempotent: `XACK` erst nach Erfolg, liegengebliebene Nachrichten per `XAUTOCLAIM` übernehmen, doppelte Verarbeitung über `claimId` erkennen. |
| X. Dev-Prod-Parität | Entwicklung läuft in denselben Containern mit denselben unterstützenden Diensten, also echtes Redis statt In-Memory-Ersatz. Compose und Kubernetes bilden dieselbe Topologie ab. |
| XI. Logs | Logs sind Event-Streams auf stdout, eine JSON-Zeile pro Event. Keine Logdateien und keine Log-Rotation im Service. |
| XII. Admin-Prozesse | Einmalige Aufgaben (DB-Migrationen, Eval-Läufe, Seed-Daten) laufen als eigene Kommandos im selben Image, lokal per `docker compose run --rm`, später als Kubernetes-Jobs. |

**Sonderfall Frontend:** Vite schreibt `VITE_*`-Variablen zur Build-Zeit fest ins Bundle, was Faktor III und V verletzt. Deshalb enthält das Frontend-Image keine Umgebungswerte. Die Laufzeitkonfiguration (z. B. die Gateway-URL) generiert der nginx-Container beim Start aus Umgebungsvariablen und liefert sie als `/config.json` aus. Secrets gehören dort nie hinein.

### 4.2 Modulgrenzen und Verträge

- **Verträge sind für dich read-only.** Die Implementierung richtet sich nach `packages/contracts`, nicht umgekehrt. Passt ein Vertrag nicht, hältst du an und schlägst die Änderung mit Begründung vor. Jede freigegebene Vertragsänderung bekommt ein ADR, eine höhere `schemaVersion` und angepasste Contract-Tests, und zwar in einem eigenen Commit.
- **Services importieren nie voneinander.** Erlaubt sind nur Importe aus `packages/*`, und das nur über die explizit deklarierten `exports` der Pakete, nicht über interne Pfade. Services kommunizieren ausschließlich über die definierten Events und HTTP- bzw. WebSocket-Schnittstellen.
- **Durchgesetzt wird das technisch,** nicht nur per Konvention: mit TypeScript Project References, expliziten `exports` in jeder `package.json` und einer Abhängigkeitsprüfung (dependency-cruiser oder eslint-plugin-boundaries) in Pre-Commit und CI. `any` und `@ts-ignore` sind per Lint verboten; Ausnahmen brauchen einen begründeten Kommentar.
- **Keine Abkürzungen, um einen Test grün zu bekommen.** Pflichtfelder werden nicht optional gemacht, Typen nicht erweitert, Fehler nicht durch stille Defaults verdeckt. Blockiert dich eine Grenze oder ein Typ, meldest du das.
- **Kein Überbau.** Du baust keine Abstraktionen, Flags oder Features, die weder im Brief noch im freigegebenen Plan stehen. Gute Ideen notierst du als Vorschlag im PR.
- **Neue Services orientieren sich am besten bestehenden Service** und übernehmen dessen Struktur und Qualitätsniveau (über den Skill `new-service`).

## 5. Services

| Service | Technologie | Aufgabe | Skalierung |
|---|---|---|---|
| `web` | React, Vite, TypeScript, Tailwind, Zustand; ausgeliefert über nginx | PWA-Frontend | beliebig (statisch) |
| `gateway` | Node.js (aktuelle LTS), TypeScript, Fastify, `@fastify/websocket` | Einziger öffentlicher API-Einstieg (REST + WebSocket). Verwaltet Sessions, leitet Audio an `transcription` weiter und pusht Ergebnisse an den Client | horizontal; WebSocket-Sessions brauchen Session-Affinität oder Fan-out über Redis Pub/Sub (siehe ADR) |
| `transcription` | Node.js/TS | Streaming-Speech-to-Text über Adapter (Cloud) oder Weiterleitung an `stt-local`. Veröffentlicht Transkript-Segmente mit Sprecher-Label | nach Anzahl aktiver Sessions |
| `stt-local` (optional, Compose-Profil `local-stt`) | Python, FastAPI, faster-whisper | Vollständig lokale Transkription, in der ersten Version ohne Diarization | CPU-/GPU-gebunden |
| `claim-extractor` | Node.js/TS Worker | Liest Segmente und erkennt in drei Stufen prüfwürdige Tatsachenbehauptungen: Vorfilter, Klassifikator, Umformulierung in eine eigenständige Aussage (siehe 8.1). Dedupliziert pro Session | horizontal über Consumer Group |
| `fact-checker` | Node.js/TS Worker | Prüft pro Behauptung zuerst die Caches, dann den Evidenz-Speicher und recherchiert bei Bedarf live. Der Klassifikator fällt das Urteil. Veröffentlicht das Urteil sofort, ohne auf eine Erklärung zu warten (siehe 9) | horizontal über Consumer Group |
| `explainer` | Node.js/TS Worker | Erzeugt nachträglich per LLM eine kurze Erklärung zum Urteil und veröffentlicht sie als eigenes Event | horizontal, per KEDA bis auf null herunterskalierbar |
| `topic-tracker` (ab Phase 4) | Node.js/TS Worker | Erkennt das aktuelle Gesprächsthema und stößt vorab Recherche an, damit spätere Behauptungen auf bereits indexierte Evidenz treffen (siehe 9.4) | horizontal über Consumer Group |
| `redis` | Redis (offizielles Image) | Streams, Pub/Sub, Cache | — |
| `searxng` | SearXNG (offizielles Image) | Selbst gehostete Metasuche ohne API-Key für den lokalen Modus | — |
| `caddy` | Caddy | Lokaler Reverse Proxy mit HTTPS; entspricht später dem Ingress | — |
| `postgres` (ab Phase 4) | PostgreSQL mit pgvector | Sitzungsverlauf, Behauptungen, Urteile, Evidenz-Speicher (Chunks mit Embeddings), semantischer Urteils-Cache | — |

Wenn dir ein anderer Schnitt sinnvoller erscheint (z. B. `transcription` und `gateway` zusammenlegen), schlag ihn mit Begründung als ADR vor, bevor du ihn umsetzt.

## 6. Datenfluss

1. Der Client öffnet eine WebSocket-Verbindung zum `gateway` (`/ws/session`) und erhält eine `sessionId`.
2. Der Client nimmt Audio per AudioWorklet auf. Er sendet PCM16, mono, 16 kHz in Frames von ca. 100 ms als Binärnachrichten. Steuernachrichten (start, stop, Sprecher umbenennen) gehen als JSON.
3. Das `gateway` leitet den Audiostream über einen internen WebSocket an `transcription` weiter.
4. `transcription` streamt an den konfigurierten STT-Anbieter und schreibt finale Segmente in den Stream `transcript.segments`. Zwischenergebnisse (interim) gehen nur per Pub/Sub an den Client, nicht in die Pipeline.
5. `claim-extractor` sammelt pro Session ein rollierendes Fenster der letzten Segmente. Ein deterministischer Vorfilter verwirft offensichtlichen Smalltalk. Der Klassifikator entscheidet, ob ein Segment eine prüfwürdige Tatsachenbehauptung enthält. Nur für positive Fälle formuliert ein LLM die Behauptung in eine eigenständige Aussage um (Pronomen und Bezüge aufgelöst). Das Ergebnis geht nach `claims.detected`. Dedupliziert wird über einen normalisierten Hash und einen Abgleich mit den bereits erkannten Behauptungen der Session.
6. `fact-checker` prüft Urteils-Cache, Evidenz-Speicher und bei Bedarf die Live-Recherche (siehe 9.6). Der Klassifikator fällt das Urteil, das sofort nach `claims.checked` geht.
6a. `explainer` liest `claims.checked` und schreibt eine kurze Erklärung nach `claims.explained`. Das UI zeigt das Urteil also zuerst und ergänzt die Erklärung, sobald sie da ist.
6b. Ab Phase 4 liest `topic-tracker` ebenfalls `transcript.segments`, schreibt erkannte Themen nach `topics.detected` und füllt den Evidenz-Speicher vorab.
7. Alle für den Client relevanten Events landen zusätzlich auf dem Pub/Sub-Kanal `session:{sessionId}:events`. Die `gateway`-Instanz mit der offenen Verbindung pusht sie an den Client.
8. Zusätzlich gibt es einen Textmodus: `POST /api/claims/check` nimmt eine eingetippte Behauptung entgegen, die direkt in `claims.detected` landet. Er dient für Phase 1 und zum Testen.

## 7. Event-Verträge (Shared-Package `packages/contracts`)

Mindestens diese Schemas, jeweils mit `schemaVersion` versioniert:

```ts
TranscriptSegment { sessionId, segmentId, speaker: string, text, startMs, endMs, isFinal, language }

ClaimDetected     { sessionId, claimId, speaker, originalText, standaloneText, normalizedText,
                    checkworthiness: number /* 0..1 */, sourceSegmentIds[], detectedAt,
                    provider: { classifier, model } }

ClaimChecked      { sessionId, claimId, speaker, claim /* standaloneText */,
                    verdict, probabilities: Record<Verdict, number>, confidence: number /* 0..1 */,
                    confidenceLevel, evidence: Evidence[], bestEvidenceId?,
                    cacheHit: "none" | "verdict_exact" | "verdict_semantic" | "evidence_store",
                    existingFactCheck?: { publisher, url, rating },
                    timings: { detectMs, retrieveMs, classifyMs, totalMs },
                    checkedAt, provider: { classifier, model, search, embeddings } }

ClaimExplained    { sessionId, claimId, explanation /* max. 2 Sätze, Deutsch */, provider: { llm, model } }

TopicDetected     { sessionId, topicId, label, keywords[], detectedAt }

Evidence          { evidenceId, title, url, publisher, publishedAt?, retrievedAt,
                    tier: "faktencheck" | "amtlich" | "referenz" | "presse" | "sonstige",
                    snippet /* kurzer Auszug, keine Volltexte */ }

Verdict:          "stimmt" | "groesstenteils_richtig" | "uebertrieben" | "falsch" | "nicht_pruefbar"
confidenceLevel:  "hoch" | "mittel" | "niedrig"   // aus confidence per konfigurierbaren Schwellen abgeleitet
```

**Zu den Wahrscheinlichkeiten:** Das UI zeigt standardmäßig Urteil und Konfidenzstufe, die Verteilung über alle Urteile nur in der Detailansicht. Ein Prozentwert wird erst dann prominent angezeigt, wenn die Evals (13.5) für den verwendeten Klassifikator eine gute Kalibrierung auf deutschen Daten belegen. Vorher gilt, was schon für LLM-Prozentwerte galt: Sie sehen präziser aus, als sie sind.

## 8. LLM-Abstraktion (muss mit lokalen Modellen funktionieren)

- Es gibt ein gemeinsames Interface `LlmProvider` mit einer Methode für strukturierte Antworten: Prompt und zod-Schema rein, validiertes Objekt raus.
- Implementierungen:
  - `anthropic` über das offizielle SDK `@anthropic-ai/sdk`
  - `openai-compatible` über das `openai`-SDK mit konfigurierbarer `baseURL`. Das deckt **LM Studio** (Standard `http://localhost:1234/v1`) und **Ollama** (Standard `http://localhost:11434/v1`) ab, später auch vLLM o. Ä.
  - `mock` mit deterministischen Antworten für Tests
- Die Konfiguration ist **pro Aufgabe getrennt**, damit z. B. die Extraktion lokal und das Urteil über Claude laufen kann: `EXTRACTOR_LLM_PROVIDER`, `EXTRACTOR_LLM_BASE_URL`, `EXTRACTOR_LLM_MODEL`, `EXTRACTOR_LLM_API_KEY` und analog `CHECKER_LLM_*`.
- Modellnamen werden nie hart codiert, sondern nur konfiguriert. Die `.env.example` enthält sinnvolle Beispiele: für Claude ein schnelles, günstiges Modell für die Extraktion und ein stärkeres für das Urteil.
- Robustheit bei lokalen Modellen:
  - Den JSON-Modus nutzen, wo der Server ihn unterstützt.
  - Die Antwort immer mit zod validieren.
  - Bei einem Fehler genau einen Reparaturversuch machen, mit der Fehlermeldung im Prompt.
  - Scheitert auch der, lautet das Ergebnis `nicht_pruefbar`, statt dass der Service abstürzt.
  - Timeouts und Retries sind konfigurierbar.
- **Netzwerk-Hinweis für macOS:** LM Studio und Ollama laufen nativ auf dem Mac, weil Docker unter macOS keinen GPU-/Metal-Zugriff hat. Aus Containern heraus sind sie über `http://host.docker.internal:<port>/v1` erreichbar. Das muss in `.env.example` und README dokumentiert sein.
- Prompts liegen als eigene, versionierte Dateien mit Platzhaltern unter `services/*/prompts/*.md` und nicht als Strings im Code verstreut.

### 8.1 Klassifikator und Aufgabenverteilung der Modelle

Die meisten Entscheidungen in der Pipeline sind Klassifikationen, keine Textaufgaben. Dafür gibt es neben dem `LlmProvider` ein zweites Interface `ClassifierProvider` mit drei Fragetypen: **Choice** (eine Option aus einer Liste), **Score** (Stufe auf einer Skala) und **Bool** (Wahrscheinlichkeit, dass eine Aussage zutrifft). Jede Antwort enthält die Wahrscheinlichkeiten und eine Konfidenz.

Implementierungen:

- `typesafe`: **Jev** von TypeSafe AI über dessen eigene HTTP-API (`/v1/systemone`, offizielles JS-SDK). Jev ist ein „System One“-Modell: Es erzeugt keinen Text, sondern typisierte Entscheidungen mit kalibrierten Wahrscheinlichkeiten, und die Klassen werden beim Aufruf in natürlicher Sprache definiert, ohne Fine-Tuning. Die Bool-Fragen heißen dort `noul`.
- `llm`: bildet die drei Fragetypen über den `LlmProvider` mit zod-Schema nach. Das ist der Fallback und der Weg für den vollständig lokalen Modus.
- `mock` für Tests.
- ab Phase 7 optional `local-model` für ein eigenes, feingetuntes Modell (siehe 17).

Konfiguration pro Aufgabe (z. B. `DETECTOR_CLASSIFIER_PROVIDER`, `CHECKER_CLASSIFIER_PROVIDER`) und **pro Aufgabe konfigurierbare Konfidenzschwellen:** Bei hoher Konfidenz handelt das System automatisch, bei mittlerer wird das Ergebnis als „unsicher“ markiert, bei niedriger wird nicht geurteilt (`nicht_pruefbar`) bzw. die Behauptung verworfen.

| Aufgabe | Art | Standard | Fallback / lokal |
|---|---|---|---|
| Vorfilter gegen Smalltalk | deterministisch | Heuristik: Mindestlänge, Fragen, Grußformeln, reine Meinungsmarker („ich finde“) | — |
| Prüfwürdigkeit | Klassifikation | Bool „enthält eine überprüfbare Tatsachenbehauptung“ plus Score „Prüfwürdigkeit 1–5“ | LLM, ab Phase 7 eigenes Modell |
| Eigenständige Formulierung | Generierung | kleines LLM, nur für positive Fälle | lokales LLM |
| Thema | Klassifikation + Generierung | Choice unter den bisherigen Themen der Session plus „neues Thema“; Bezeichnung des neuen Themas per LLM | LLM |
| Suchanfragen | Generierung | kleines LLM | Heuristik aus Entitäten |
| Relevanz der Evidenz | Klassifikation | Vorauswahl per Embedding-Ähnlichkeit, dann Bool „Auszug ist relevant für die Behauptung“ für die Top-k | nur Embeddings |
| Evidenz ausreichend? | Klassifikation | Bool „die Auszüge reichen für ein Urteil“ | LLM |
| Urteil | Klassifikation | Choice über die fünf Urteile; State = Behauptung plus relevante Auszüge; zusätzlich Choice „welcher Auszug belegt das Urteil am stärksten“ | LLM |
| Gleiche Aussage? (Cache) | Klassifikation | Bool „beide Behauptungen haben denselben Wahrheitsgehalt“ (schützt vor Fehltreffern bei Negation oder anderen Zahlen) | LLM |
| Erklärung | Generierung | LLM, asynchron im `explainer` | lokales LLM |

**Einschränkungen von Jev, die das Design berücksichtigt:**

- Jev ist im Early Access mit Warteliste. Die Pipeline muss vollständig mit `llm` funktionieren; Jev ist eine Optimierung, keine Voraussetzung.
- Die Angaben zu Latenz (70–500 ms), Kosten und Kalibrierung sind Herstellerangaben aus Messungen an der US-Westküste. Aus Europa kommt Netzwerklatenz dazu. Wir messen selbst (13.5).
- Englisch ist die primäre Trainingssprache; Deutsch wird unterstützt, aber nicht gleich gut. Die deutsche Qualität muss das Eval-Set belegen.
- Jev verarbeitet nur Text (kein Audio) und hat ein Kontextbudget von 64.000 Tokens pro Anfrage.
- Jev erzeugt keine Erklärungen. Deshalb bleibt die Erklärung beim LLM.
- Gehostet in den USA, keine EU-Region; Datenschutzfolgen siehe 15.6.

## 9. Recherche, Evidenz-Speicher und Caching

Die Recherche ist unabhängig vom Modellanbieter; auch lokale Modelle ohne eingebaute Websuche funktionieren. Die gemeinsame Logik (Quellenabruf, Chunking, Embeddings, Retrieval) liegt in `packages/research` und wird von `fact-checker` und `topic-tracker` genutzt.

### 9.1 Quellen in Stufen

Offizielle APIs haben Vorrang vor dem Scraping von Webseiten, weil sie stabiler sind und nicht an Bot-Sperren scheitern:

1. **Bestehende Faktenchecks** über die Google Fact Check Tools API (ClaimReview-Einträge u. a. deutscher Faktenchecker). Ein Treffer ist die stärkste Evidenz und wird im UI als „bereits von … geprüft“ angezeigt.
2. **Strukturierte Referenzdaten** über die Wikidata- und die deutschsprachige Wikipedia-API, z. B. für Daten, Zahlen und Personen.
3. **Websuche** über den Adapter `SearchProvider` (`searxng` als lokaler Standard ohne Key, `brave` und `tavily` optional) mit anschließendem Seitenabruf.

Alle Stufen laufen parallel. Jede Quelle bekommt anhand ihrer Domain eine Stufe (`faktencheck`, `amtlich`, `referenz`, `presse`, `sonstige`). Die Zuordnung und die Gewichtung stehen als Daten in `config/source-tiers.yaml`, nicht im Code.

### 9.2 Chunking und Embeddings

- Der Haupttext abgerufener Seiten wird extrahiert (z. B. `@mozilla/readability` + `jsdom`) und in Abschnitte von ca. 300–500 Tokens mit Überlappung zerlegt. Jeder Chunk trägt Metadaten: URL, Herausgeber, Veröffentlichungs- und Abrufdatum, Quellenstufe.
- Embeddings kommen über den Adapter `EmbeddingProvider`: `openai-compatible` (Embedding-Endpunkt von LM Studio bzw. Ollama, lokaler Standard) oder ein Cloud-Anbieter. Das Modell muss mehrsprachig sein und Deutsch gut abdecken; die Wahl ist ein ADR.
- Im UI und in Events erscheinen nur kurze Auszüge, nie ganze Texte.

### 9.3 Evidenz-Speicher (ab Phase 4)

- Bis Phase 3 werden die Chunks pro Behauptung im Speicher gerankt und danach verworfen.
- Ab Phase 4 landen sie in Postgres mit pgvector. Die Alternativen Qdrant und die Vektorsuche von Redis bewertest du im ADR.
- Retrieval ist hybrid: Vektorsuche plus deutsche Volltextsuche von Postgres, die Ergebnisse werden zusammengeführt.
- Aktualität zählt: Zeitkritische Fakten (Amtsinhaber, Preise, aktuelle Zahlen) haben eine kurze Gültigkeit, historische Fakten eine lange. Die Klassifikation „zeitkritisch ja/nein“ übernimmt der Klassifikator.

### 9.4 Themen-Prefetch

Der `topic-tracker` erkennt aus dem Gesprächsfenster, worüber gerade gesprochen wird (z. B. „Zweiter Weltkrieg“), und stößt vorab die Recherche an: passende Wikipedia-Artikel, Faktenchecks zum Thema und die Top-Suchergebnisse werden abgerufen, gechunkt und indexiert. Kommt kurz danach eine Behauptung zum Thema, liegt die Evidenz schon bereit. Budgets pro Session (maximale Themenzahl, Seiten pro Thema) begrenzen Kosten und Last.

### 9.5 Caching statt vorgenerierter Fragen

Es werden **keine** möglichen Fragen und Antworten vorab generiert. Der Raum möglicher Behauptungen ist offen, die allermeisten vorab erzeugten Paare würden nie gebraucht, und eine vorab erzeugte Antwort wäre nicht gegen den tatsächlichen Wortlaut geprüft. Stattdessen gibt es drei Cache-Ebenen:

1. **Urteils-Cache:** exakt über den normalisierten Hash und semantisch über Embedding-Ähnlichkeit. Ein semantischer Treffer wird nur verwendet, wenn der Klassifikator bestätigt, dass beide Behauptungen denselben Wahrheitsgehalt haben. Sonst würde „Der Krieg endete 1945“ das Urteil für „Der Krieg endete 1955“ liefern.
2. **Evidenz-Speicher** aus Prefetch und früheren Prüfungen (9.3).
3. **Such- und Seiten-Cache** in Redis.

### 9.6 Ablauf pro Behauptung

1. **Urteils-Cache:** Bei einem Treffer wird das Urteil sofort ausgeliefert.
2. **Evidenz-Speicher:** hybrides Retrieval der Top-k, Relevanzprüfung, dann die Frage „reicht die Evidenz?“. Wenn ja, folgt das Urteil.
3. **Live-Recherche (Cache-Fehltreffer):** Suchanfragen erzeugen, die drei Quellenstufen parallel abfragen, Seiten abrufen, chunken, embedden, ranken, urteilen. Die neuen Chunks werden asynchron in den Evidenz-Speicher geschrieben, damit die nächste ähnliche Behauptung schneller ist.
4. **Urteil** per Klassifikator. Bei niedriger Konfidenz lautet das Ergebnis `nicht_pruefbar` oder „unsicher“. Optional, und nur innerhalb des Budgets, wird ein stärkeres LLM als zweite Instanz gefragt.
5. **Erklärung** asynchron durch den `explainer`.

Zielwerte für die Latenz ab Satzende: Cache-Treffer unter 1 Sekunde, Treffer im Evidenz-Speicher 1–3 Sekunden, Live-Recherche 5–10 Sekunden. Die tatsächlichen Werte pro Pfad werden gemessen (`timings` im Event, Dashboard in 14.5).

Weitere Regeln: Timeouts, maximale Seitenzahl und maximale Tokens pro Quelle sind konfigurierbar. Der Service setzt einen eigenen User-Agent und respektiert robots.txt; es gilt der SSRF-Schutz aus 15.5. Optional gibt es den Modus `CHECKER_RESEARCH_MODE=native`, der bei Anthropic das serverseitige Web-Search-Tool der Claude API nutzt. Standard ist `pipeline`.

## 10. Transkription

- Der Adapter `SttProvider` hat ein Streaming-Interface: Audio rein, Segmente mit Sprecher-Label raus.
- Cloud-Adapter gibt es für Deepgram und AssemblyAI. Prüfe bei beiden Streaming, Deutsch und Diarization und halte im ADR fest, welcher der Standard wird.
- Der lokale Adapter leitet an `stt-local` weiter. Dort arbeitet faster-whisper mit VAD-basierten Chunks, also als „Pseudo-Streaming“ mit etwas höherer Latenz. Die erste Version hat keine Diarization, alle Segmente bekommen `speaker: "A"`. Lokale Diarization (z. B. pyannote) ist ein späteres Thema.
- `stt-local` soll auch nativ auf dem Mac startbar sein, weil das schneller ist. Die URL ist per `LOCAL_STT_URL` konfigurierbar.
- Ein Mock-Adapter spielt eine WAV-Datei oder ein Skript mit vorgegebenen Segmenten ab.

## 11. Frontend (`web`)

- Mobile-first mit dem iPhone-Viewport als erstem Ziel, dazu PWA-Manifest und Icons (installierbar über „Zum Home-Bildschirm“).
- **Vor jeder Aufnahme erscheint ein Einwilligungsdialog.** Er weist darauf hin, dass alle Gesprächsteilnehmer informiert sein und zustimmen müssen (Vertraulichkeit des gesprochenen Wortes, DSGVO). Ohne Bestätigung startet keine Aufnahme.
- Es gibt einen Start/Stopp-Button, eine Anzeige für Verbindungs- und Aufnahmestatus und ein Live-Transkript mit Sprecher-Labels (interim grau, final schwarz).
- **Live-Transkript mit markierten Behauptungen:** Erkannte Behauptungen werden direkt im Transkript unterstrichen, zuerst grau („erkannt“), dann mit einer dezenten Animation („wird geprüft“), zuletzt in der Farbe des Urteils. Ein Tipp auf die Markierung springt zur zugehörigen Karte.
- **Zeitleiste** am oberen Rand: ein Punkt pro Behauptung in der Farbe des Urteils, damit der Verlauf des Gesprächs auf einen Blick sichtbar ist.
- **Karten-Feed**, die neueste oben. Jede Karte zeigt:
  - Urteil als Chip mit Icon und Text, Sprecher und Uhrzeit
  - die eigenständig formulierte Behauptung, die wörtliche Aussage aufklappbar
  - einen Konfidenzbalken; in der Detailansicht die Verteilung über alle Urteile
  - den stärksten Beleg als kurzes Zitat mit Herausgeber, Datum und Quellenstufe
  - Badges wie „bereits von … geprüft“ oder „aus früherer Prüfung“
  - die Erklärung, die nachträglich erscheint (vorher ein Platzhalter)
  - alle Quellen-Links
- **Ehrlichkeit vor Farbe:** Mittlere Konfidenz wird ausdrücklich als „unsicher“ angezeigt, nicht als Rot oder Grün. Jede Karte trägt den Hinweis, dass es sich um eine automatische Einschätzung handelt.
- **Keine Personenwertung:** Das UI zeigt keine „Lügen-Scores“ oder Ranglisten pro Person. Die Zusammenfassung am Ende einer Session listet Behauptungen und Urteile neutral und lässt sich als Markdown exportieren.
- Sprecher lassen sich umbenennen (A → „Marco“).
- Im Textmodus kann man eine Behauptung eintippen und prüfen lassen.
- Eine Einstellungsseite zeigt, welche Provider aktiv sind. Sie dient nur der Anzeige, die Konfiguration bleibt serverseitig.
- Der WebSocket-Client verbindet sich automatisch neu, mit Backoff.
- Barrierearm: Farbe ist nie das einzige Merkmal, jede Karte zeigt zusätzlich Icon und Text.

## 12. Lokale Entwicklung und Test auf dem iPhone

- `docker compose up` startet den Standard-Stack. Weitere Profile sind `local-stt` (lokale Transkription) und ab Phase 5 optional `observability`.
- **Auch die Entwicklung läuft in Containern.**
  - Der Dev-Modus nutzt `docker compose watch` (`develop.watch` in der Compose-Datei) mit Hot Reload. Quellcode-Änderungen werden in die laufenden Container synchronisiert, Änderungen an Abhängigkeiten lösen einen Rebuild aus.
  - Dev- und Runtime-Image entstehen aus demselben Dockerfile als unterschiedliche Stages (`dev` und `runtime`).
  - Tests, Lint und Evals laufen ebenfalls in Containern, Playwright im offiziellen Playwright-Image.
  - Für die IDE-Unterstützung (Typen, Autovervollständigung) gibt es eine Dev-Container-Konfiguration für VS Code (`.devcontainer/`).
  - Auf dem Host brauche ich nur Docker, Git, VS Code und Claude Code; Node und Python müssen nicht lokal installiert sein.
- Die einzige Ausnahme sind LM Studio, Ollama und optional `stt-local`. Sie dürfen nativ auf dem Mac laufen, weil sie die GPU brauchen (siehe Abschnitt 8).
- **Für das Mikrofon auf dem iPhone ist HTTPS Pflicht.** Safari erlaubt `getUserMedia` nur in einem Secure Context. `http://localhost` funktioniert am Mac, `http://192.168.x.x` vom iPhone aus dagegen nicht.
  - Deshalb terminiert `caddy` TLS mit interner CA, für `localhost` und für die LAN-IP bzw. einen `*.local`-Namen.
  - Die README erklärt, wie ich das Root-Zertifikat auf dem iPhone installiere und ihm vertraue.
  - Als Alternative wird ein Tunnel (z. B. cloudflared) dokumentiert.
- Ein `Makefile` bietet mindestens `up`, `up-local`, `dev`, `down`, `logs`, `lint`, `test-unit`, `test-integration` (Backend und Frontend), `test-api`, `test-e2e`, `test` (alle Stufen außer 5), `eval` und `scan`. Alle Ziele führen ihre Befehle in Containern aus.
- Die `.env.example` enthält alle **nicht-geheimen** Variablen mit sinnvollen Defaults und Kommentaren; `.env` steht in `.gitignore`. Secrets stehen nie in `.env`, sondern nur im Secret-Verzeichnis außerhalb des Repos (siehe 15.1).
- Zielplattform ist macOS mit Apple Silicon. Die Images müssen sich für `linux/arm64` bauen lassen, Multi-Arch wird vorbereitet.

## 13. Teststrategie (Shift-Left) und Qualität

### 13.1 Grundsätze

- **Shift-Left:** Fehler werden so früh und so billig wie möglich gefunden. Die meisten Tests liegen auf den unteren Stufen; sie sind schnell, deterministisch und laufen lokal wie in der CI. Weiter oben gibt es weniger Tests, dafür realistischere.
- **Testpyramide:** sehr viele Unit-Tests, viele Integrationstests, wenige System- und E2E-Tests. Neue Logik kommt mit Unit-Tests im selben Commit. Einen Bug reproduzierst du zuerst mit einem Test auf der niedrigsten Stufe, auf der er sichtbar wird, und behebst ihn danach.
- **Statische Prüfungen sind Stufe 0:** TypeScript strict, ESLint, Prettier und die Grenzprüfung aus 4.2; für Python (`stt-local`) ruff und mypy strict.
- **Backend und Frontend sind getrennt,** mit eigenen Test-Suites, eigenen CI-Jobs und paralleler Ausführung.
- **Mocks nur an Systemgrenzen:** im Backend LLM, STT und Websuche, im Frontend das Backend. Zwischen internen Modulen wird nicht gemockt. Tests prüfen Verhalten, nicht den Mock.
- **Deterministisch:** keine echten API-Keys, keine Zugriffe auf externe Netze, feste Zeit (Fake-Timer) und feste Seeds. Echte Anbieter werden nur in den Evals angesprochen (13.5).
- **Isoliert, damit parallel möglich:** Jeder Test nutzt eine eigene `sessionId` und pro Worker eigene Redis-Key-Präfixe bzw. Stream-Namen. Kein Test hängt von der Reihenfolge ab.
- **Keine versteckten Flaky-Tests:** Retries gibt es nur in der CI und höchstens einmal. Ein Flaky-Test wird als Issue erfasst, mit `@quarantine` markiert und ursächlich behoben, nicht mit Wartezeiten zugedeckt.

### 13.2 Teststufen

| Stufe | Backend | Frontend | Werkzeuge |
|---|---|---|---|
| **0 Statisch** | Typecheck, Lint, Grenzprüfung | Typecheck, Lint | tsc, ESLint, dependency-cruiser, ruff, mypy |
| **1 Unit** | Adapter, Deduplizierung, Prompt-Rendering, Schema-Validierung, Konfigurationsvalidierung, SSRF-Filter, Backoff-Logik | Stores (Zustand), Hooks, Formatierung der Urteile, WebSocket-Reconnect-Logik, Komponenten isoliert | Vitest, Testing Library, pytest |
| **2a Integration Backend** | Ein Service mit echten Abhängigkeiten per Testcontainers (Redis, ab Phase 4 Postgres). Contract-Tests für jedes veröffentlichte und konsumierte Event. API-Tests eines einzelnen Service über HTTP bzw. WebSocket mit `mock`-Providern | — | Vitest, Testcontainers, Fastify `inject` |
| **2b Integration Frontend** | — | Die komplette App im echten Browser gegen ein **gemocktes Backend**: REST per `page.route`, WebSocket per `page.routeWebSocket`, Mikrofon per Fake-Audio bzw. injiziertem MediaStream (siehe 13.6). Kein Login-Flow: Token und Laufzeitkonfiguration werden per Fixture injiziert. Dazu Accessibility-Prüfung mit axe | Playwright gegen `vite preview`, `@axe-core/playwright` |
| **3 System/API Backend** | Kompletter Backend-Stack per Compose mit `mock`-Providern. API- und WebSocket-Tests über das `gateway`: Behauptung rein, Urteil raus; dazu Fehlerfälle, Auth, Rate Limits, Größenlimits, SSRF-Abwehr | — | Playwright `APIRequestContext` |
| **4 E2E** | Frontend und Backend zusammen per Compose, weiterhin mit `mock`-Providern. Nur wenige kritische Nutzerwege: Textmodus, Live-Modus mit WAV-Fixture, Einwilligungsdialog, Reconnect nach Verbindungsabbruch | | Playwright |
| **5 Qualität und Nicht-funktional** | Evals der LLM-Qualität, Mutationstests, ab Phase 5 Lasttests | Lighthouse (Performance, PWA) | `pnpm eval`, Stryker, k6, Lighthouse CI |
| **Manuell** | — | Smoke-Test auf dem echten iPhone per Checkliste (13.6) | `docs/testing/iphone-smoke.md` |

Tests liegen neben dem Code, den sie prüfen (`*.test.ts` für Unit, `*.int.test.ts` für Integration). System- und E2E-Tests liegen unter `tests/api/` und `tests/e2e/`, Frontend-Integrationstests unter `apps/web/tests/`. Die Playwright-Tests nutzen Page Objects, Fixtures und stabile `data-testid`-Selektoren.

### 13.3 Wann welche Stufe läuft

| Auslöser | Ort | Stufen | Zeitbudget |
|---|---|---|---|
| **Jeder Commit** | lokal, lefthook `pre-commit` im laufenden Dev-Container | 0 und 1, nur für die betroffenen Pakete; dazu gitleaks | unter 30 Sekunden |
| **Jeder Push** (alle Branches) | CI | 0, 1, 2a und 2b für alle betroffenen Pakete | unter 10 Minuten |
| **Jeder PR auf `main`** | CI, Pflicht-Checks für den Merge | zusätzlich Image-Build, Trivy, SAST, Stufe 3 und Stufe 4 | unter 15 Minuten |
| **Nach dem Merge auf `main`** | CI | Stufe 3 und 4 noch einmal gegen die gebauten und gepushten Images (dieselben Images, die später deployt werden, Faktor V); ab Phase 5 Deployment per GitOps, ab Phase 6 E2E-Smoke gegen staging | unter 20 Minuten |
| **Nightly bzw. manuell** | CI | Stufe 5, vollständige Browser-Matrix, erneuter Image- und Dependency-Scan | — |

Die E2E-Tests laufen bewusst schon im PR und nicht erst nach dem Merge. Sonst würde ein Fehler erst entdeckt, wenn er bereits auf `main` liegt, und das widerspricht Shift-Left. Der zweite Lauf nach dem Merge prüft die tatsächlich ausgelieferten Images. Weil sich der lokale Pre-Commit mit `--no-verify` umgehen lässt, wiederholt die CI alle Stufen.

### 13.4 Parallelisierung und Laufzeit

- Backend- und Frontend-Jobs laufen parallel. Innerhalb davon gibt es eine Matrix pro betroffenem Paket bzw. Service (`pnpm --filter "...[origin/main]"` oder Turborepo).
- Vitest läuft mit parallelen Workern. Jeder Integrations-Job startet eigene Testcontainers.
- Playwright läuft mit `fullyParallel: true` und wird über mehrere CI-Jobs verteilt (`--shard=i/n`). Die Blob-Reports werden zu einem HTML-Report zusammengeführt und samt Traces als Artefakt abgelegt.
- Gecacht werden der pnpm-Store, Docker-Layer (Buildx mit GitHub-Actions-Cache) und die Playwright-Browser.
- **Fail fast:** Schnelle Stufen laufen zuerst, teure Jobs hängen per `needs` an ihnen. Veraltete Läufe desselben Branches werden per `concurrency` mit `cancel-in-progress` abgebrochen.
- Im PR werden Images nur für `linux/amd64` gebaut, um schneller zu testen. Multi-Arch (`amd64` und `arm64`) wird erst auf `main` gebaut.
- Überschreitet eine Stufe ihr Zeitbudget aus 13.3, wird die Optimierung als eigener Task eingeplant.
- Testergebnisse erscheinen als JUnit-Reports in den GitHub-Checks; Coverage wird pro Paket berichtet.

### 13.5 Qualitätstore, Coverage und Evals

- Coverage-Schwelle für Stufe 1 und 2 zusammen: 80 % Zeilen und Branches für `packages/*` und die Service-Logik. Die Schwelle darf nie sinken; steigt die Coverage, wird die Schwelle nachgezogen.
- Neue Logik ohne Tests meldet der `reviewer` als Befund.
- Mutationstests (Stryker) laufen nightly für `contracts`, `providers` und die Deduplizierung. Sie zeigen, ob die Tests wirklich etwas prüfen.
- **Evals** vergleichen die Provider-Setups (Jev, Claude, lokale Modelle) mit denselben Daten. Sie laufen manuell oder wöchentlich mit eigenen, budgetbegrenzten API-Keys, nie bei jedem Push. Es gibt zwei Eval-Sets, beide versioniert unter `evals/`:
  - **Erkennung** (`evals/detection.de.jsonl`, Ziel: mehrere hundert Segmente): Gesprächsausschnitte, gelabelt mit „enthält prüfwürdige Behauptung ja/nein“ und der erwarteten eigenständigen Formulierung. Gemessen werden Precision, Recall und F1. Precision ist für die Live-Nutzung besonders wichtig, weil Fehlalarme den Feed zumüllen.
  - **Urteil** (`evals/claims.de.jsonl`, Ziel: mindestens 200 Behauptungen): Behauptungen mit erwartetem Urteil. Gemessen werden die Trefferquote und die **Kalibrierung** (Brier-Score, Expected Calibration Error, Reliability-Diagramm), dazu Latenz p50/p95 pro Pfad (9.6) und Kosten pro Behauptung.
- **Datenquellen für die Eval-Sets:**
  - öffentliche Plenarprotokolle des Bundestags (deutsch, reich an Tatsachenbehauptungen, Meinungsäußerungen und Zwischenrufen)
  - veröffentlichte Faktenchecks mit ClaimReview-Bewertung als Referenz für Urteile
  - eigene Testgespräche, nur mit Einwilligung aller Beteiligten
  - Vorab-Labels darf ein LLM liefern; jedes Label wird von mir geprüft, bevor es ins Set kommt. Lizenz und Herkunft jeder Quelle stehen in `evals/SOURCES.md`.
- Das Eval-Ergebnis entscheidet, welcher Klassifikator Standard wird und ob Phase 7 (eigenes Modell) nötig ist.

### 13.6 Plattform: erst Web-App, iPhone über WebKit

- Wir bauen eine **PWA**, keine native App. Playwright testet in drei Projekten: Chromium Desktop, Chromium mit mobilem Viewport und **WebKit mit iPhone-Geräteprofil**. WebKit ist die Engine von Safari.
- Die Flags für Fake-Audio (`--use-fake-ui-for-media-stream`, `--use-fake-device-for-media-stream`, `--use-file-for-fake-audio-capture`) gibt es nur in Chromium. Der Live-Modus mit WAV-Fixture läuft deshalb in Chromium. In WebKit ersetzt ein Init-Script `getUserMedia` durch einen synthetischen MediaStream, der die Fixture über WebAudio abspielt.
- Playwrights WebKit ist nicht identisch mit Safari auf dem iPhone. Deshalb gibt es vor jedem Phasenabschluss ab Phase 2 einen kurzen manuellen Smoke-Test auf dem echten Gerät nach `docs/testing/iphone-smoke.md`: HTTPS-Zertifikat, Mikrofonfreigabe, Installation auf dem Home-Bildschirm, Verhalten bei Displaysperre und App-Wechsel.
- **Appium** kommt nur dazu, falls später per Capacitor eine native App entsteht (eigenes ADR). Dann testet Appium mit dem XCUITest-Treiber auf dem Mac bzw. einem macOS-Runner nur die nativen Aspekte, etwa Berechtigungsdialoge und App-Lebenszyklus. Die Web-Logik bleibt bei Playwright.

## 14. Kubernetes, CI/CD und GitOps

### 14.1 Kubernetes-Readiness (ab Phase 0)

Jeder Service erfüllt ab Phase 0 diese Punkte:

- Multi-Stage-Dockerfile mit kleinem Runtime-Image und Non-Root-User, ohne Build-Tools im Runtime-Image
- Konfiguration nur über Env, Secrets getrennt von normaler Konfiguration
- `/healthz`, `/readyz` und `/metrics`, Graceful Shutdown bei SIGTERM
- Logs als JSON auf stdout (pino) mit `sessionId` und `claimId` als Korrelations-IDs

### 14.2 Continuous Integration (ab Phase 0)

Die Pipeline läuft mit GitHub Actions unter `.github/workflows/`. Sie entsteht in Phase 0 und wächst mit jeder Phase mit, statt am Ende in einem Schritt gebaut zu werden.

Welche Teststufe wann läuft, legt Abschnitt 13.3 fest; die Parallelisierung beschreibt 13.4. Die Workflows sind danach geschnitten:

- **`ci.yml` bei jedem Push:** Stufe 0 (inklusive gitleaks), Unit- und Integrationstests getrennt für Backend (1, 2a) und Frontend (1, 2b), alle Jobs parallel.
- **`pr.yml` bei jedem PR auf `main`:**
  - Image-Build pro Service (im PR nur `linux/amd64`, mit Layer-Cache)
  - Trivy-Scan der Images; kritische Befunde brechen den Build ab
  - SAST (CodeQL, zusätzlich Semgrep) und Dockerfile-Lint (hadolint); ab Phase 5 auch die Prüfung der Kubernetes-Manifeste (kubeconform und kube-linter oder Checkov)
  - der Vertrags-Check aus 1.4
  - System-/API-Tests (Stufe 3) und E2E-Tests (Stufe 4), gesharded, gegen den per Compose gestarteten Stack
- **`main.yml` nach dem Merge:** Multi-Arch-Build (`linux/amd64` und `linux/arm64`), Push nach GHCR, Stufe 3 und 4 gegen die gepushten Images, ab Phase 5 Aktualisierung des Image-Tags im GitOps-Repo.
- **`nightly.yml`:** Stufe 5, vollständige Browser-Matrix, erneuter Scan; die Evals zusätzlich per `workflow_dispatch`.
- Doppelte Läufe desselben Commits (Push und PR) werden vermieden; wie genau, entscheidest du per ADR.

Alle Testläufe nutzen `mock`-Provider; die CI braucht also keine echten API-Keys.

Weitere Regeln:

- Nach dem Merge auf `main` werden die Images mit Git-SHA-Tag in die GitHub Container Registry (GHCR) gepusht. Ab Phase 6 werden sie signiert (cosign, keyless) und bekommen SBOM und Provenance-Attestation.
- `main` ist per Branch-Protection geschützt: Änderungen nur per PR, grüne Checks sind Pflicht.
- Jeder Workflow setzt minimale `permissions:`. Actions werden per Commit-SHA gepinnt. Secrets kommen nur aus GitHub-Secrets bzw. per OIDC.
- Ab Phase 1 hält Renovate oder Dependabot die Abhängigkeiten aktuell, auch Actions, Base-Images und Helm-Charts.
- Die README zeigt Status-Badges für die Pipeline.
- Optional kann die Claude-Code-GitHub-Action ein AI-Review als zusätzlichen Kommentar schreiben, nur für eigene PRs und nie als Pflicht-Check. Sie nutzt einen eigenen API-Key mit Budget-Limit, weil sie nicht gegen Prompt-Injection gehärtet ist.

### 14.3 Lokaler Cluster und GitOps (Phase 5)

- Der lokale Cluster läuft mit **k3d** (k3s in Docker): 1 Server und 2 Agents, reproduzierbar per Config-Datei (`make cluster-up`, `make cluster-down`), mit lokaler Registry für schnelle Iteration.
- `deploy/k8s/` nutzt Kustomize mit `base` und `overlays/local`, später `overlays/staging` und `overlays/prod`.
- Dazu kommen Deployments, Services, ConfigMaps und ein Ingress mit WebSocket-Unterstützung. k3s bringt Traefik mit; ob Traefik bleibt oder ingress-nginx kommt, entscheidest du per ADR.
- Pflicht in jedem Manifest: Resource Requests/Limits, Liveness/Readiness Probes, PodDisruptionBudgets und ein SecurityContext mit `runAsNonRoot`, `readOnlyRootFilesystem`, `capabilities.drop: [ALL]` und `seccompProfile: RuntimeDefault`. Die Namespaces erzwingen per Pod Security Admission das Profil `restricted`.
- NetworkPolicies nach dem Prinzip default deny; nur die benötigten Verbindungen werden erlaubt.
- Skalierung: HPA (CPU) für `gateway` und `web`. Für `claim-extractor`, `fact-checker`, `explainer` und `topic-tracker` KEDA-ScaledObjects auf die offenen Einträge der Redis-Streams, damit die Worker mit der Last hoch- und bis auf ein Minimum herunterskalieren.
- Die Strategie für Session-Affinität bzw. Fan-out der WebSockets im `gateway` ist dokumentiert und getestet.
- Ein ADR legt fest, wie Redis und Postgres im Cluster laufen (Operator, Helm-Chart oder einfaches StatefulSet für lokal).
- Secrets werden per Sealed Secrets oder SOPS verwaltet (siehe 15.1).
- **GitOps mit Argo CD:**
  - Argo CD läuft im Cluster und synchronisiert den gewünschten Zustand aus Git. Das Deployment ist pull-basiert; die Pipeline führt nie `kubectl apply` aus.
  - Nach erfolgreichem Build aktualisiert die CI nur das Image-Tag im passenden Overlay, per Commit oder PR.
  - Ob die Manifeste in diesem Repo oder in einem separaten Config-Repo liegen, entscheidest du per ADR. Meine Tendenz ist ein separates Repo `live-factcheck-gitops`, damit App- und Deployment-Historie getrennt bleiben.
  - Die Umgebungen werden per App-of-Apps oder ApplicationSet verwaltet.
- Ein kleines Lasttest-Skript (z. B. k6) simuliert mehrere Sessions. Dokumentiert wird, wie KEDA die Worker hoch- und wieder herunterfährt.

### 14.4 Echter Cluster mit k3s und Terraform (Phase 6)

- `infra/terraform/` provisioniert die VMs für einen k3s-Cluster (1 Control Plane, 2 Worker). Die Zielumgebung legt ein ADR fest: entweder meine lokalen Rocky-Linux-VMs oder günstige Cloud-VMs bei einem europäischen Anbieter.
- Der Terraform-State liegt nie im Repo, sondern in einem Remote-State mit Locking.
- Die k3s-Installation ist reproduzierbar, per cloud-init oder Ansible (ADR). Der Bootstrap installiert Argo CD, danach übernimmt GitOps alles Weitere.
- staging und prod laufen als eigene Namespaces oder Cluster (ADR). Die Promotion von staging nach prod erfolgt per PR mit manueller Freigabe.
- cert-manager stellt die TLS-Zertifikate aus.
- Postgres-Backups und k3s-Datastore-Snapshots sind eingerichtet; die Wiederherstellung wird einmal getestet und dokumentiert.
- `docs/runbooks/` enthält Runbooks für Deployment, Rollback, Key-Rotation und den Neuaufbau des Clusters.

### 14.5 Observability (Phase 5 lokal, Phase 6 im echten Cluster)

- Prometheus und Grafana (z. B. über kube-prometheus-stack) mit Dashboards für die Pipeline-Latenz (Segment bis Urteil), Queue-Länge, Fehlerquote und LLM-Kosten pro Stunde.
- Alerts für Fehlerquote, Queue-Stau und Budget-Überschreitung.
- Tracing mit OpenTelemetry über alle Services, korreliert über `sessionId` und `claimId`. Log-Aggregation mit Loki ist optional.
- Mindestens ein SLO, z. B. „95 % der Behauptungen sind innerhalb von 10 Sekunden bewertet“, sichtbar im Dashboard.

## 15. Sicherheit und Datenschutz

Sicherheit gehört ab Phase 0 zur Definition of Done und ist kein späteres Thema. Lege dazu `docs/SECURITY.md` mit einem kurzen Threat Model an: Was schützen wir, wer könnte angreifen, und was passiert, wenn ein Key leakt?

### 15.1 API-Keys und Secrets

- Secrets sind strikt von normaler Konfiguration getrennt. Dazu gehören die API-Keys für Anthropic, Deepgram/AssemblyAI und Brave/Tavily sowie das Gateway-Token und die Passwörter für Redis und Postgres.
- Ein Secret landet **niemals** in Git, einem Docker-Image oder einem Build-Argument. Genauso wenig gehört es ins Frontend-Bundle, in die `/config.json`, in Logs, Fehlermeldungen, Metriken oder Traces.
- **Least Privilege:** Jeder Service bekommt nur die Secrets, die er wirklich braucht. Nur `claim-extractor`, `fact-checker`, `explainer` und `topic-tracker` kennen LLM- bzw. Klassifikator-Keys, und jeder nur die, die er braucht (der `explainer` z. B. keinen Jev-Key); nur `transcription` kennt den STT-Key, und `web` kennt gar keine Secrets. Der Browser bzw. das iPhone sieht nie einen Key, weil Audio und alle Anfragen über das `gateway` laufen.
- Services lesen Secrets wahlweise aus einer Env-Variable oder aus einer Datei (Konvention `<NAME>_FILE`, z. B. `ANTHROPIC_API_KEY_FILE`). So funktionieren Docker-Compose-Secrets und später Kubernetes-Secrets als gemountete Dateien ohne Code-Änderung.
- **Lokal** liegen Secrets **außerhalb des Repo-Ordners**, standardmäßig unter `~/.config/live-factcheck/secrets/` (eine Datei pro Secret, Verzeichnis `700`, Dateien `600`). Compose bindet sie als Compose-Secrets über `${SECRETS_DIR}` ein. Damit liegen sie außerhalb des Workspace, in dem Claude Code und Antigravity arbeiten. Kein Agent liest sie beim normalen Durchsuchen des Projekts mit ein, und keiner kann sie committen. Vollständig ausschließen lässt sich ein Zugriff per Terminal-Befehl nicht; deshalb bestätige ich nie Agent-Befehle, die dieses Verzeichnis berühren, und in beiden Tools ist für Terminal-Befehle eine Freigabe eingestellt. `make secrets-init` legt das Verzeichnis mit den richtigen Rechten und leeren Platzhalterdateien an; die Werte trage ich selbst ein. Das README zeigt optional, wie ich sie aus dem macOS-Schlüsselbund oder einem Passwortmanager-CLI befülle, statt sie im Klartext abzulegen.
- Beim Start loggt jeder Service, *welche* Provider konfiguriert sind, aber nie die Keys selbst. Als zweite Absicherung schwärzt der Logger bekannte Secret-Felder (pino `redact`).
- **Kubernetes (Phase 5):** Kubernetes-Secrets sind nur Base64-kodiert, nicht verschlüsselt. Deshalb liegen sie nie als Klartext-YAML im Repo, sondern werden per Sealed Secrets oder SOPS verwaltet (Entscheidung als ADR). Wo möglich, werden sie als Dateien gemountet statt als Env-Variablen übergeben.
- `SECURITY.md` beschreibt die Key-Rotation und den Notfallablauf bei einem geleakten Key: widerrufen, neu erstellen, Nutzung und Logs prüfen.
- Übernimm diese Empfehlung ins README: Für dieses Projekt einen eigenen API-Key in einem eigenen Workspace der Claude Console anlegen, mit Ausgabenlimit. Dasselbe gilt für die STT- und Suchanbieter.

### 15.2 Secret-Scanning und Supply Chain

- gitleaks läuft als Pre-Commit-Hook über lefthook und in der CI.
- `make scan` prüft die Container-Images mit Trivy auf Schwachstellen und versehentlich eingebaute Secrets.
- Lockfiles werden committet, der Build nutzt `pnpm install --frozen-lockfile`. Ab Phase 1 übernimmt Renovate oder Dependabot die Updates.
- Ab Phase 6 wird pro Image eine SBOM erzeugt.

### 15.3 Container-Härtung

- Die Container laufen als Non-Root-User mit read-only Root-Dateisystem; beschreibbar sind nur explizite `tmpfs`-Pfade.
- Gesetzt sind außerdem `no-new-privileges` und `cap_drop: [ALL]`.
- Jeder Container hat Ressourcenlimits für CPU und Speicher, auch in Compose.
- Die Base-Images sind minimal. Im Runtime-Image gibt es möglichst keine Shell-Tools.

### 15.4 Netzwerk

- Nur `caddy` veröffentlicht Ports auf dem Host (443, ggf. 80 für den Redirect). Alle anderen Services haben keine Host-Ports; Redis, Postgres und SearXNG sind von außen nicht erreichbar.
- Es gibt getrennte Compose-Netzwerke: `edge` für `caddy`, `web` und `gateway`, `internal` für alles andere. Nur die Services, die ins Internet müssen, bekommen ausgehenden Zugriff. In Kubernetes wird das später über NetworkPolicies abgebildet.
- Redis läuft mit Passwort (ACL), Postgres mit einem eigenen, eingeschränkten DB-User.
- LM Studio und Ollama werden nur an `localhost` bzw. den Docker-Host gebunden und nicht ins LAN freigegeben.

### 15.5 Anwendungssicherheit

- Das `gateway` ist per Token aus der Konfiguration geschützt (Header bzw. WebSocket-Handshake), damit die App im LAN nicht offen ist. Tokens stehen nie in URLs, weil sie dort in Logs landen.
- Caddy setzt strikte CORS-Regeln, eine Content-Security-Policy und Security-Header.
- Nachrichten und Audioframes haben Größenlimits. Alle Payloads werden mit zod validiert.
- Rate Limiting, eine maximale Session-Dauer und ein Tages-Budget für Cloud-LLM- und STT-Aufrufe verhindern, dass ein Fehler oder Missbrauch eine hohe Rechnung erzeugt.
- **SSRF-Schutz im `fact-checker`:** Er ruft URLs aus Suchergebnissen ab, also Adressen, die Fremde bestimmen. Deshalb gilt:
  - Erlaubt sind nur `http` und `https`.
  - Die DNS-Auflösung wird geprüft. Private, Loopback-, Link-Local- und Metadaten-Adressbereiche sowie interne Hostnamen (`redis`, `postgres`, `host.docker.internal` usw.) sind blockiert, auch nach Redirects.
  - Jeder Abruf hat ein Größen- und Zeitlimit.
- **Prompt-Injection:** Webseiten können Anweisungen an das LLM enthalten. Abgerufene Inhalte werden deshalb klar als Daten markiert und abgegrenzt. Das LLM bekommt keine Tools mit Seiteneffekten, und jede Antwort muss das zod-Schema erfüllen. Quellen-URLs im Ergebnis müssen aus der tatsächlich abgerufenen Liste stammen, sonst wird das Ergebnis verworfen.

### 15.6 Datenschutz

- Vor jeder Aufnahme erscheint der Einwilligungsdialog (siehe Abschnitt 11).
- Audio wird standardmäßig **nicht** gespeichert. Transkripte werden nur gespeichert, wenn das aktiviert ist (Default `PERSIST_TRANSCRIPTS=false`), mit konfigurierbarer Aufbewahrungsdauer.
- Transkript-Inhalte werden nicht geloggt (Default `LOG_TRANSCRIPTS=false`).
- Die Einstellungsseite zeigt, welche Daten an welche externen Anbieter gehen. Im vollständig lokalen Modus (lokales LLM, `stt-local`, SearXNG, lokale Embeddings, Klassifikator `llm`) verlassen nur Suchanfragen und Seitenabrufe das eigene Netzwerk.
- **Jev:** Der Dienst läuft laut Anbieter in den USA ohne EU-Region. TypeSafe bietet einen Auftragsverarbeitungsvertrag mit EU-Standardvertragsklauseln, trainiert nach eigener Aussage nicht auf Kundendaten, bietet Zero Data Retention aber nur Enterprise-Kunden an. Deshalb gilt:
  - An Jev gehen nur die nötigen Textausschnitte, Sprechernamen werden durch Platzhalter (A, B, …) ersetzt.
  - Im Einwilligungsdialog werden alle aktiven externen Anbieter genannt.
  - Im lokalen Modus ist Jev deaktiviert.

## 16. Repo-Struktur (Vorschlag)

```
live-factcheck/
├─ apps/
│  └─ web/
├─ services/
│  ├─ gateway/
│  ├─ transcription/
│  ├─ stt-local/          # Python
│  ├─ claim-extractor/
│  ├─ fact-checker/
│  ├─ explainer/
│  └─ topic-tracker/      # ab Phase 4
├─ packages/
│  ├─ contracts/          # zod-Schemas, Event-Typen
│  ├─ providers/          # LLM-, Classifier-, Embedding-, STT-, Search-Adapter
│  ├─ research/           # Quellenabruf, Chunking, Retrieval, Caches
│  └─ service-kit/        # Logging, Health, Metrics, Redis-Streams-Helper, Shutdown
├─ deploy/
│  ├─ compose/            # Caddyfile, SearXNG-Config
│  ├─ k3d/                # Cluster-Config, ab Phase 5
│  └─ k8s/                # Kustomize base + overlays, ab Phase 5 (ggf. separates GitOps-Repo, siehe 14.3)
├─ infra/
│  └─ terraform/          # ab Phase 6
├─ load-tests/            # k6, ab Phase 5
├─ config/
│  └─ source-tiers.yaml   # Quellenstufen und Gewichtung
├─ ml/                    # nur falls Phase 7 nötig wird: Datensatz-Skripte, Training, Modell-Serving
├─ evals/
├─ tests/
│  ├─ api/                # Stufe 3: System-/API-Tests Backend
│  └─ e2e/                # Stufe 4: E2E (Frontend-Integrationstests liegen unter apps/web/tests/)
├─ .ai/
│  ├─ plans/              # ein Plan pro Phase, mit Tasks und Review-Gates
│  ├─ prompts/            # tool-neutrale Review- und Rollen-Prompts
│  ├─ research/           # verdichtete Recherche zu externen Abhängigkeiten
│  └─ summaries/          # Kurzbeschreibungen bestehender Codebereiche
├─ docs/
│  ├─ adr/                # bewusst hier statt unter .ai/, damit sie im Portfolio sichtbar sind
│  ├─ evidence/           # Nachweise pro Phase
│  ├─ ai-tooling.md       # Einrichtung von Claude Code und Antigravity
│  ├─ testing/            # u. a. iphone-smoke.md
│  ├─ runbooks/           # ab Phase 6
│  ├─ SECURITY.md
│  └─ PROJECT_BRIEF.md    # dieses Dokument
├─ .devcontainer/
├─ .github/workflows/     # CI ab Phase 0
├─ .claude/
│  ├─ agents/             # dünne Hüllen um .ai/prompts/
│  ├─ skills -> ../.agents/skills
│  └─ settings.json       # Agent-Hooks (Komfort, nicht die eigentliche Absicherung)
├─ .agents/
│  └─ skills/             # new-service, new-event-contract, adr, evidence
├─ tools/
│  └─ antigravity/        # mcp_config.example.json
├─ .mcp.json              # MCP-Server für Claude Code, ohne Tokens
├─ lefthook.yml           # Git-Hooks, gelten für jedes Tool
├─ CODEOWNERS
├─ docker-compose.yml
├─ Makefile
├─ .env.example
├─ .dockerignore
├─ AGENTS.md              # maßgebliche Root-Regeln; jeder Service und jedes Paket hat eine eigene
└─ CLAUDE.md              # bindet @AGENTS.md ein, plus Claude-Spezifika
```

## 17. Phasenplan

Jede Phase beginnt mit einer freigegebenen Plan-Datei (1.2). Sie endet mit grünen Tests, Nachweisen nach 1.3, aktualisierter README und `AGENTS.md`-Dateien, einer Anleitung zum lokalen Testen und einem offenen PR. Danach hältst du an, bis ich gemergt habe.

**Phase 0: Fundament**
Diese Phase legt das Grundgerüst an:

- Monorepo, `contracts` und `service-kit` mit Konfigurationsvalidierung beim Start, Secret-Laden per `_FILE`-Konvention und Log-Schwärzung
- alle Node-Services als lauffähige Skelette mit Health, Metrics und Shutdown
- Dockerfiles mit `dev`- und `runtime`-Stage, gehärtet nach 15.3
- `docker-compose.yml` mit Redis (mit Passwort), SearXNG und Caddy, getrennten Netzwerken und Compose-Secrets
- Dev-Modus mit `docker compose watch` und `.devcontainer/`
- `.env.example`, Makefile, gitleaks-Hook und `docs/SECURITY.md`
- Test-Setup für alle Stufen aus 13.2 mit je einem ersten Beispieltest, inklusive Playwright-Projekten für Chromium und WebKit (iPhone)
- Agent-Setup nach 1.1 und 1.4: `AGENTS.md`/`CLAUDE.md`, Prompts, Skills, Agent-Hooks, `.mcp.json`, Antigravity-Vorlage, `docs/ai-tooling.md`
- tool-unabhängige Absicherung: `lefthook.yml`, `CODEOWNERS`, Vertrags-Check in der CI, `make secrets-init`
- CI-Grundpipeline nach 14.2, Stufen 1–4, dazu Branch-Protection-Empfehlung in der README

*DoD:*
- `make up` startet alles, `https://localhost` zeigt die leere App, und alle `/readyz` sind grün.
- Außer Caddy veröffentlicht kein Container einen Host-Port.
- `make scan` meldet keine kritischen Befunde.
- Ein Test belegt, dass ein Service ohne Pflicht-Konfiguration mit klarer Fehlermeldung abbricht.
- Ein Test belegt, dass ein gesetzter API-Key in keiner Logzeile auftaucht.
- Der erste PR läuft grün durch die CI, und die README zeigt das Status-Badge.
- Der Pre-Commit-Hook bleibt unter 30 Sekunden, und die Push-Pipeline führt Backend- und Frontend-Jobs parallel aus.
- Im Repo-Ordner liegt kein Secret; ein Test bzw. Check belegt, dass die Services ihre Secrets aus `${SECRETS_DIR}` lesen.
- Eine Antigravity-Session kann mit „Lies `AGENTS.md` und den aktuellen Plan“ den nächsten Task benennen, ohne Rückfragen zu stellen.

**Phase 1: Faktencheck im Textmodus**
LLM-Adapter (`anthropic`, `openai-compatible`, `mock`), `ClassifierProvider` (`llm`, `mock` und `typesafe`, sobald ich Jev-Zugang habe), `EmbeddingProvider`, die drei Quellenstufen aus 9.1, Chunking und Ranking im Speicher, der `fact-checker` mit exaktem Urteils-Cache, der `explainer`, der Textmodus im Frontend und die Ergebnis-Karten nach Abschnitt 11. Dazu das Urteils-Eval-Set und `pnpm eval` mit Kalibrierungsmetriken. Dazu kommen Frontend-Integrationstests mit gemocktem Backend (2b), System-/API-Tests für den Textmodus (3), die Coverage-Schwellen aus 13.5 und Renovate bzw. Dependabot.
*DoD:* Eine eingetippte Behauptung wird mit Claude, mit LM Studio bzw. Ollama und (falls verfügbar) mit Jev als Klassifikator geprüft. Alle Varianten funktionieren, das Urteil erscheint vor der Erklärung, und ein Eval-Report vergleicht Trefferquote, Kalibrierung, Latenz und Kosten.

**Phase 2: Live-Transkription**
Audioaufnahme im Browser, WebSocket-Pfad, `transcription` mit einem Cloud-Adapter und dem lokalen Adapter (`stt-local`), `claim-extractor` mit Vorfilter, Klassifikator und eigenständiger Formulierung, das Erkennungs-Eval-Set, Live-Transkript mit markierten Behauptungen und Zeitleiste, Einwilligungsdialog und Test auf dem iPhone über HTTPS. Ab jetzt laufen die E2E-Tests mit WAV-Fixture in Chromium und mit synthetischem MediaStream in WebKit. Die iPhone-Smoke-Checkliste wird angelegt und einmal durchlaufen.
*DoD:* Ich spreche ins iPhone, sehe das Transkript live und bekomme für eine falsche Behauptung innerhalb weniger Sekunden eine Karte.

**Phase 3: Sprecher und UX**
Diarization über den Cloud-Adapter, Sprecher umbenennen, verfeinerte Deduplizierung, Latenz messen und optimieren, PWA-Feinschliff.

**Phase 4: Persistenz, Evidenz-Speicher und Prefetch**
Postgres mit pgvector (nach ADR), Sitzungsverlauf ansehen und löschen, Aufbewahrungsregeln, Export einer Sitzung als Markdown. Dazu der Evidenz-Speicher mit hybridem Retrieval (9.3), der semantische Urteils-Cache mit Bestätigung durch den Klassifikator (9.5) und der `topic-tracker` mit Prefetch (9.4).
*DoD:* In einem Testgespräch zu einem Thema treffen spätere Behauptungen messbar häufiger auf den Evidenz-Speicher oder den Cache, und die Latenz pro Pfad ist im Eval-Report und im Dashboard sichtbar.

**Phase 5: Kubernetes lokal und GitOps**
Umsetzung von 14.3 und 14.5 im lokalen k3d-Cluster, mit Argo CD, KEDA, NetworkPolicies, Pod Security und Monitoring. Die CI prüft zusätzlich die Manifeste.
*DoD:*
- Ein Merge auf `main` führt ohne manuellen Eingriff zu einem neuen Image in GHCR, und Argo CD rollt es im k3d-Cluster aus.
- Ein Rollback per Git-Revert ist demonstriert.
- Der Lasttest zeigt, wie KEDA die Worker hoch- und wieder herunterfährt, sichtbar im Grafana-Dashboard.

**Phase 6: Echter Cluster und Supply-Chain-Sicherheit**
Umsetzung von 14.4: VMs per Terraform, k3s, Argo CD-Bootstrap, staging und prod mit Freigabe, cert-manager, Backups und Runbooks. Dazu signierte Images mit SBOM und Provenance, Digest-Pinning der Base-Images sowie Alerts und SLO aus 14.5.
*DoD:*
- Der Cluster lässt sich per Terraform und GitOps von null aus reproduzierbar aufbauen; der Ablauf ist im Runbook dokumentiert.
- Eine Änderung durchläuft PR, CI, staging und nach Freigabe prod.
- Eine Backup-Wiederherstellung ist einmal getestet.

**Phase 7 (optional): eigenes Modell für die Behauptungserkennung**
Diese Phase findet nur statt, wenn die Evals es rechtfertigen: wenn die Erkennung auf deutschen Daten das F1-Ziel (Startwert 0,85, per ADR festgelegt) verfehlt, wenn Jev aus Europa zu langsam ist oder wenn der lokale Modus eine bessere Erkennung braucht.
- Für die reine Ja/Nein-Entscheidung wird zuerst ein kleines, mehrsprachiges Encoder-Modell als Klassifikator feingetunt. Das ist deutlich schneller und günstiger zu betreiben als ein LoRA-Fine-Tuning eines LLM. LoRA auf einem kleinen LLM ist die Alternative, falls auch die eigenständige Formulierung lokal besser werden muss (ADR).
- Der Datensatz wird aus den Quellen in 13.5 aufgebaut: mindestens einige tausend gelabelte Segmente, getrennt in Trainings-, Validierungs- und Testdaten. Das Eval-Set bleibt unangetastet.
- Das Training ist reproduzierbar im Container (`ml/`), mit Experiment-Tracking (z. B. MLflow) und versionierten Datensätzen.
- Das Modell wird als versioniertes Container-Image ausgeliefert (CPU, z. B. ONNX Runtime) und über den `ClassifierProvider` `local-model` angebunden.
- **Eval-Gate in der CI:** Ein neues Modell ersetzt das alte nur, wenn es auf dem Test-Set besser abschneidet. Vor der Umschaltung läuft es eine Weile im Shadow-Modus mit: Es klassifiziert parallel, und nur die Abweichungen werden protokolliert.

## 18. Deine erste Aufgabe

1. Lies dieses Dokument vollständig.
2. Stelle mir bis zu 5 Rückfragen zu wirklich offenen Punkten.
3. Lege dann `.ai/plans/phase-0-fundament.md` nach Abschnitt 1.2 an: Teilprojekte, Tasks mit Dateipfaden und Verifikationsbefehlen sowie Review-Gates. Schreib noch keinen Code.
4. Warte auf meine Freigabe des Plans. Danach arbeitest du auf dem Branch `phase-0-fundament` bis zum ersten Review-Gate.
