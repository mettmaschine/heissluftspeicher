// Freigabe per Klick.
// Aufruf: https://DEINE-SEITE/freigabe?id=MELDUNGSNUMMER&aktion=freigeben   (oder aktion=ablehnen)
//
// Ablauf: Die Meldung liegt bei Netlify Forms. Diese Funktion sucht sie anhand der Meldungsnummer,
// baut daraus einen Eintrag und schreibt ihn über die GitHub-Schnittstelle in daten/eintraege.json.
// Netlify veröffentlicht die Seite danach automatisch neu. Beim Ablehnen wird die Meldung bei Netlify gelöscht.
//
// Benötigte Umgebungsvariablen in Netlify (Anleitung, Teil E):
//   FREIGABE_PASSWORT  – Passwort, das beim ersten Klick abgefragt wird
//   NETLIFY_TOKEN      – persönlicher Zugangsschlüssel für die Netlify-Schnittstelle
//   GITHUB_TOKEN       – Zugangsschlüssel für das Repository (Contents: Read and write)
//   GITHUB_REPO        – z. B. "benutzername/heissluftspeicher"
//   GITHUB_ZWEIG       – optional, Standard "main"

import { createHmac, timingSafeEqual } from 'node:crypto';

export const config = { path: '/freigabe' };

export default async function (req, context) {
  const url = new URL(req.url);
  const umg = {
    passwort: process.env.FREIGABE_PASSWORT || '',
    netlify: process.env.NETLIFY_TOKEN || '',
    github: process.env.GITHUB_TOKEN || '',
    repo: process.env.GITHUB_REPO || '',
    zweig: process.env.GITHUB_ZWEIG || 'main',
    siteId: process.env.SITE_ID || (context && context.site && context.site.id) || ''
  };
  const fehlend = [];
  if (!umg.passwort) fehlend.push('FREIGABE_PASSWORT');
  if (!umg.netlify) fehlend.push('NETLIFY_TOKEN');
  if (!umg.github) fehlend.push('GITHUB_TOKEN');
  if (!umg.repo) fehlend.push('GITHUB_REPO');
  if (fehlend.length) {
    return seite(500, 'Einrichtung unvollständig',
      '<p>In Netlify fehlen folgende Umgebungsvariablen: <strong>' + esc(fehlend.join(', ')) + '</strong>. Siehe Anleitung, Teil E. Nach dem Anlegen ein neues Deploy auslösen.</p>');
  }
  if (!umg.siteId) return seite(500, 'Fehler', '<p>Die Netlify-Projektkennung (SITE_ID) ist nicht verfügbar.</p>');

  let id = url.searchParams.get('id') || '';
  let aktion = url.searchParams.get('aktion') || 'freigeben';
  let angemeldet = pruefeSitzung(req, umg.passwort);
  let neuesCookie = null;

  if (req.method === 'POST') {
    const form = await req.formData();
    id = String(form.get('id') || id);
    aktion = String(form.get('aktion') || aktion);
    const eingabe = String(form.get('passwort') || '');
    if (!gleich(eingabe, umg.passwort)) {
      await new Promise(r => setTimeout(r, 1500)); // bremst Rateversuche
      return seite(401, 'Falsches Passwort', anmeldeFormular(id, aktion, true));
    }
    angemeldet = true;
    neuesCookie = sitzungsCookie(umg.passwort);
  }
  if (!angemeldet) return seite(401, 'Anmeldung', anmeldeFormular(id, aktion, false));
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(id)) return seite(400, 'Ungültiger Link', '<p>Der Link enthält keine gültige Meldungsnummer.</p>' + zurueck());
  if (aktion !== 'freigeben' && aktion !== 'ablehnen') return seite(400, 'Ungültiger Link', '<p>Unbekannte Aktion.</p>' + zurueck());

  try {
    const ergebnis = aktion === 'ablehnen' ? await ablehnen(id, umg) : await freigeben(id, umg);
    return seite(200, ergebnis.titel, ergebnis.html, neuesCookie);
  } catch (e) {
    return seite(500, 'Das hat nicht geklappt', '<p>' + esc(e && e.message ? e.message : String(e)) + '</p><p>Ersatzweg: Angaben aus der E-Mail auf <a href="/freigabe.html">freigabe.html</a> eintragen und von Hand in <code>daten/eintraege.json</code> einfügen.</p>' + zurueck(), neuesCookie);
  }
}

