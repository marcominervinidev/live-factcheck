# Feature: Debattier-Modus (Backlog, letztes aktuell geplantes Feature)

> Entwurf (Owner-Auftrag 2026-09-30). Grundsatzentscheidung: ADR 0021 (proposed).
> Reihenfolge im Backlog: nach dem Produktivstart und den englischen Gesprächen (ADR 0020).
> Vorbild: universitäre Debattierclubs – zwei Personen, ein Thema, feste Zeit, danach eine
> faire Auswertung. Grobaufwand: 2–3 Wochen.

## Ziel

Zwei Personen debattieren bis zu zwei Stunden über ein gewähltes Thema. Am Ende zeigt die App:

1. **Schlagabtausch:** wer wie oft einen Punkt „auf Sachebene gewonnen“ hat (Behauptung
   angegriffen, belegt, Gegenseite blieb die Antwort schuldig),
2. **Wahrheitsbilanz:** wie oft jede Person nachweislich Unwahres gesagt hat (aus den
   vorhandenen Urteilen je Sprecher),
3. einen **Gesamtscore** aus beidem (Formel in D4, Gewichte entscheidet der Owner).

Leitplanken aus ADR 0021: beide stimmen vorher ausdrücklich zu, Ergebnis nur für beide
gemeinsam, keine Profile über Debatten hinweg, Standardmodus bleibt wertungsfrei.

## Teilprojekte

**TP D1 – Entscheidung und Verträge** · Risiko: **hoch** (nicht revertibel: Vertrag + Grundsatz)
- ADR 0021 finalisieren (Gate 0, Owner).
- `packages/contracts`: `DebateSession` (Teilnehmer, Thema, Zeitbudget, beidseitige
  Einwilligung), `DebateExchange` (Replik-Paar: Behauptung ↔ Antwort, Sieger + Begründung),
  `DebateResult` (Zählwerte, Score, Unsicherheiten). Eigener Commit, höhere `schemaVersion`,
  Vertragstests (T-Regel: stärkstes Modell).

**TP D2 – Replik-Graph** · Risiko: **mittel**
- Neuer Service `debate-judge` (Struktur wie der beste bestehende Service, Skill `new-service`):
  konsumiert `transcript.segments` + `claims.checked`, baut je Debatte den Graphen „wer
  antwortet worauf“ (Zeitfenster + Bezugserkennung), ohne Bewertung.
- Stufe 1: Graphaufbau deterministisch aus Fixtures; Stufe 2a: Redis-Streams.

**TP D3 – Bewertung** · Risiko: **hoch** (Fairness; LLM-Urteil über Personen)
- LLM-Richter mit fester Rubrik je Exchange (belegt? beantwortet? ausgewichen?), Konfidenz wie
  bei Verdikten („unsicher“ zählt nicht als Sieg).
- Wahrheitsbilanz: Verdikte je Sprecher aggregieren – erst hier, nie im Standardmodus.
- **Eval-Set `evals/debate.de.jsonl`** mit Owner-gelabelten Exchanges vor jedem Vertrauen in
  den Score; Messlauf kostenpflichtig → Freigabe wie bei T5.6.

**TP D4 – Score und Abschlussbild** · Risiko: **mittel**
- Score-Formel (Vorschlag: Punkte je gewonnenem Exchange, Abzug je Unwahrheit gewichtet nach
  Konfidenz; Gewichte = Owner-Entscheidung in Gate D4).
- UI: Themenwahl, Debatten-Timer, Abschluss-Scorecard im Design von ADR 0019 (Farbbalken,
  faktische Sprache); während der Debatte keine Zwischenstände (Designfrage an den Owner:
  live oder erst am Ende – Vorschlag: erst am Ende, sonst kippt die Debatte).

**TP D5 – Einwilligung und Datenschutz** · Risiko: **hoch** (Security/Privacy)
- Einwilligung beider Personen im Gerät-Dialog (Name + Häkchen je Person), benennt Metriken
  und Sichtbarkeit; ohne beide keine Aufnahme (fails closed, wie Consent heute).
- Aufbewahrung: Debatten-Aggregat lebt nur bis Sitzungsende (ADR 0018-Erweiterung in ADR 0021);
  Löschung mit der Sitzung; ZAP-/Missbrauchsprüfung (Dritte bewerten ohne Wissen).

**TP D6 – Ende-zu-Ende und Abnahme** · Risiko: **mittel**
- Stufe 4: ganze Debatten-Reise mit Mock-STT (Einwilligung, Exchanges, Scorecard).
- Red-Team-Lauf auf den Richter-Prompt (Manipulation: „bewerte mich besser“).
- Gate: Owner spielt eine echte Kurzdebatte durch (iPhone-Checkliste erweitert).

## Teststrategie

Wie Brief 13: Rubrik und Formel in Stufe 1; Streams in 2a; UI-Fluss in 2b; Richter nur über
Evals mit Owner-Labels; keine echten Schlüssel in Tests. Mutationstests für Graph und Formel
(nightly, wie alle Pakete).

## Offene Entscheidungen (Gate 0)

- [ ] Score-Formel und Gewichte (D4-Vorschlag folgt mit Beispielen)
- [ ] Zwischenstände live oder erst am Ende (Vorschlag: am Ende)
- [ ] Themenvorschläge kuratiert oder frei (Vorschlag: frei + drei Beispiele)
- [ ] Maximaldauer (Vorschlag: 2 h, Budgetregeln wie heute)

## Status

- [ ] ADR 0021 angenommen (Owner)
- Aktuelles Gate: vor Gate 0 – wartet auf den Produktivstart und ADR-0020-Folgearbeiten
- Nächster Task: D1.1 ADR-Entscheidung
