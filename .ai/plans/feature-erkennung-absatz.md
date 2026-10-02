# Feature: Erkennung im Gespräch – Plan

> Nach Grilling-Runde 1 (Marco, 2026-10-02) und Marcos Änderungen am selben Tag. Auslöser:
> Live-Test am 2026-10-01 mit einer Talkshow – 131 s, 25 Segmente, **0 Behauptungen** erkannt.
> Reihenfolge danach: #76 Kosten-Monitoring, T7.5 Red-Team, Phase 3.

## Context

- Die Erkennung (ADR 0017) prüft Segment für Segment: Vorfilter → Klassifikator Jev (Fenster von
  6 Segmenten als Kontext) → eigenständige Formulierung (LLM) → Deduplizierung →
  `claims.detected`. Auf Bundestagsreden misst sie F1 0,779 bei p50 0,3 s (T5.6, Jev@0,6).
- Im Gespräch zerfällt Sprache in Fetzen. Verluste im Live-Test laut Drop-Zählern: 8 × zu kurz
  (unter 5 Wörtern), 8 × unsicher (Behauptung, aber Konfidenz unter der Schwelle), 8 × keine
  Behauptung, 1 × wenig prüfwürdig.
- Das Eval-Set `evals/detection.de.jsonl` enthält nur Bundestagsreden (161 Segmente) und sieht
  diesen Fall nicht.
