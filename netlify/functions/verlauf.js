// Liefert tägliche Füllstände der deutschen Gasspeicher für die letzten zwei Jahre aus der Datenbank AGSI+
// (Gas Infrastructure Europe). Läuft nur, wenn in Netlify die Umgebungsvariable AGSI_API_KEY gesetzt ist.
// Ohne Schlüssel antwortet die Funktion mit 404 und die Seite nutzt die Stützpunkte aus daten/verlauf.json.

exports.handler = async function () {
  const schluessel = process.env.AGSI_API_KEY;
  if (!schluessel) return antwort(404, { fehler: 'AGSI_API_KEY ist nicht gesetzt.' });
  try {
    const heute = new Date();
    const von = new Date(Date.UTC(heute.getUTCFullYear() - 2, 8, 1)); // 1. September vor zwei Jahren
    const vonStr = von.toISOString().slice(0, 10), bisStr = heute.toISOString().slice(0, 10);
    let daten = [];
    for (let seite = 1; seite <= 8; seite++) {
      const r = await fetch('https://agsi.gie.eu/api?country=DE&from=' + vonStr + '&to=' + bisStr + '&size=300&page=' + seite,
        { headers: { 'x-key': schluessel, 'Accept': 'application/json' } });
      if (!r.ok) return antwort(502, { fehler: 'AGSI antwortet mit Status ' + r.status });
      const json = await r.json();
      const teil = Array.isArray(json.data) ? json.data : [];
      daten = daten.concat(teil);
      if (!teil.length || teil.length < 300 || (json.last_page && seite >= Number(json.last_page))) break;
    }
    const punkte = daten
      .map(d => ({ datum: String(d.gasDayStart || '').slice(0, 10), prozent: Number(d.full) }))
      .filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p.datum) && isFinite(p.prozent) && p.prozent > 0)
      .sort((a, b) => a.datum.localeCompare(b.datum));
    if (punkte.length < 30) return antwort(502, { fehler: 'Zu wenige Daten von AGSI erhalten (' + punkte.length + ').' });
    return antwort(200, { quelle: 'GIE AGSI+, Tageswerte (automatisch abgerufen)', punkte: punkte }, 21600);
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
