# Heißluftspeicher

Satirische Dokumentationsseite zur deutschen Gasversorgung: aktueller Füllstand, Countdown bis zum
Beginn der Heizsaison, ein moderierter Bullshit-Zähler für Phrasen von Verantwortlichen (mit Datum der Aussage und
Datum der Einreichung, sortierbar nach beiden, YouTube-Ausschnitte mit Start und Ende) und ein Heißluft-Bingo.

Reine HTML-, CSS- und JavaScript-Dateien ohne Abhängigkeiten. Läuft kostenlos bei Netlify.

- `index.html` – Startseite
- `daten/lage.json` – Füllstand, Vorgabe, Vorjahr (von Hand pflegen)
- `daten/verlauf.json` – Punkte für das Verlaufsdiagramm
- `daten/eintraege.json` – freigegebene Phrasen (Zähler)
- `daten/bingo.json` – Phrasen für das Bingo
- `freigabe.html` – Hilfsseite für den Betreiber zum Erzeugen neuer Einträge
- `netlify/functions/freigabe.mjs` – Freigabe oder Ablehnung einer Meldung per Link aus der E-Mail
- `netlify/functions/speicherstand.js` – optionaler automatischer Abruf des Füllstands von AGSI+
- `dokumente/` – Ablage für freigegebene Dokumente (PDF, Bilder)

Lokal testen: im Projektordner `python3 -m http.server 8000` ausführen und `http://localhost:8000` öffnen.