- Der Vorfilter verwirft mehr als gewollt (deterministisch nachgezählt, ohne Modell): Im Eval-Set
  verliert er eine echte Behauptung („Was uns ebenfalls empört, …“, Fragewort am Anfang). Im
  Gespräch kommen Muster dazu, die Bundestagsreden kaum haben. Alle vier Sätze verwirft er heute,
  bevor der Klassifikator sie sieht:
  - „Also die Mieten in Berlin sind explodiert.“ (Füllwort am Anfang, keine Zahl)
  - „Nein, die Regierung hat das Gesetz nie beschlossen.“ (ebenso)
  - „Wer hat denn die Mieten verdoppelt?“ (rhetorische Frage)
  - „Ich finde es absurd, dass Berlin eine kostenlose Kita hat.“ (Meinungsmarker – genau das
    Beispiel, das der Klassifikator-Prompt seit PR #84 als Behauptung zählt)
- Research: Zero-Shot-NLI verworfen (beste F1 0,56), externe Datensätze bewertet →
  `.ai/research/claim-detection-zero-shot.md`. Die Absatz-Idee entspricht Microsofts Claimify
  (ACL 2025). Verwandt: #79 (Erkennung nachschärfen), #82 (Audio-Eval-Bank).

## Geklärte Entscheidungen (Marco, 2026-10-02)

1. **Fragen bleiben in der Prüfung** (Q3): Rhetorische Fragen und Einleitungen wie „Was uns
   empört, ist …“ gehen an den Klassifikator. Füllwort-Anfänge („Also …“, „Nein, …“) und
   Meinungsmarker („Ich finde …“) verwirft der Vorfilter weiter.
2. **Erst messen, mit echten Aufnahmen** (Q1 a, am selben Tag geändert): Vor jeder Änderung am
   Pfad kommen rund 100 Gesprächssegmente ins Erkennungs-Set, aus echten Aufnahmen echter Menschen
   (Talkshows, Diskussionen, Debatten) und aus Protokollen. Nichts wird eingesprochen.
   Urheberrechtlich geschützte Mitschnitte misst der Agent nur lokal, sie kommen nicht ins Repo.
   Labels schlägt der Agent vor, Marco nimmt sie ab. Die Audio-Eval-Bank #82 folgt danach.
3. **Testszenarien nah an der Realität, keine synthetischen Stimmen** (gilt für alle Tests und
   Messungen): verschiedene Stimmen – Alter, Männer, Frauen, wo möglich Kinder. Die Regel steht
   in `evals/README.md` und `tests/AGENTS.md`.
4. **Hybrid** (Q2 b): Der schnelle Satz-Pfad bleibt für klare Fälle. Am Ende eines Redebeitrags
   liest ein Absatz-Pfad den ganzen Absatz und holt nach, was als „zu kurz“ oder „unsicher“
   hängen blieb.
5. **Kein eigenes Modell jetzt** (Q4): Erst messen, ob E1–E3 reichen. Bleibt die Erkennung danach
   unter F1 0,85, wird Phase 7 (eigenes Modell, Trainingsdaten mit Lizenzprüfung) eine eigene
   Entscheidung.
6. **Reihenfolge** (Q5): Vorfilter → Gesprächs-Eval → Absatz-Pfad, danach #76, T7.5, Phase 3.
   Schritte, bei denen nichts zu tun ist, entfallen.
7. **Label-Regel für verteilte Behauptungen:** Eine über mehrere Fetzen verteilte Behauptung
   zählt auf dem Segment, mit dem sie vollständig wird (Regel 4 in `evals/README.md`, „Kontext
   entscheidet“).

## Aufgaben

**E1 – Vorfilter: Fragen gehen an den Klassifikator** · Risiko: **niedrig** (revertibel, nur
`claim-extractor`, kein Vertrag) · Typ: implement

- Umgesetzt in **PR #92**: Eine Frage ist kein Grund mehr zum Verwerfen, weder mit Fragewort am
  Anfang („Was uns empört, ist …“) noch mit „?“ („Wer hat denn die Mieten verdoppelt?“). Der
  Klassifikator unterscheidet rhetorische und echte Fragen (Prompt nach ADR 0017); die Regel
  „verneinte Frage geht durch“ (2026-09-30) geht darin auf.
- Unverändert (Entscheidung 1): Fetzen unter 5 Wörtern (`too_short`, E3 holt sie nach),
  Füllwort-Anfänge und Meinungsmarker ohne Zahl – auch vor einer Frage („Also wer hat denn …?“
  wird verworfen; offene Frage an Marco in #92). E2 zählt mit, wie viele echte Behauptungen diese
  Regeln im Gespräch verwerfen; die Zahlen gehen an Marco.
- Kosten: ein Klassifikator-Aufruf mehr je Frage (Jev 0,042 $ pro 1 Mio. Input-Tokens, der
  `llm`-Klassifikator zum Preis des Extractor-Modells); wird eine Frage zur Behauptung, kommen
  Formulierung und Faktencheck dazu. Auf dem Eval-Set bewegt sich F1 je nach Urteil zwischen −3,2
  und +1,3 Punkten; die E2-Baseline misst es.
- Unit-Tests: „Was uns empört, ist …“, rhetorische und echte Fragen erreichen den Klassifikator.
  Nachweis: Zählung über das Eval-Set vorher/nachher mit dem echten Code (kostenlos); die Wirkung
  auf die Präzision misst der Baseline-Lauf in E2.
- Datierter Nachtrag in ADR 0017 (Umfang des Vorfilters).

**E2 – Gesprächs-Eval mit echten Aufnahmen und Baseline** · Risiko: **niedrig** (nur
Eval-Daten, revertibel; die Labels tragen jede spätere Entscheidung, daher nimmt Marco jedes ab) ·
Typ: research → implement

- Research erledigt (2026-10-02) → `.ai/research/conversation-audio-sources.md`. Vorgeschlagene
  Mischung für das Repo-Set:
  - Bundestag: Regierungsbefragung und Fragestunde. Die ersten 73 Segmente aus Protokoll 21/95
    liegen zur Abnahme in **PR #93** (mit Eval-Bericht je Quelle).
  - Etwa 15 Segmente aus Landtagsprotokollen (Baden-Württemberg, Bayern, Berlin; amtliche Werke
    mit Zurufen und Zusatzfragen).
  - Etwa 30 Segmente aus Podien und Debatten unter CC BY oder BY-SA (Wikimedia Commons,
    media.ccc.de).
  - Etwa 15 Segmente aus Interviews als realistische Gegenbeispiele.
  - Etwa 10 Segmente von Jugendlichen, nur als Text („Jugend und Parlament“).
  - Pro Quelle Ausgewogenheit prüfen (politische Lager, Männer und Frauen).
- Ins Repo (Set plus Zeile in `evals/SOURCES.md`) kommt nur, was die Lizenz erlaubt. Talkshows misst
  der Agent nur lokal: Audio und Transkript liegen in `evals/local/` (per `.gitignore`
  ausgeschlossen, ebenso `tests/fixtures/audio/local-*`), werden nach der Messung gelöscht, und ins
  Repo kommen nur Zahlen. Laut Research:
  - ZDF und phoenix haben keinen TDM-Vorbehalt (§ 44b UrhG).
  - Die ARD hat Text und Data Mining in der robots.txt vorbehalten, ARD-Sendungen gehen deshalb
    nur per Live-Wiedergabe in die App.
  - YouTube nie: Die Nutzungsbedingungen verbieten den Download, und laut OLG Hamburg (2024) ist
    die Verschlüsselung ein wirksamer Kopierschutz.
  - Den Weg entscheidet Marco (Grilling-Runde 2).
- Die Aufnahmen laufen durch die Spracherkennung des Live-Tests (gleicher Anbieter, gleiches
  Finalisierungs-Fenster); die echten Fetzen gehen als Text ins Set, Zwischenrufe als eigene
  Sprecher. Die Kosten der Spracherkennung schätzt der Agent vorher.
- Labels: Vorschlag vom Agent (`reviewed: false`), Abnahme durch Marco (etwa 30 min), mit der
  Label-Regel aus Entscheidung 7.
- Eval-Bericht getrennt nach Quelle (Bundestag / Gespräch; lokal gemessene Talkshows nur als
  Zahlen), damit ein Gewinn im Gespräch keinen Verlust im Bundestag verdeckt. Dazu die
  Vorfilter-Zählung für die Gesprächssegmente (Entscheidung 1).
- Baseline: bezahlter Lauf Jev@0,6 mit E1 über das ganze Set (Kostenschätzung vorher, Start nur
  nach Marcos OK).
- `tests/fixtures/audio/conversation.de.wav` (synthetisch, macOS-Stimmen) wird durch einen frei
  lizenzierten echten Ausschnitt ersetzt (Entscheidung 3).
- Minderjährige: Frei lizenzierte deutsche Gespräche mit Kindern unter etwa 12 Jahren gibt es laut
  Research nicht. Kinderstimmen sind außerdem besonders schutzwürdig (DSGVO, Erwägungsgrund 38).
  Vorschlag: Jugendliche nur als Text und kein Audio von Minderjährigen im Repo. Das entscheidet
  Marco (Grilling-Runde 2).

**Gate E1** – Marco: Labels abgenommen, Baseline gesehen. Danach E3.

**E3 – Prototyp Absatz-Pfad, zwei Varianten gemessen** · Risiko: **mittel** (neuer LLM-Aufruf
kostet Geld, neuer Zustand im Extractor; revertibel per Konfiguration, kein Vertrag) · Typ:
prototype (Marco wählt nach Zahlen)

- Redebeitrag = Segmente eines Sprechers bis Sprecherwechsel, Pause ab etwa 2 s (aus
  `startMs`/`endMs`), höchstens etwa 20 s oder Aufnahme-Ende. Ohne Sprechertrennung (heute
  `stt-local`, Diarization ist Phase 3) zählen nur Pause, Höchstdauer und Ende.
- Der Absatz-Pfad läuft nur, wenn im Redebeitrag ein Segment als `too_short` oder `uncertain`
  hängen blieb.
- **Variante A „Zusammenfügen“:** Die hängen gebliebenen Fetzen werden mit ihren Nachbarn zu
  ganzen Sätzen verbunden und laufen noch einmal durch den bestehenden Pfad. Wenig neuer Code,
  kaum Kosten.
- **Variante B „Extraktion“:** Ein LLM liest den ganzen Redebeitrag und listet alle Behauptungen
  mit den Segmenten, aus denen sie stammen (Claimify-Muster). Jev prüft jede mit dem Absatz als
  Kontext gegen, danach Deduplizierung. Ein LLM-Aufruf je Redebeitrag.
- Eine Behauptung aus mehreren Segmenten nennt alle in `sourceSegmentIds` (der Vertrag erlaubt
  bis zu 100, **keine Vertragsänderung**); `detectMs` zählt ab dem letzten Segment.
- Eval-Zählung: Präzision über Behauptungen (richtig, wenn eines ihrer Segmente
  `expected: true` ist), Ausbeute über Segmente (gefunden, wenn eine Behauptung es nennt). Für
  Behauptungen aus einem Segment ist das dieselbe Zahl wie heute.
- Messung je Variante (bezahlt, Kostenschätzung vorher, Marcos OK): F1 getrennt nach Quelle,
  Zeit bis zur Karte je Pfad, Kosten pro Gesprächsminute.

**Gate E2** – Marco wählt Variante A, B oder keine.

**E4 – Absatz-Pfad umsetzen** · Risiko: **mittel** (Kosten je Gespräch, neuer Zustand in Redis;
Wirkradius `claim-extractor` und Eval-Runner; revertibel per Konfiguration) · Typ: implement

- ADR 0022 „Absatz-Pfad in der Erkennung“ (ergänzt ADR 0017: zwei Pfade, Grenzen des
  Redebeitrags, Kosten).
- PRs mit je höchstens etwa 400 Zeilen Produktionscode: Redebeitrag-Puffer im Extractor-Speicher
  (Aufbewahrung nach ADR 0018) mit Grenzlogik → Absatz-Prüfung der gewählten Variante und
  Konfiguration (zod, `.env.example`) → Eval-Zählung.
- Messlauf mit der finalen Konfiguration (bezahlt, Freigabe); Nachweise in
  `docs/evidence/phase-2/`.

**Gate E3** – Marco testet live mit einer Talkshow wie am 2026-10-01; Retro (Skill `retro`).
Danach #76.

## DoD → Tests

| Anforderung | Stufe | Test / Nachweis | Status |
|---|---|---|---|
| Fragen erreichen den Klassifikator („Was uns empört, ist …“, rhetorische und echte Fragen); Füllwort- und Meinungsregeln unverändert | 1 | `prefilter.test.ts`, `detect.test.ts` | geplant |
| Rund 100 Gesprächssegmente aus echten Aufnahmen, jedes Label von Marco abgenommen, Quelle in `SOURCES.md` | – | `evals/detection.de.jsonl` | geplant |
| Keine synthetischen Stimmen im Test-Audio | – | `tests/fixtures/audio/README.md` | geplant |
| Eval-Bericht getrennt nach Quelle | 5 | `make eval EVAL_SET=detection` | geplant |
| Grenzen des Redebeitrags (Sprecherwechsel, Pause, Höchstdauer, Aufnahme-Ende) | 1 | Unit-Tests mit Fake-Timern | geplant |
| Behauptung aus mehreren Segmenten nennt alle; keine doppelte Karte zwischen den Pfaden | 1 + 2a | `detect.test.ts`, `main.int.test.ts` | geplant |
| Gespräch besser als die Baseline, Bundestag nicht schlechter | 5 | Messlauf (bezahlt, Freigabe) | geplant |
| Kosten pro Gesprächsminute gemessen | 5 | Eval-Bericht | geplant |

## Risiken

- **Verzögerung:** Karten aus dem Absatz-Pfad kommen erst am Ende des Redebeitrags (bis etwa 20 s
  plus Modellzeit). Klare Behauptungen kommen weiter sofort.
- **Kosten ohne Anzeige:** #76 kommt erst danach. Das Tagesbudget (fail closed) deckelt, E3 misst
  die Kosten pro Gesprächsminute.
- **Präzision:** Mehr Sätze erreichen den Klassifikator (E1), der Absatz-Pfad findet mehr; falsche
  Karten sind möglich. Baseline (E2) und Messung (E3) zeigen es, bevor etwas Standard wird.
- **Kleines Set:** Bei rund 100 Gesprächssegmenten sind wenige F1-Punkte Rauschen; Berichte nennen
  Trefferzahlen, nicht nur Prozent.
- **Lizenzlage:** Frei lizenzierte echte Gespräche sind seltener als Talkshows. Reicht das
  Material nicht, kommen mehr Protokolle dazu, und die Talkshows zählen nur lokal.
- **Kinderstimmen:** frei lizenziert selten und besonders schutzwürdig (Stimme ist ein
  personenbezogenes Datum). Fehlen sie, benennt der Bericht die Lücke.
- **Mehrere Extractor-Instanzen:** Der Puffer liegt in Redis; ein Redebeitrag wird genau einmal
  abgeschlossen (Marker wie `processedMarker`).
- **Prompt-Injection:** Der Absatz geht als Daten mit Nonce in den Prompt (wie die Formulierung);
  T7.5 nimmt den neuen Prompt mit auf.

## Status

- [x] Plan freigegeben mit Änderungen (Marco, 2026-10-02, als Freigabe verstanden: „E3 passt zu
  bauen“; E1 nur Fragen; E2 echte Aufnahmen statt Einsprechen; Label-Regel „passt“)
- Grilling-Runde 1 entschieden (Marco, 2026-10-02), Entscheidungen oben
- E1 umgesetzt in PR #92 (Reviewer und Security-Reviewer ohne Blocker, Befunde eingearbeitet);
  ältere Befunde aus dem Security-Review als Issues #90 (Datenschutz-Text zu Jev) und #91 (Budget
  bei Jev ohne Token-Angabe); lokale Aufnahmen per `.gitignore` geschützt
- E2 Teil 1 in **PR #93** (Reviews eingearbeitet): Eval-Bericht mit einer Zeile pro Quelle, 73
  Gesprächssegmente aus der Regierungsbefragung 21/95 mit Label-Vorschlägen (17 Behauptungen, 11
  Grenzfälle), Schutz für lokale Sets (Berichte bleiben lokal, Quelle muss für das Set
  dokumentiert sein, Commit-Hook prüft `.jsonl`). In diesem Block verwirft der Vorfilter nur den
  Satzrest „und mit der Bereichsausnahme.“ (zu kurz, Fall für E3); Füllwort- und Meinungsregeln
  kosten keine Behauptung. Grenze: Protokolltext hat kaum Satzfetzen, den Kern des
  Live-Test-Problems messen erst echte Aufnahmen. Quellen-Research erledigt.
- Grilling-Runde 2 (E2-Quellen, 2026-10-02) wartet auf Marco: Spracherkennung und Kosten für die
  Aufnahmen, Weg für die Talkshows (ZDF/phoenix lokal, ARD nur live, nie YouTube), Minderjährige
  (nur Text), Audio-Ausschnitte im Repo
- **Frontier:** #89 mergen, dann #92 und #93 (Marco) · Grilling-Runde 2 beantworten ·
  E2-Labels in #93 abnehmen (etwa 30 min) · OK für die Kosten von Spracherkennung und
  Baseline-Lauf · offene Frage zu Fragen mit Füllwort-Anfang (#92)