/* ------------------------------------------------------------ Aktionen */

export async function freigeben(id, umg) {
  const datei = await leseDatei('daten/eintraege.json', umg);
  if (!datei) throw new Error('daten/eintraege.json wurde im Repository nicht gefunden. Stimmen GITHUB_REPO (' + umg.repo + ') und der Zweig (' + umg.zweig + ')?');
  let liste;
  try { liste = JSON.parse(datei.text); } catch (e) { throw new Error('daten/eintraege.json ist kein gültiges JSON. Bitte auf freigabe.html unter „Ganze Datei prüfen“ kontrollieren.'); }
  if (!Array.isArray(liste)) throw new Error('daten/eintraege.json muss eine Liste sein ([ … ]).');

  const vorhanden = liste.find(e => e && e.meldung_id === id);
  if (vorhanden) return { titel: 'Bereits freigegeben', html: '<p>Diese Meldung ist schon als Eintrag Nr. ' + esc(vorhanden.id) + ' online.</p>' + vorschau(vorhanden) + zurueck() };

  const m = await findeMeldung(id, umg);
  if (!m) return { titel: 'Meldung nicht gefunden', html: '<p>Zu diesem Link gibt es keine offene Meldung mehr. Vielleicht wurde sie bereits abgelehnt und gelöscht.</p>' + zurueck() };

  const d = m.data || {};
  const naechsteId = liste.reduce((max, e) => Math.max(max, Number(e && e.id) || 0), 0) + 1;
  const eintrag = baueEintrag(d, naechsteId, id, m.created_at);

  const dok = d.dokument;
  if (dok && typeof dok === 'object' && dok.url) {
    eintrag.dokumente.push(await kopiereDokument(dok, naechsteId, umg));
  }

  liste.unshift(eintrag);
  await schreibeDatei('daten/eintraege.json', Buffer.from(JSON.stringify(liste, null, 2) + '\n', 'utf8'),
    'Freigabe: Eintrag ' + naechsteId + ' (' + eintrag.wer + ')', datei.sha, umg);

  return { titel: 'Freigegeben', html: '<p>Eintrag Nr. ' + naechsteId + ' ist gespeichert. Netlify veröffentlicht die Seite in etwa einer Minute; der Zähler steigt dann um eins.</p>' + vorschau(eintrag) + zurueck() };
}

export async function ablehnen(id, umg) {
  const m = await findeMeldung(id, umg);
  if (!m) return { titel: 'Meldung nicht gefunden', html: '<p>Zu diesem Link gibt es keine offene Meldung mehr.</p>' + zurueck() };
  await netlifyApi('/submissions/' + m.id, umg, { method: 'DELETE' });
  return { titel: 'Abgelehnt', html: '<p>Die Meldung wurde bei Netlify gelöscht und erscheint nicht auf der Seite.</p>' + zurueck() };
}

/* ------------------------------------------------------- Eintrag bauen */

export function baueEintrag(d, id, meldungId, erstelltAm) {
  const t = k => String(d[k] == null ? '' : d[k]).trim();
  return {
    id: id,
    datum: t('datum'),
    eingereicht: t('eingereicht_am') || (erstelltAm ? String(erstelltAm).slice(0, 10) : ''),
    wer: t('wer'),
    funktion: t('funktion'),
    zitat: t('zitat').replace(/^[„"“»]+|[“"”«]+$/g, '').trim(),
    sinngemaess: false,
    kategorie: t('kategorie') || 'Sonstiges',
    kontext: t('kontext'),
    quellen: quellenAusText(t('quellen')),
    youtube: { url: t('youtube'), start: zeitInSekunden(t('youtube_start')) || 0, ende: zeitInSekunden(t('youtube_ende')) || 0 },
    dokumente: [],
    meldung_id: meldungId
  };
}

