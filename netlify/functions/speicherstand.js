// Liefert den aktuellen Füllstand der deutschen Gasspeicher aus der Datenbank AGSI+ (Gas Infrastructure Europe).
// Läuft nur, wenn in Netlify die Umgebungsvariable AGSI_API_KEY gesetzt ist. Ohne Schlüssel antwortet die
// Funktion mit 404 und die Seite nutzt den Wert aus daten/lage.json.

exports.handler = async function () {
  const schluessel = process.env.AGSI_API_KEY;
  if (!schluessel) return antwort(404, { fehler: 'AGSI_API_KEY ist nicht gesetzt.' });
  try {
    const r = await fetch('https://agsi.gie.eu/api?country=DE&size=1', {
      headers: { 'x-key': schluessel, 'Accept': 'application/json' }
    });
    if (!r.ok) return antwort(502, { fehler: 'AGSI antwortet mit Status ' + r.status });
    const json = await r.json();
    const d = Array.isArray(json.data) ? json.data[0] : null;
    if (!d) return antwort(502, { fehler: 'Keine Daten von AGSI erhalten.' });
    return antwort(200, {
      prozent: Number(d.full),
      datum: d.gasDayStart,
      gespeichert_twh: Number(d.gasInStorage),
      arbeitsgas_twh: Number(d.workingGasVolume),
      trend_pp_tag: Number(d.trend),
      quelle: 'GIE AGSI+'
    }, 3600);
  } catch (e) {
    return antwort(502, { fehler: String(e && e.message || e) });
  }
};

function antwort(status, daten, cacheSekunden) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheSekunden ? 'public, max-age=' + cacheSekunden : 'no-store'
    },
    body: JSON.stringify(daten)
  };
}
