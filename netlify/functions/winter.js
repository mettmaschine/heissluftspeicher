// Berechnet aus den AGSI+-Tageswerten seit 2011 für jeden abgeschlossenen Winter: Füllstand am 1. November,
// Tiefstand und den Entnahmeverlauf an festen Stichtagen. Läuft nur mit gesetzter Umgebungsvariable AGSI_API_KEY.

const STICHTAGE = ['11-15', '12-01', '12-15', '01-01', '01-15', '02-01', '02-15', '03-01', '03-15', '04-01', '04-15'];

exports.handler = async function () {
  const schluessel = process.env.AGSI_API_KEY;
  if (!schluessel) return antwort(404, { fehler: 'AGSI_API_KEY ist nicht gesetzt.' });
  try {
    const heute = new Date();
    const bisStr = heute.toISOString().slice(0, 10);
    const werte = {};
    for (let seite = 1; seite <= 30; seite++) {
      const r = await fetch('https://agsi.gie.eu/api?country=DE&from=2011-01-01&to=' + bisStr + '&size=300&page=' + seite,
        { headers: { 'x-key': schluessel, 'Accept': 'application/json' } });
      if (!r.ok) return antwort(502, { fehler: 'AGSI antwortet mit Status ' + r.status });
      const json = await r.json();
      const teil = Array.isArray(json.data) ? json.data : [];
      teil.forEach(d => { const t = String(d.gasDayStart || '').slice(0, 10); const v = Number(d.full); if (t && isFinite(v) && v > 0) werte[t] = v; });
      if (!teil.length || teil.length < 300 || (json.last_page && seite >= Number(json.last_page))) break;
    }
    const tage = Object.keys(werte).sort();
    if (tage.length < 1000) return antwort(502, { fehler: 'Zu wenige Daten von AGSI (' + tage.length + ' Tage).' });

    function wert(datum) { // Wert am Tag oder am nächsten vorhandenen Tag (bis 5 Tage Abstand)
      for (let i = 0; i <= 5; i++) {
        const d = new Date(datum + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + i);
        const k = d.toISOString().slice(0, 10); if (werte[k] != null) return werte[k];
      }
      return null;
    }
    const winter = [];
    for (let jahr = 2011; jahr < heute.getUTCFullYear(); jahr++) {
      const startDatum = jahr + '-11-01', endeDatum = (jahr + 1) + '-04-30';
      if (werte[endeDatum] == null && wert(endeDatum) == null) continue; // Winter noch nicht abgeschlossen
      const start = wert(startDatum); if (start == null) continue;
      let tief = start, tiefDatum = startDatum;
      tage.forEach(t => { if (t >= startDatum && t <= endeDatum && werte[t] < tief) { tief = werte[t]; tiefDatum = t; } });
      let bisher = 0;
      const verlauf = STICHTAGE.map(mmdd => {
        const j = Number(mmdd.slice(0, 2)) >= 7 ? jahr : jahr + 1;
        const v = wert(j + '-' + mmdd);
        if (v != null) bisher = Math.max(bisher, start - v);
        return { tag: mmdd, entnommen: Math.round(bisher * 10) / 10 };
      });
      winter.push({ saison: jahr + '/' + String(jahr + 1).slice(2), start: Math.round(start * 10) / 10, tief: Math.round(tief * 10) / 10, tief_datum: tiefDatum, verlauf: verlauf });
    }
    if (winter.length < 8) return antwort(502, { fehler: 'Zu wenige abgeschlossene Winter berechnet (' + winter.length + ').' });
    return antwort(200, { quelle: 'GIE AGSI+, Tageswerte seit 2011 (automatisch berechnet)', winter: winter }, 86400);
  } catch (e) {
    return antwort(502, { fehler: String(e && e.message || e) });
  }
};

function antwort(status, daten, cacheSekunden) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cacheSekunden ? 'public, max-age=' + cacheSekunden : 'no-store' },
    body: JSON.stringify(daten)
  };
}