export function quellenAusText(text) {
  return String(text || '').split(/\r?\n/).map(z => z.trim()).filter(Boolean).map(z => {
    const m = z.match(/https?:\/\/\S+/);
    if (!m) return null;
    const url = m[0].replace(/[),.;]+$/, '');
    let titel = z.replace(url, '').replace(/[|:–-]\s*$/, '').trim();
    if (!titel) { try { titel = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { titel = url; } }
    return { titel: titel, url: url };
  }).filter(Boolean);
}

export function zeitInSekunden(text) {
  text = String(text || '').trim();
  if (!text) return 0;
  if (/^\d+$/.test(text)) return Number(text);
  const m = text.match(/^(?:(\d{1,2}):)?(\d{1,3}):(\d{1,2})$/);
  return m ? (Number(m[1]) || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

async function kopiereDokument(dok, eintragId, umg) {
  const name = String(dok.filename || 'datei').replace(/[^\w.\-]+/g, '_').slice(-80);
  const ziel = 'dokumente/' + eintragId + '-' + name;
  try {
    let r = await fetch(dok.url, { headers: { Authorization: 'Bearer ' + umg.netlify } });
    if (!r.ok) r = await fetch(dok.url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const puffer = Buffer.from(await r.arrayBuffer());
    if (puffer.length > 15 * 1024 * 1024) throw new Error('Datei größer als 15 MB');
    await schreibeDatei(ziel, puffer, 'Dokument zu Eintrag ' + eintragId, null, umg);
    return { titel: dok.filename || 'Dokument', url: ziel };
  } catch (e) {
    return { titel: (dok.filename || 'Dokument') + ' (bei Netlify, Anmeldung nötig)', url: dok.url };
  }
}

/* ---------------------------------------------------- Netlify-Schnittstelle */

async function netlifyApi(pfad, umg, optionen) {
  optionen = optionen || {};
  const r = await fetch('https://api.netlify.com/api/v1' + pfad, {
    method: optionen.method || 'GET',
    headers: { Authorization: 'Bearer ' + umg.netlify, 'Content-Type': 'application/json', 'User-Agent': 'heissluftspeicher-freigabe' }
  });
  if (r.status === 401) throw new Error('Netlify lehnt den NETLIFY_TOKEN ab (HTTP 401). Ist der Schlüssel abgelaufen?');
  if (!r.ok) throw new Error('Netlify-Schnittstelle ' + pfad + ': HTTP ' + r.status);
  if (r.status === 204) return null;
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

async function findeMeldung(id, umg) {
  const formulare = await netlifyApi('/sites/' + umg.siteId + '/forms', umg);
  const form = (formulare || []).find(f => f.name === 'phrase');
  if (!form) throw new Error('Das Formular „phrase“ ist bei Netlify nicht bekannt. Ist die Formularerkennung eingeschaltet (Forms → Enable form detection) und wurde danach neu deployt?');
  for (let seite = 1; seite <= 10; seite++) {
    const liste = await netlifyApi('/forms/' + form.id + '/submissions?per_page=100&page=' + seite, umg);
    if (!Array.isArray(liste) || !liste.length) break;
    const treffer = liste.find(s => s && s.data && s.data.meldung_id === id);
    if (treffer) return treffer;
    if (liste.length < 100) break;
  }
  return null;
}

/* ----------------------------------------------------- GitHub-Schnittstelle */

async function githubApi(pfad, umg, optionen) {
  optionen = optionen || {};
  const r = await fetch('https://api.github.com/repos/' + umg.repo + pfad, {
    method: optionen.method || 'GET',
    headers: { Authorization: 'Bearer ' + umg.github, Accept: 'application/vnd.github+json', 'User-Agent': 'heissluftspeicher-freigabe', 'Content-Type': 'application/json' },
    body: optionen.body
  });
  if (r.status === 404 && (optionen.method || 'GET') === 'GET') return null;
  if (r.status === 401) throw new Error('GitHub lehnt den GITHUB_TOKEN ab (HTTP 401). Ist der Schlüssel abgelaufen?');
  if (!r.ok) { const t = await r.text(); throw new Error('GitHub-Schnittstelle ' + pfad + ': HTTP ' + r.status + ' ' + t.slice(0, 200)); }
  return r.json();
}

async function leseDatei(pfad, umg) {
  const d = await githubApi('/contents/' + pfad + '?ref=' + encodeURIComponent(umg.zweig), umg);
  if (!d || !d.content) return null;
  return { sha: d.sha, text: Buffer.from(String(d.content).replace(/\n/g, ''), 'base64').toString('utf8') };
}

async function schreibeDatei(pfad, puffer, nachricht, sha, umg) {
  const body = { message: nachricht, content: puffer.toString('base64'), branch: umg.zweig };
  if (sha) body.sha = sha;
  return githubApi('/contents/' + pfad, umg, { method: 'PUT', body: JSON.stringify(body) });
}

/* -------------------------------------------------------- Anmeldung, Cookie */

function hmac(schluessel, text) { return createHmac('sha256', schluessel).update(text).digest('hex'); }
function gleich(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
function sitzungsWert(passwort) { return hmac(passwort, 'heissluftspeicher-freigabe-sitzung'); }
function sitzungsCookie(passwort) {
  return 'freigabe_sitzung=' + sitzungsWert(passwort) + '; Path=/freigabe; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000';
}
export function pruefeSitzung(req, passwort) {
  const kekse = req.headers.get('cookie') || '';
  const m = kekse.match(/(?:^|;\s*)freigabe_sitzung=([a-f0-9]{64})/);
  return !!(m && gleich(m[1], sitzungsWert(passwort)));
}

/* ---------------------------------------------------------------- Seiten */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function anmeldeFormular(id, aktion, falsch) {
  return (falsch ? '<p class="fehler">Das Passwort war falsch.</p>' : '<p>Bitte einmalig das Freigabe-Passwort eingeben. Der Browser merkt es sich danach ein Jahr lang.</p>') +
    '<form method="POST" class="formular"><input type="hidden" name="id" value="' + esc(id) + '"><input type="hidden" name="aktion" value="' + esc(aktion) + '">' +
    '<div class="feld"><label for="pw">Passwort</label><input id="pw" name="passwort" type="password" autocomplete="current-password" required autofocus></div>' +
    '<button type="submit" class="knopf gelb">' + (aktion === 'ablehnen' ? 'Anmelden und ablehnen' : 'Anmelden und freigeben') + '</button></form>';
}
function vorschau(e) {
  let h = '<div class="eintrag"><blockquote class="zitat">„' + esc(e.zitat) + '“</blockquote><p class="wer">' + esc(e.wer) + (e.funktion ? ', ' + esc(e.funktion) : '') + '</p>';
  if (e.kontext) h += '<p class="kontext">' + esc(e.kontext) + '</p>';
  if (e.quellen && e.quellen.length) h += '<ul class="quellen">' + e.quellen.map(q => '<li><a href="' + esc(q.url) + '">' + esc(q.titel || q.url) + '</a></li>').join('') + '</ul>';
  if (e.youtube && e.youtube.url) h += '<p>Video: ' + esc(e.youtube.url) + (e.youtube.ende ? ' (Ausschnitt ' + e.youtube.start + ' s bis ' + e.youtube.ende + ' s)' : '') + '</p>';
  if (e.dokumente && e.dokumente.length) h += '<ul class="dokumente">' + e.dokumente.map(d => '<li><a href="/' + esc(d.url).replace(/^\//, '') + '">' + esc(d.titel) + '</a></li>').join('') + '</ul>';
  return h + '</div>';
}
function zurueck() { return '<p><a class="knopf" href="/#zaehler">Zur Webseite</a></p>'; }
function seite(status, titel, inhalt, cookie) {
  const html = '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>' + esc(titel) + ' – Heißluftspeicher</title><link rel="stylesheet" href="/css/stil.css"></head>' +
    '<body><header class="kopf"><a class="marke" href="/">Heißluft<span>speicher</span></a></header><main class="seite"><h1>' + esc(titel) + '</h1>' + inhalt + '</main></body></html>';
  const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };
  if (cookie) headers['Set-Cookie'] = cookie;
  return new Response(html, { status: status, headers: headers });
}
