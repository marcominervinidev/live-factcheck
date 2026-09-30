# iPhone-Smoke-Test (Phase 2, T7.2)

Manueller Test auf dem echten iPhone. Er belegt das DoD der Phase 2 (Brief 17): *Ich spreche ins iPhone, sehe das Transkript live und bekomme für eine falsche Behauptung innerhalb weniger Sekunden eine Karte.* Die automatisierten Tests (Stufe 2b und 4) laufen in WebKit, aber nicht auf echter Hardware mit echtem Mikrofon; genau das prüft diese Liste.

Dauer: etwa 15 Minuten. Ergebnis mit Datum, iOS-Version und Anbietern in `docs/evidence/phase-2/tp7-iphone-smoke.md` festhalten (Screenshots vom iPhone genügen).

## Vorbereitung (einmalig)

- [ ] Mac und iPhone im selben WLAN; `LAN_HOST` in `.env` ist der Bonjour-Name des Macs (z. B. `marcos-mac.local`)
- [ ] Caddy-Zertifikat auf dem iPhone installiert und voll vertraut (README, „Trusting the local certificate“)
- [ ] Anbieter gewählt:
  - **Variante A (kostenlos, prüft nur die Technik):** alles `mock`. Das Mock-STT ignoriert, was du sagst, und liest ein festes Skript vor.
  - **Variante B (das eigentliche DoD):** `STT_PROVIDER=deepgram`, dazu ein echter Klassifikator und Checker (z. B. Claude). Kostet ein paar Cent; `CLOUD_DAILY_BUDGET_USD` begrenzt.
- [ ] `make up`, dann `make ready` ist grün

## Ablauf

1. **Seite öffnen:** Safari → `https://<LAN_HOST>`
   - [ ] keine Zertifikatswarnung
   - [ ] Status oben „Verbunden“, nachdem das Token in den Einstellungen gespeichert ist
2. **Zum Home-Bildschirm:** Teilen → „Zum Home-Bildschirm“, App von dort öffnen
   - [ ] startet ohne Safari-Leisten, Inhalt nicht unter Notch oder Home-Indikator
3. **Einwilligung:** „Aufnahme starten“
   - [ ] Dialog nennt die aktiven Cloud-Anbieter (Variante B: Deepgram und die Modelle); bei Variante A „Alle Dienste laufen lokal“
   - [ ] „Abbrechen“ startet nichts, das Mikrofon-Symbol von iOS erscheint nicht
4. **Mikrofon:** erneut starten und zustimmen
   - [ ] iOS fragt einmal nach dem Mikrofon; nach „Erlauben“ steht „Aufnahme läuft“
   - [ ] (einmal testen) nach „Nicht erlauben“ steht ein Hinweis zur Mikrofonfreigabe
5. **Sprechen** (Variante B), deutlich, mit kurzen Pausen:
   - „Guten Abend und willkommen.“
   - „Der Zweite Weltkrieg endete 1965.“
   - „Berlin hat ungefähr 3,9 Millionen Einwohner.“
   - [ ] Text erscheint live, erst grau, dann schwarz
   - [ ] „endete 1965“ wird unterstrichen („wird geprüft“) und färbt sich dann mit „Falsch“
   - [ ] **Zeit** von Satzende bis Karte notieren (DoD: wenige Sekunden)
   - [ ] Tipp auf die Markierung springt zur Karte
6. **Beenden:** „Aufnahme beenden“
   - [ ] Mikrofon-Symbol von iOS verschwindet
7. **Displaysperre:** Aufnahme starten, iPhone sperren, wieder entsperren
   - [ ] Aufnahme ist beendet, Hinweis „…weil die App in den Hintergrund gewechselt ist“
8. **App-Wechsel:** Aufnahme starten, zu einer anderen App wechseln, zurück
   - [ ] wie bei 7
9. **Verbindung:** Aufnahme starten, am Mac `docker compose restart gateway`
   - [ ] Hinweis „Die Verbindung wurde unterbrochen“, Status kommt von selbst zurück, neue Aufnahme möglich

## Wenn etwas nicht klappt

Notiere Schritt, iOS-Version und was du siehst; ein Screenshot hilft. Serverseitig: `make logs` (Logs enthalten keine Transkripttexte, nur IDs und Zeiten).
