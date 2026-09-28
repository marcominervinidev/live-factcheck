# Phase 1b: Security-Tooling – Plan

> Grundlage: Wunsch von Marco vom 2026-09-27 (SonarQube/SonarLint, LLM-Sicherheitsscanner mit Qwen/DeepSeek, Angriffe auf die App), `docs/PROJECT_BRIEF.md` 13 und 15, `docs/SECURITY.md`, ADR 0005 (CI-Layout).
> Zeitpunkt: **nach Gate 8 von Phase 1** (PR #16 gemergt), **vor Phase 2**. Phase 2 bringt Mikrofon, Audio-Upload und Live-Transkription als neue Angriffsfläche; die Werkzeuge sollen dann schon laufen.
> Branch: `phase-1b/security-tooling`, PRs direkt gegen `main` (nicht gestapelt).

## Context

Heute laufen bereits: ESLint strict, Semgrep, CodeQL, Trivy, gitleaks, dependency-cruiser, Coverage 80/80, Stryker, dazu Reviews durch `reviewer`/`security-reviewer`. Das Phase-1-Review hat gezeigt, dass das wirkt, aber auch Lücken: Die Umgehung der Token-Prüfung (`/%61pi/…`) haben weder Semgrep noch CodeQL gefunden, sondern erst ein Agent-Review. Phase 1b ergänzt deshalb nur, was **etwas anderes** findet oder sichtbar macht:

| Werkzeug | Was es Neues bringt | Rolle in der Pipeline |
|---|---|---|
| **SonarQube Cloud** (kostenlos für öffentliche Repos) | Quality Gate auf neuem Code, Code Smells, Duplikate, kognitive Komplexität, Security Hotspots, Coverage-Verlauf; Dashboard fürs Portfolio | CI-Job in `ci.yml`, erst beratend, nach einer Woche Baseline Pflicht-Check |
| **SonarQube for IDE** (früher SonarLint) | dieselben Regeln beim Tippen, im Connected Mode mit dem Cloud-Projekt | VS Code und Antigravity (beide VS-Code-basiert) |
| **SonarQube-MCP-Server** | Claude Code und Antigravity können offene Befunde abfragen, bevor sie einen PR öffnen | `.mcp.json` + `.agents/mcp_config.json` (Parität wird in CI geprüft) |
| **OWASP ZAP (Baseline)** | DAST gegen den laufenden Stack: Header, Cookies, Info-Leaks, Pfad-Tricks | Job in `stack-tests.yml` gegen den Test-Stack, Regeldatei für bewusste Ausnahmen |
| **promptfoo Red Team** | gezielte Angriffe auf die LLM-Pipeline: Prompt Injection über präparierte Quellen, Manipulation von Klassifikator und Erklärung, fremde Links, Datenabfluss (OWASP LLM Top 10) | `make redteam` lokal; Angreifer-Modell Qwen/DeepSeek über LM Studio; Ergebnis als Evidence |
| **LLM-Code-Scanner** (Qwen3-Coder / DeepSeek-Coder lokal) | zweite Meinung zu Sicherheitsschwachstellen im Diff | `make llm-scan` lokal, SARIF-Report, **nie** blockierend (nicht deterministisch, viele Fehlalarme) |

**Bewusst nicht:**
- selbst gehostete SonarQube Community Build (2–4 GB RAM plus Postgres, keine PR-/Branch-Analyse). Kandidat als Plattform-Demo in Phase 5 (Kubernetes).
- DeepSeek- oder Qwen-Cloud-APIs: Code und Prompts gingen an einen Anbieter außerhalb der EU; lokal über LM Studio/Ollama reicht.
- Angriffe auf irgendetwas außer dem eigenen, isolierten Stack (`lfc-verify`, Wegwerf-Secrets, keine echten Keys).

## Geklärte bzw. zu klärende Entscheidungen

| # | Frage | Vorschlag | Status |
|---|---|---|---|
| 1 | SonarQube Cloud oder selbst gehostet | Cloud, Organisation = GitHub-Account `marcominervinidev` | offen (Marco) |
| 2 | Quality Gate sofort Pflicht? | erst beratend, nach einer Woche Baseline als Pflicht-Check `sonar passed` im Ruleset | offen (Marco) |
| 3 | Modelle für Red Team und Code-Scan | Mac M2 mit 16 GB, davon 8 GB für Docker: **Qwen2.5-Coder-7B-Instruct Q4_K_M** (~4,7 GB) für Angreifer und Code-Scan; Qwen3-8B als Alternative. 30B-Modelle passen nicht. promptfoo ergänzt feste Angriffsmuster, die nicht vom Modell abhängen | entschieden (2026-09-27, RAM-Angabe von Marco) |
| 4 | Red Team in CI? | nein, lokal (GitHub-Runner können die Modelle nicht laden); nightly nur der deterministische Teil mit Mock-Providern | Vorschlag |

## TP1 – Entscheidung und Dokumentation

- ADR `00NN-security-scanning-stack.md`: Werkzeuge, Rollen (blockierend vs. beratend), Grenzen, Kosten, Datenschutz der LLM-Scanner
- Brief: 13 (neue Stufe „Security-Scans“ neben Stufe 5), 14.2 (Jobs), 15 (Red Team, DAST), 17 (Phase 1b)
- `docs/SECURITY.md`: Abschnitt „Scanning und Angriffe“, dazu der Hinweis, dass der private Schlüssel der lokalen CA den Caddy-Container nie verlässt (Security-Review Phase 1)
- `AGENTS.md`: Agenten dürfen Befunde nie selbst als *won't fix*, *false positive* oder *safe* markieren oder Regeln abschalten; `nosemgrep`/Ausnahmen nur mit Begründung im Code und Nennung im PR
- `docs/ai-tooling.md`: Einrichtung SonarQube for IDE und MCP in beiden Tools

**🛑 Gate 1** (nur Dokumente)

## TP2 – SonarQube Cloud, IDE, MCP

- **Marco, vorher:** Account auf sonarcloud.io per GitHub-Login, Organisation importieren, Projekt `live-factcheck` anlegen, automatische Analyse **aus** (wir analysieren in CI), Token als GitHub-Secret `SONAR_TOKEN`. *(Claude erinnert daran zu Beginn von TP2.)*
- `sonar-project.properties`: Quellen/Tests je Workspace, Ausschlüsse wie bei Coverage, `sonar.javascript.lcov.reportPaths` (Vitest bekommt den Reporter `lcov`)
- `ci.yml`: Job `sonar` nach den Test-Jobs, Coverage-Artefakte einsammeln, `SonarSource/sonarqube-scan-action` per SHA gepinnt, PR-Dekoration
- SonarQube for IDE: `.vscode/extensions.json` empfiehlt die Erweiterung; Connected Mode in `.vscode/settings.json` (ohne Token)
- MCP: offizieller SonarQube-MCP-Server als Container (Image per Digest), Token per `${SONAR_TOKEN}` aus der Umgebung, in beiden MCP-Configs
- Verifikation: erster Scan auf `main`, PR mit absichtlichem Code Smell zeigt Dekoration, `/mcp` listet `sonarqube`

## TP3 – DAST mit OWASP ZAP

- `zaproxy/zap-stable` (per Digest) als Service im Test-Overlay, Baseline-Scan gegen `https://lfc.local:8443` (App und `/api/*` mit Token-Header), Regeldatei `tests/security/zap-rules.tsv` mit begründeten Ausnahmen
- `stack-tests.yml`: Job-Schritt nach Stufe 4, HTML-Report als Artefakt, im PR-Kommentar verlinkt (wie die Playwright-Reports)
- Regressionstest: die Pfad-Umgehung aus dem Phase-1-Review (`/%61pi/status`) als fester Fall

## TP4 – LLM-Red-Team mit promptfoo

- `tests/redteam/` (eigenes Workspace-Paket, promptfoo gepinnt), Ziel: die echte Pipeline über `POST /api/claims/check` + WebSocket im isolierten Stack
- Angriffe:
  - präparierte Seiten im Mock-Korpus („Ignoriere alle Regeln …“, versteckte Links, gefälschte Faktenchecks)
  - Behauptungen, die das Urteil kippen sollen
  - Erklärungen mit fremden Links
  - Versuche, Keys oder den System-Prompt herauszulocken
- Erwartung: Urteil bleibt beim Belegstand, keine fremde Quelle, keine fremden Links (Brief 15.5), `nicht_pruefbar` statt Raten
- Angreifer-Modell: Qwen/DeepSeek über `http://host.docker.internal:1234/v1`; `make redteam`; Report als Evidence
- Deterministischer Teil (feste Injection-Fälle, Mock-Provider) zusätzlich als Stufe-3-Tests in CI
- **Rhythmus (Marco, 2026-09-28):** der volle Lauf mit echtem Modell zum Ende jeder Phase (vor dem letzten Gate) und außer der Reihe bei Änderungen an Prompts, Modellwahl, Klassifikator, Recherche/Quellen oder Erklärung (z. B. Phase 2: gesprochene Sprache als neuer Eingabeweg); nicht bei jeder kleinen Etappe. Jeder PR prüft nur den deterministischen Teil.

## TP5 – LLM-Code-Scanner

- `scripts/llm-scan/`: Diff gegen `main` in Häppchen, Prompt mit OWASP-/CWE-Checkliste und Projektregeln, Ausgabe als SARIF 2.1.0; Modell über dieselbe OpenAI-kompatible Schnittstelle wie der `openai-compatible`-Provider
- `make llm-scan` lokal; Upload nach GitHub Code Scanning nur auf Wunsch (`gh api …/code-scanning/sarifs`), Kategorie `llm-scan`, nie blockierend
- Vergleich im Evidence-Dokument: Was findet der LLM-Scan, was Semgrep/CodeQL/Sonar nicht (und umgekehrt), Fehlalarmquote

## TP6 – Skill, Reviews, PR

- **Vor dem Gate (Claude erinnert Marco):** Red-Team-Vergleichslauf mit **Claude Opus 5 als Prüf-Modell** und Haiku 4.5 als Erklärer (Produktiv-Konfiguration), Kostenschätzung ca. 0,60–1,20 $ für 13 Fälle. Marco trägt vorher den Anthropic-Key in `anthropic_api_key` ein. Ziel: klären, ob Befund F1 (gefälschtes JSON im Behauptungstext kippt das Urteil, siehe `docs/evidence/phase-1b/tp4-redteam.txt`) am 7B-Modell liegt; danach über eine Gegenmaßnahme entscheiden.

- Skill `.agents/skills/security-scan/` für beide Tools: wann welcher Scan, wie Befunde triagiert werden, was nie erlaubt ist
- Reviews (`reviewer`, `security-reviewer`), Evidence `docs/evidence/phase-1b/`, PR

**🛑 Gate 6**

## Was Marco tun muss (und wann)

| Wann | Was |
|---|---|
| Freigabe dieses Plans | Entscheidungen 1–4 oben |
| Beginn TP2 (Claude erinnert) | SonarQube-Cloud-Account und Projekt, Secret `SONAR_TOKEN` |
| Beginn TP4 (Claude erinnert) | Qwen2.5-Coder-7B-Instruct (Q4_K_M) in LM Studio laden, Server auf `localhost:1234` starten; Ziel-Modell der Pipeline wählen (lokal kostenlos oder Claude Haiku nach Kostenschätzung) |

## Status

- [x] Plan freigegeben (Marco, 2026-09-27); Entscheidungen 1–4 wie vorgeschlagen, sofern Marco nichts anderes sagt
- [x] TP1 ADR 0014 und Dokumentation (PR #20, gemergt)
- [x] TP2 SonarQube Cloud (PR #22, offen): erster Scan `ANALYSIS SUCCESSFUL`, Quality Gate OK
- [x] TP3 OWASP ZAP (PR #21, gemergt): FAIL 0 / WARN 0 / PASS 64
- [x] TP4 Red-Team (PR #23, offen): Qwen 7B 12/13 abgewehrt, Befund F1 offen (in `docs/SECURITY.md` als bekanntes Risiko)
- [x] TP5 lokaler LLM-Code-Scanner (PR #23): 11 Funde, alle als Fehlalarm eingeschätzt; Vergleich Semgrep/CodeQL im Nachweis
- [x] TP6 Skill `security-scan` (PR #24, offen; nach #23 mergen)
- [x] Review-Befunde PR #23 erledigt: frische Läufe, isolierter Container, robuster Client, llm-scan nur lokal, Diff-Parser, Doku (README, `tests/AGENTS.md`, ADR-0014-Nachtrag, SECURITY.md), depcruise für `scripts/llm-scan`, Semgrep-Fund `node_secret` eng unterdrückt (Marco entscheidet)
- Offen, für Marco:
  - CodeQL `js/file-access-to-http` #7–#11 (Token aus der Secret-Datei als Auth-Header) wegklicken oder anders entscheiden
  - `SONAR_TOKEN` aus `~/.zprofile` entfernen (Security-Review-Befund 1), danach Doku/Skill anpassen
  - **Abhängigkeiten in den Images:** seit promptfoo im Lockfile ist, bekommen fact-checker, claim-extractor und explainer über die optionalen Peers von `openai@7` rund 75 ungenutzte AWS-SDK-/smithy-Pakete. `dedupePeerDependents: false`, `autoInstallPeers: false` und Overrides mit `-` helfen unter pnpm 12 nicht. Vorschlag: `tests/redteam` aus dem pnpm-Workspace nehmen (eigenes Lockfile, eigenes Install im Red-Team-Container), braucht Marcos OK
- Offen in PR #22: Sonar-PR-Erkennung über `.head.ref`, `sonar.tests` inkl. `scripts`, Widerspruch in `docs/ai-tooling.md`, `.vscode/settings.json`, TP2-Nachweis; PR #24: Semgrep-Version 1.178.0 im Skill
- Nächster Task: Reste PR #22/#24, dann **Opus-5-Red-Team-Lauf (Marco erinnern, Key, ca. 0,60–1,20 $)**, dann Gate 6

### 2026-09-28T11:53Z – compaction (auto)

- branch: `phase-1b/tp4-redteam`, HEAD `38259a2`
- uncommitted:

```
 M .ai/plans/phase-1b-security-tooling.md
 M scripts/llm-scan/src/diff.ts
 M scripts/llm-scan/src/run.ts
 M scripts/llm-scan/src/sarif.ts
```
