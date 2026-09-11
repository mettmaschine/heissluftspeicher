// Besucherzähler. Speichert nur eine Gesamtzahl in Netlify Blobs (kostenlos, keine Einrichtung nötig).
// Es werden keine IP-Adressen, Cookies oder sonstigen Besucherdaten gespeichert.
//   GET  /besucher  -> aktuelle Zahl
//   POST /besucher  -> Zahl um eins erhöhen und zurückgeben (der Browser ruft das einmal je Sitzung auf)
// Optional: Umgebungsvariable ZAEHLER_START = Startdatum, das angezeigt wird (Standard 2026-09-11).

export const config = { path: '/besucher' };

const START = process.env.ZAEHLER_START || '2026-09-11';
const STORE = 'site:zaehler';
const SCHLUESSEL = 'besuche';

function blobsKontext() {
  const roh = globalThis.netlifyBlobsContext || process.env.NETLIFY_BLOBS_CONTEXT;
  if (!roh) return null;
  try {
    const k = typeof roh === 'string' ? JSON.parse(Buffer.from(roh, 'base64').toString('utf8')) : roh;
    return k && k.token && k.siteID && (k.edgeURL || k.uncachedEdgeURL) ? k : null;
  } catch (e) { return null; }
}
function blobUrl(k, basis) {
  return String(basis).replace(/\/$/, '') + '/' + k.siteID + '/' + encodeURIComponent(STORE) + '/' + encodeURIComponent(SCHLUESSEL);
}
async function lese(k) {
  const r = await fetch(blobUrl(k, k.uncachedEdgeURL || k.edgeURL), { headers: { authorization: 'Bearer ' + k.token } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('Zähler lesen: HTTP ' + r.status);
  const text = await r.text();
  try { return JSON.parse(text); } catch (e) { return null; }
}
async function schreibe(k, daten) {
  const r = await fetch(blobUrl(k, k.edgeURL || k.uncachedEdgeURL), {
    method: 'PUT',
    headers: { authorization: 'Bearer ' + k.token, 'content-type': 'application/json' },
    body: JSON.stringify(daten)
  });
  if (!r.ok) throw new Error('Zähler schreiben: HTTP ' + r.status);
}

export default async function (req) {
  const k = blobsKontext();
  if (!k) return antwort(503, { fehler: 'Der Zählerspeicher (Netlify Blobs) ist nicht verfügbar.' });
  try {
    let daten = (await lese(k)) || { besuche: 0, seit: START };
    if (typeof daten !== 'object' || daten === null) daten = { besuche: 0, seit: START };
    if (req.method === 'POST') {
      const ua = req.headers.get('user-agent') || '';
      const bot = /bot|crawl|spider|slurp|preview|headless|monitor|python|curl|wget/i.test(ua);
      if (!bot) {
        daten.besuche = (Number(daten.besuche) || 0) + 1;
        daten.aktualisiert = new Date().toISOString();
        await schreibe(k, daten);
      }
    }
    return antwort(200, { besuche: Number(daten.besuche) || 0, seit: daten.seit || START });
  } catch (e) {
    return antwort(502, { fehler: String(e && e.message || e) });
  }
}

function antwort(status, daten) {
  return new Response(JSON.stringify(daten), {
    status: status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
