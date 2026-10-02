# Feature: Erkennung im Gespräch – Plan

> Nach Grilling-Runde 1 (Marco, 2026-10-02) und Marcos Änderungen am selben Tag. Auslöser:
> Live-Test am 2026-10-01 mit einer Talkshow – 131 s, 25 Segmente, **0 Behauptungen** erkannt.
> Reihenfolge danach: #76 Kosten-Monitoring, T7.5 Red-Team, Phase 3.
> Grilling-Runde 3 nach Marcos Testlauf (2026-10-02): Wortgrenze und Prüfwürdigkeit aus (E1b),
> erst Diagnose-Logs und das Leck in der Recherche (D1, R1), dann E2b.

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

1. **Fragen und Meinungen bleiben in der Prüfung** (Q3): Rhetorische Fragen und Einleitungen wie
   „Was uns empört, ist …“ gehen an den Klassifikator, auch mit Füllwort vorn („Also wer hat denn
   …?“, Nachtrag aus #92). Meinungssätze („Ich finde es absurd, dass …“) ebenfalls: Der
   Absatz-Pfad prüft solche Vorfilter-Fälle nicht nach, und der Klassifikator soll Tatsachen in
   Meinungen finden (PR #84). Nur Aussagen mit Füllwort-Anfang („Also …“, „Nein, …“) ohne Zahl
   verwirft der Vorfilter weiter.
2. **Erst messen, mit echten Aufnahmen** (Q1 a, am selben Tag geändert): Vor jeder Änderung am
   Pfad kommen echte Gespräche ins Erkennungs-Set: Protokolle und echte Aufnahmen echter Menschen
   (Talkshows, Diskussionen, Debatten). Nichts wird eingesprochen. Labels schlägt der Agent vor,
   Marco nimmt sie ab.
3. **Testszenarien nah an der Realität, keine synthetischen Stimmen** (gilt für alle Tests und
   Messungen): verschiedene Stimmen – Alter, Männer, Frauen, Kinder. Die Regel steht in
   `evals/README.md` und `tests/AGENTS.md`.
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

Grilling-Runde 2 (E2-Quellen, Marco, 2026-10-02):

8. **Spracherkennung: Deepgram**, so wie in Produktion (Q6). Welcher Anbieter beim Live-Test
   lief, ist nicht bekannt.
9. **Talkshows laden, lokal messen, danach löschen** (Q7): aus der Mediathek (ZDF, phoenix; die
   ARD hat Text und Data Mining vorbehalten), nie von YouTube. Ins Repo kommen nur Zahlen.
10. **Audio-Regressionstests mit Audio im Repo** (Q9, ersetzt „Audio-Eval-Bank danach“, #82):
    Clips von je 2–3 Minuten echter Gespräche werden eingespielt und gegen ein festgehaltenes
    Ergebnis geprüft. Ein Querschnitt der Gesellschaft: Kinder und Jugendliche, Ältere und
    Jüngere, Frauen und Männer, jeweils Ausschnitte mit häufigem Sprecherwechsel.
11. **Kinder und Jugendliche ausdrücklich erlaubt**, auch als Audio (Q8), aus Aufnahmen, die
    ihre Herausgeber frei lizenziert veröffentlicht haben.
12. **Datenschutz-Text zu Jev präzisieren** (#90, umgesetzt in #95): Er nennt die letzten
    Gesprächsabschnitte (standardmäßig sechs) und dass im Gespräch genannte Namen mitgehen.
13. **Erst die Erkennung abschließen, dann Features:** Bevor weitere Features entstehen, sollen
    Erkennung und Klassifizierung wirklich gut funktionieren (E1–E4). Marcos neue Idee, bei
    „keine Belege“ und nach einem Themenwechsel nachzurecherchieren, wartet als #94 und wird
    danach geplant (Grilling).

Grilling-Runde 3 (nach Marcos Testlauf, Marco, 2026-10-02). Zähler dieses Laufs: 3 Behauptungen
(1 × falsch, 2 × nicht prüfbar mit `no_evidence`), verworfen 3 × keine Behauptung, 4 × wenig
prüfwürdig, 2 × zu kurz. Welcher Satz welchen Grund bekam, halten die Zähler nicht fest (D1 macht
es sichtbar); die Zuordnung unten ist aus den Zahlen erschlossen.

14. **Wortgrenze entfällt:** Auch kurze Behauptungen und Fetzen gehen an den Klassifikator. Er
    sieht die Segmente davor, so kann aus „Robert Habeck“ und „hat Abitur“ eine Behauptung
    werden; nach den Zählern waren das die beiden „zu kurz“. Ersetzt in E1 den Punkt „Fetzen
    unter 5 Wörtern“.
15. **Prüfwürdigkeit filtert nicht mehr** (Runde 3, Q1 a): Jede erkannte Behauptung wird geprüft,
    auch scheinbar Belangloses oder Absurdes; die vier „wenig prüfwürdig“ passen zu kurzen
    falschen Behauptungen wie „Helmut Kohl ist eine Frau“. #79 kennt nicht erkannte absurde
    Behauptungen schon vom 2026-10-01, dort als „unsicher“ oder „keine Behauptung“ verworfen.
    Geht vor Entscheidung 2 („erst messen“), weil Marco nach dem Testlauf so entschieden hat; E2c
    misst danach beide Einstellungen (5 Wörter und 3 von 5 gegen 1 und 1). Kosten: in Marcos Lauf
    0,147 $ für drei Prüfungen, also rund 5 Cent je Prüfung ohne Erklärung (mit Erklärung
    geschätzt 6–8 Cent, `docs/evidence/phase-1/tp7-eval.txt`); das Tagesbudget deckelt. Beide
    Grenzen bleiben einstellbar. Privates und die Label-Regel: Entscheidungen 19 und 20.
16. **Testtage mit 5 $ Tagesbudget** (Runde 3, Q2 b): Marco setzt `CLOUD_DAILY_BUDGET_USD=5`
    selbst in seiner `.env`, die Testanleitung gibt ihm die Zeile. Das Budget ist ein gemeinsamer
    Topf aller Dienste (ein Zähler je Tag, `budget:v1:cloud:<Tag>`), nicht eines je Dienst, wie
    README, `docs/SECURITY.md` und `.env.example` sagen. Ist er leer, endet eine Aufnahme mit
    Cloud-Spracherkennung mit Hinweis, und Karten zeigen „Tagesbudget aufgebraucht“; die Erkennung
    bleibt ohne Hinweis stehen. Diesen Hinweis und die Doku-Korrektur nimmt #76 auf; bis dahin
    zeigt die D1-Zeile `segment dropped` mit `budget_exceeded` den Stopp.
17. **„Keine Belege“: erst die Stelle finden, an der die Belege verloren gehen** (Runde 3, Q3 a):
    Eine Testsuche des Agenten über SearXNG fand zu den Berlin-Mieten 26 Treffer, darunter
    „binnen zehn Jahren um 69 Prozent“; die Prüfung meldete trotzdem `no_evidence`. Die Prüfung
    nutzt davon höchstens 3 Suchanfragen mit je 5 Treffern und lädt höchstens 4 Seiten, und
    `no_evidence` hat drei Ausgänge: nichts gefunden, nichts relevant, Belege reichen nicht. Erst
    Diagnose-Logs (D1), dann die Ursache beheben (R1). Eine LLM-Zweitprüfung nicht prüfbarer
    Karten kommt nur, wenn danach noch zu viele Karten „nicht prüfbar“ bleiben, und erst, wenn
    feststeht, woran es lag (Marco); als Feature ginge sie nach Entscheidung 13 sonst erst nach
    E4. Dann mit einem günstigen Anthropic-Modell (Haiku 4.5), austauschbar gegen ein lokales.
    Auslöser, Anzeige (Prototyp mit Varianten), das Verhältnis zu #94 und ob das lokale Modell
    mit dem Debattier-Modus (#59) kommt, klärt dann eine eigene Runde. Reihenfolge: E1b → D1 →
    Gate D → R1 → Gate R → E2a2 → E2b.
18. **Diagnose-Logs nur mit Zahlen** (D1, „Logs passen so“): Anzahlen, Gründe als feste Kürzel,
    Fehlerklassen und HTTP-Status. Keine Suchanfragen, keine URLs, keine Fehlertexte, nie
    Gesprächs- oder Behauptungstext.

Grilling-Runde 3b (nach dem Review von E1b, Marco, 2026-10-02):

19. **Privates bleibt draußen** (Runde 3b, Q1 b): Die Prüfwürdigkeit war die einzige Regel, die
    Privates nannte. Jev bekommt deshalb im selben Aufruf eine dritte Frage: Betrifft die neueste
    Äußerung das Privatleben einer nicht öffentlich bekannten Person (jemand am Tisch, Familie,
    Freundeskreis, Nachbarschaft)? Ab einer Wahrscheinlichkeit von 0,5 wird das Segment als
    `private` verworfen, bevor Text an Formulierung, Suche oder Prüfmodelle geht. Personen des
    öffentlichen Lebens und ihr öffentliches Wirken zählen nicht dazu. E2b und E2c bekommen
    private und biografische Gesprächssegmente, damit die Frage gemessen wird.
20. **Label-Regel 2 neu** (Runde 3b, Q2 a): Jede prüfbare Behauptung zählt als `expected: true`,
    auch Belangloses und Absurdes; Privates nicht öffentlich bekannter Personen bleibt `false`.
    Der Agent schlägt die geänderten Labels vor (`reviewed: false`), Marco nimmt sie ab, danach
    misst E2c (Aufgabe E2a2).

## Aufgaben

**E1 – Vorfilter: Fragen gehen an den Klassifikator** · Risiko: **niedrig** (revertibel, nur
`claim-extractor`, kein Vertrag) · Typ: implement

- Umgesetzt in **PR #92**: Eine Frage ist kein Grund mehr zum Verwerfen, weder mit Fragewort am
  Anfang („Was uns empört, ist …“) noch mit „?“ („Wer hat denn die Mieten verdoppelt?“) noch mit
  Füllwort vorn („Also wer hat denn …?“; erkannt am Fragezeichen). Eine Meinung ebenso wenig
  („Ich finde es absurd, dass …“). Der Klassifikator unterscheidet
  rhetorische und echte Fragen (Prompt nach ADR 0017); die Regel „verneinte Frage geht durch“
  (2026-09-30) geht darin auf.
- Unverändert (Entscheidung 1): Fetzen unter 5 Wörtern (`too_short`, E3 holt sie nach; mit E1b
  aus, Entscheidung 14) und Aussagen mit Füllwort-Anfang ohne Zahl. E2 zählt mit, wie viele
  echte Behauptungen die Füllwort-Regel im Gespräch verwirft.
- Kosten: ein Klassifikator-Aufruf mehr je Frage (Jev 0,042 $ pro 1 Mio. Input-Tokens, der
  `llm`-Klassifikator zum Preis des Extractor-Modells); wird eine Frage zur Behauptung, kommen
  Formulierung und Faktencheck dazu. Auf dem Eval-Set bewegt sich F1 je nach Urteil zwischen −4,6
  und +1,3 Punkten; die E2-Baseline misst es.
- Datierter Nachtrag in ADR 0017 (Umfang des Vorfilters).

**E2a – Protokoll-Segmente und Bericht je Quelle** · Risiko: **niedrig** · Typ: implement

- Umgesetzt in **PR #93**: 73 Segmente aus der Regierungsbefragung 21/95, von Marco abgenommen
  (2026-10-02); Eval-Bericht mit einer Zeile pro Quelle; lokale Sets schreiben ihre Berichte nach
  `evals/local/reports/`; jede Quelle muss für ihr Set dokumentiert sein.
- Grenze: Protokolltext hat kaum Satzfetzen. Das misst erst E2b.

**E1b – Wortgrenze und Prüfwürdigkeit aus, Privates bleibt draußen** · Risiko: **hoch** (nach der
Rubrik nicht revertibel: sichtbares Verhalten und Datenschutz; praktisch per Einstellung
zurücknehmbar, nur `claim-extractor`, kein Vertrag) · Typ: implement

- `DETECTOR_MIN_WORDS` mit Standard 1 (nur leere Segmente fallen weg), neu auch in Compose
  einstellbar; `DETECTOR_MIN_SCORE` mit Standard 1 (keine Behauptung fällt wegen geringer
  Prüfwürdigkeit weg). Beide bleiben für den Messlauf einstellbar (Entscheidungen 14, 15).
- Mit angepasst: `.env.example`, die Kommentare in `config.ts` und die Standardwerte in ADR 0017
  (Entscheidungstext und datierter Nachtrag); `config.test.ts` prüft bewusst die neuen Werte.
- Nachweis: Vorfilter-Zählung auf dem Eval-Set vorher und nachher.
- Privat-Frage als dritte Frage im selben Klassifikator-Aufruf, Grund `private` (Entscheidung 19).

**D1 – Diagnose-Logs** · Risiko: **mittel** (dienstübergreifend: `packages/research`, Erkennung und
Faktencheck; Logzeilen zu Gesprächen; revertibel, kein Vertrag) · Typ: implement

- Erkennung: je verworfenem Segment eine Zeile `segment dropped` (info) mit `segmentId` und
  Grund; nach einem Anbieterfehler als Warnung mit Quelle (Klassifikator oder LLM), Fehlerart,
  HTTP-Status und Fehlerklasse (#79; das Drop-Logging aus #79 und #76 wandert hierher).
- Faktencheck: je Prüfung mit Recherche eine Zeile `research summary` (info): Anzahl
  Suchanfragen und ob die Ersatz-Suchanfragen liefen, Anzahl Suchanfragen mit langen
  Ziffernketten (#80), Dokumente je Recherche-Stufe, gescheiterte Stufen mit Fehlerklasse und
  Status, Treffer der Websuche, versuchte Seiten und übersprungene Seiten je Grund (robots,
  blockiert, HTTP-Status, Inhaltstyp, zu groß, nicht lesbar), Ausschnitte, relevante
  Ausschnitte, die Wahrscheinlichkeit „Belege reichen“ und die Zeiten. Daraus ergibt sich, welcher
  der drei `no_evidence`-Ausgänge griff.
- Nur Zahlen (Entscheidung 18); die Tests prüfen, dass weder Behauptungstext noch eine URL im
  Ergebnis steht.

**Gate D** – Marcos Testlauf nach Testanleitung (AGENTS.md, Workflow): kurze Behauptungen, die
Berlin-Mieten, je nach Runde 3b auch Privates; Marco schickt die D1-Zeilen. Danach R1.

**R1 – Die Stelle beheben, an der die Recherche Belege verliert** · Risiko: **mittel**
(Urteilsqualität aller Prüfungen; revertibel) · Typ: research → implement

- Die Stelle aus den D1-Zeilen bestimmen (Suchanfragen, Laden der Seiten, Sortieren mit dem
  einfachen Wortvergleich `mock`, Relevanzprüfung, Ausreichen) und beheben; Kandidat ist #80
  (Zahlen in den Suchanfragen).
- Zuerst ein Regressionstest auf der untersten Stufe (1 oder 2a, AGENTS.md, Tests) mit einer
  Recherche-Antwort wie im Testlauf.
- Die Owner-Fälle als Urteils-Testfälle in `evals/claims.de.jsonl`: Labels von Marco abgenommen,
  Quelle in `SOURCES.md`, Kategorie aus `evals/src/dataset.ts`.
- Grenzen für SSRF, robots.txt und Inhaltstyp werden nicht gelockert; berührt eine Änderung sie,
  prüft der Security-Reviewer mit Angriffstests.
- Marcos Idee (2026-10-02): Wissensquellen statt Websuche, weil die Websuche unter Bot-Sperren,
  Cookie-Bannern und Paywalls leidet. Anhand der D1-Zeilen (`documents` je Stufe) prüfen, was
  mehr bringt: der Google-Fact-Check-Key (Stufe 1, bei Marco noch aus), amtliche Statistik
  (Destatis GENESIS, Eurostat) als neue Stufe für Zahlen-Behauptungen. Entscheidung nach Gate D
  per Grilling.

**Gate R** – Marco testet: Bekommen die Fälle jetzt Belege? Bleiben aus seiner Sicht zu viele
Karten „nicht prüfbar“, folgt die Grilling-Runde zur LLM-Zweitprüfung (Entscheidung 17).

**E2a2 – Label-Regel 2 neu** · Risiko: **niedrig** (nur Eval-Daten und ihre Doku; revertibel) ·
Typ: implement (vor E2c)

- `evals/README.md`, Regel 2: jede prüfbare Behauptung zählt, Privates nicht öffentlich bekannter
  Personen nicht (Entscheidungen 19, 20), datiert.
- Label-Vorschläge für die Segmente, die nur wegen geringer Prüfwürdigkeit `false` sind (neun mit
  ausdrücklicher Notiz, weitere nach Durchsicht), mit `reviewed: false`; Marco nimmt sie ab.

**E2b – Audio-Regressionstests** · Risiko: **mittel** (neue Testart mit echtem Anbieter und Kosten,
Audio-Dateien im öffentlichen Repo, Lizenzfragen; revertibel) · Typ: research → prototype →
implement

- Quellen (Research → `.ai/research/conversation-audio-sources.md`), ins Repo nur mit passender
  Lizenz und Namensnennung:
  - Bundestag-Mediathek: zuerst das Audio derselben Regierungsbefragung 21/95, so dass Protokoll
    und Spracherkennung direkt vergleichbar sind; dazu „Jugend und Parlament“ (17–20 Jahre).
    Nutzungsbedingungen: Bildung und Kultur, nicht kommerziell, Weitergabe mit Hinweis.
  - Wikimedia Commons (CC BY, BY-SA): Podien und Streitgespräche, Interviews mit Älteren.
  - media.ccc.de (CC BY 4.0): Gesprächsrunden mit Publikumsfragen; „Jugend hackt“ (12–18 Jahre).
  - Kinder unter etwa 12: frei lizenzierte Gespräche fand die Recherche keine. Der Agent sucht
    gezielt weiter und benennt die Lücke, statt sie zu füllen.
- Auswahl: 8–10 Clips von je 2–3 Minuten, jeweils der Ausschnitt mit den meisten
  Sprecherwechseln. Je Clip stehen Quelle, Lizenz, Sprecherzahl, grobes Alter und Geschlecht in
  einer Metadaten-Datei. Der Querschnitt ist erst erreicht, wenn jede Gruppe aus Entscheidung 10
  vorkommt.
- Ablage: `tests/fixtures/audio/regression/` als FLAC (16 kHz mono, verlustfrei, etwa 3 MB je
  Clip, ohne Git LFS); ein Clip ersetzt `conversation.de.wav`.
- Ablauf je Clip: Audio → Deepgram (Entscheidung 8) → Segmente → `claim-extractor`. Beim ersten
  Lauf hält der Agent das Transkript als Referenz fest und schlägt Labels je Segment vor; Marco
  nimmt sie ab. Ab dann prüft jeder Lauf zwei Dinge: Wie weit weicht das Transkript von der
  Referenz ab (Wortfehlerrate), und wie gut trifft die Erkennung die Labels (Precision, Recall).
  Fällt einer der Werte unter die festgehaltene Schwelle, ist der Lauf rot.
- Start mit einem Make-Target (manuell, eigener Budget-Key); später nightly, wenn Marco einen
  Deepgram-Key fürs Eval-Environment hinterlegt. In der PR-CI läuft der Test nicht, dort gibt es
  nur Mock-Anbieter.
- Kosten: Deepgram 0,0077 $ pro Minute, für 10 Clips à 3 min also etwa 0,23 $ je Lauf, dazu
  Klassifikator und Formulierung. Vor dem ersten Lauf eine Schätzung an Marco.
- Talkshows (Entscheidung 9) laufen durch denselben Runner aus `evals/local/`; Audio, Transkript
  und Labels bleiben lokal und werden nach der Messung gelöscht.

**E2c – Baseline** · Risiko: **niedrig** · Typ: implement

- Bezahlter Lauf Jev@0,6 mit E1 über das Text-Set (Reden und Befragung) und die Audio-Clips,
  Bericht je Quelle, dazu die Vorfilter-Zählung (Entscheidung 1). Kostenschätzung vorher.

**Gate E1** – Marco: Labels der Audio-Clips abgenommen, Baseline gesehen. Danach E3.

**E3 – Prototyp Absatz-Pfad, zwei Varianten gemessen** · Risiko: **mittel** (neuer LLM-Aufruf
kostet Geld, neuer Zustand im Extractor; revertibel per Konfiguration, kein Vertrag) · Typ:
prototype (Marco wählt nach Zahlen)

- Redebeitrag = Segmente eines Sprechers bis Sprecherwechsel, Pause ab etwa 2 s (aus
  `startMs`/`endMs`), höchstens etwa 20 s oder Aufnahme-Ende. Ohne Sprechertrennung (heute
  `stt-local`, Diarization ist Phase 3) zählen nur Pause, Höchstdauer und Ende.
- Der Absatz-Pfad läuft nur, wenn im Redebeitrag ein Segment als `too_short` oder `uncertain`
  hängen blieb (`too_short` seit E1b nur noch bei gesetzter Wortgrenze). Den Auslöser bestimmt
  E3 nach E2c neu; als `not_a_claim` abgewiesene Fragmente gehören dazu.
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
| Fragen und Meinungen erreichen den Klassifikator („Was uns empört, ist …“, rhetorische, echte und mit Füllwort vorn, „Ich finde es absurd, dass …“); Aussagen mit Füllwort vorn ohne Zahl weiter verworfen | 1 | `prefilter.test.ts`, `detect.test.ts` | in #92 |
| Kurze Behauptungen und Fetzen erreichen den Klassifikator; jede erkannte Behauptung wird ohne Prüfwürdigkeits-Grenze geprüft (Standard); beide Grenzen bleiben einstellbar | 1 | `prefilter.test.ts`, `detect.test.ts`, `config.test.ts` | geplant (E1b) |
| Private Angelegenheiten nicht öffentlich bekannter Personen werden ab Wahrscheinlichkeit 0,5 verworfen, bevor Text Formulierung, Suche oder Prüfmodelle erreicht; die Frage steht im selben Aufruf | 1 | `detect.test.ts` | geplant (E1b) |
| Label-Regel 2 neu, geänderte Labels von Marco abgenommen | – | `evals/README.md`, `evals/detection.de.jsonl` | geplant (E2a2) |
| Verworfene Segmente mit Grund und Anbieterfehler mit Quelle und HTTP-Status im Log der Erkennung; je Prüfung eine Recherche-Zusammenfassung; nur Zahlen, nie Text oder URLs | 1 | Tests in `packages/research`, `fact-checker` und `claim-extractor` | geplant (D1) |
| Die Owner-Fälle (Berlin-Mieten) bekommen Belege | 5 | Marcos Testlauf, `evals/claims.de.jsonl` | geplant (R1) |
| Gesprächssegmente aus Protokollen, jedes Label von Marco abgenommen, Quelle in `SOURCES.md` | – | `evals/detection.de.jsonl` | in #93 |
| 8–10 Audio-Clips (2–3 min, Querschnitt nach Entscheidung 10), Lizenz und Metadaten je Clip, Labels von Marco abgenommen | – | `tests/fixtures/audio/regression/` | geplant |
| Audio-Regressionslauf: Wortfehlerrate und Erkennung je Clip gegen die festgehaltenen Werte | 5 | Make-Target (Deepgram, bezahlt) | geplant |
| Keine synthetischen Stimmen im Test-Audio | – | `tests/fixtures/audio/README.md` | Regel in #89, Ersatz der Datei in E2b |
| Eval-Bericht getrennt nach Quelle | 1 | `detection.test.ts` (Bericht), `make eval EVAL_SET=detection` | in #93 |
| Grenzen des Redebeitrags (Sprecherwechsel, Pause, Höchstdauer, Aufnahme-Ende) | 1 | Unit-Tests mit Fake-Timern | geplant |
| Behauptung aus mehreren Segmenten nennt alle; keine doppelte Karte zwischen den Pfaden | 1 + 2a | `detect.test.ts`, `main.int.test.ts` | geplant |
| Gespräch besser als die Baseline, Bundestag nicht schlechter | 5 | Messlauf (bezahlt, Freigabe) | geplant |
| Kosten pro Gesprächsminute gemessen | 5 | Eval-Bericht | geplant |

## Risiken

- **Verzögerung:** Karten aus dem Absatz-Pfad kommen erst am Ende des Redebeitrags (bis etwa 20 s
  plus Modellzeit). Klare Behauptungen kommen weiter sofort.
- **Privat-Frage:** Jev kann sie falsch anwenden: eine öffentliche Behauptung als privat
  verworfen, eine private als öffentlich geprüft. E2b und E2c messen sie mit privaten und
  biografischen Gesprächssegmenten.
- **Kosten nach E1b:** Jeder Fetzen kostet einen Klassifikator-Aufruf, jede zusätzliche
  Behauptung eine Prüfung (rund 5 Cent mit Opus). Das Tagesbudget deckelt (fail closed); an
  Testtagen 5 $ (Entscheidung 16).
- **Kosten ohne Anzeige:** #76 kommt erst danach. Das Tagesbudget (fail closed) deckelt, E3 misst
  die Kosten pro Gesprächsminute.
- **Präzision:** Mehr Sätze erreichen den Klassifikator (E1), der Absatz-Pfad findet mehr; falsche
  Karten sind möglich. Baseline (E2c) und Messung (E3) zeigen es; E1b wurde nach Marcos
  Testlauf schon vorher Standard (Entscheidung 15), E2c misst beide Einstellungen.
- **Kleines Set:** Bei rund 100 Gesprächssegmenten sind wenige F1-Punkte Rauschen; Berichte nennen
  Trefferzahlen, nicht nur Prozent.
- **Lizenzlage:** Frei lizenzierte echte Gespräche sind seltener als Talkshows; die
  Bundestag-Bedingungen („Bildung und Kultur“) decken ein öffentliches Test-Repo vermutlich, aber
  nicht sicher (bei Zweifel Rückfrage beim Parlamentsfernsehen). Talkshows zählen nur lokal.
- **Kinderstimmen:** frei lizenziert selten (unter etwa 12 Jahren keine gefunden). Erlaubt sind
  sie laut Marco; die Clips nennen keine Namen von Kindern, und der Bericht benennt eine Lücke,
  statt sie mit ungeeignetem Material zu füllen.
- **Regression mit Cloud-Anbieter:** Deepgram kann sein Modell ändern; dann weicht das Transkript
  ab, ohne dass unser Code schuld ist. Der Bericht trennt deshalb Transkript-Abweichung und
  Erkennungs-Ergebnis.
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
- E2a in **PR #93** (Reviews eingearbeitet, Labels von Marco abgenommen 2026-10-02): Eval-Bericht
  mit einer Zeile pro Quelle, 73 Gesprächssegmente aus der Regierungsbefragung 21/95 (17
  Behauptungen), Schutz für lokale Sets. In diesem Block verwirft der Vorfilter nur den Satzrest
  „und mit der Bereichsausnahme.“ (zu kurz, Fall für E3). Grenze: Protokolltext hat kaum
  Satzfetzen; das misst E2b.
- Grilling-Runde 2 entschieden (Marco, 2026-10-02): Entscheidungen 8–12. Übersicht aller Regeln
  der Prüfstrecke als Artifact „Prüfstrecke Live-Faktencheck“.
- Meinungsregel gestrichen (Marco, 2026-10-02, in #92). Neue Idee Nachrecherche bei „keine
  Belege“ und Themenwechsel → #94, nach E1–E4 (Entscheidung 13).
- Datenschutz-Text zu Jev in **PR #95** (Review eingearbeitet: „standardmäßig sechs“
  Gesprächsabschnitte, Aufbewahrung „bei uns“); Übersicht aller Regeln als Artifact
  „Prüfstrecke Live-Faktencheck“.
- #89, #92, #93 und #95 gemergt (Marco, 2026-10-02). Marcos Testlauf danach: zuerst
  8 × `provider_error` (ein Anbieter-Zugang, nach Marcos Korrektur und Neustart behoben); dann
  3 Behauptungen (1 × falsch, 2 × nicht prüfbar mit `no_evidence`), verworfen 3 × keine
  Behauptung, 4 × wenig prüfwürdig, 2 × zu kurz.
- Grilling-Runde 3 entschieden (Marco, 2026-10-02): Entscheidungen 14–18, Plan-Änderung
  freigegeben („Ja, mach das so“).
- Grilling-Runde 3b entschieden (Marco, 2026-10-02): Entscheidungen 19 und 20. D1 in **PR #96**
  (alle Prüfungen grün).
- **Frontier:** Marco: Plan-PR, E1b und #96 mergen · Gate D (Testlauf nach Anleitung) · R1 ·
  Gate R · E2a2 · danach E2b (Clips auswählen, Kostenschätzung für den ersten Deepgram-Lauf)
