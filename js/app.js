/* Heißluftspeicher – Programmlogik
   Lädt die Daten aus dem Ordner daten/, berechnet die Rechnung, zeichnet Verlauf,
   zählt herunter, zeigt freigegebene Einträge und das Bingo. Keine Abhängigkeiten. */

(function () {
  'use strict';

  // Beginn der Heizsaison: 1. November 2026, 0 Uhr deutscher Zeit (dann gilt Winterzeit, UTC+1).
  var ZIEL_HEIZSAISON = new Date('2026-11-01T00:00:00+01:00');
  var TAG = 86400000;

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function setText(s, t) { var el = $(s); if (el) el.textContent = t; }

  function fmtZahl(n, stellen) {
    return Number(n).toLocaleString('de-DE', { minimumFractionDigits: stellen || 0, maximumFractionDigits: stellen || 0 });
  }
  function fmtDatum(iso) {
    if (!iso) return '';
    var d = new Date(String(iso).length > 10 ? iso : iso + 'T00:00:00');
    if (isNaN(d)) return String(iso);
    return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function sichererLink(url) { return /^https?:\/\//i.test(String(url)) || /^dokumente\//.test(String(url)) ? String(url) : '#'; }
  function plural(n, ein, viele) { return fmtZahl(n) + ' ' + (n === 1 ? ein : viele); }

  // "1:23:45", "12:34" oder "754" -> Sekunden. Ungültiges -> null.
  function zeitInSekunden(text) {
    if (text == null) return null;
    text = String(text).trim();
    if (!text) return null;
    if (/^\d+$/.test(text)) return Number(text);
    var m = text.match(/^(?:(\d{1,2}):)?(\d{1,3}):(\d{1,2})$/);
    if (!m) return null;
    return (Number(m[1]) || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
  // Sekunden -> "12:34" oder "1:02:03"
  function sekundenInZeit(sek) {
    sek = Math.max(0, Math.floor(Number(sek) || 0));
    var h = Math.floor(sek / 3600), m = Math.floor((sek % 3600) / 60), s = sek % 60;
    var ms = (h ? String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
    return h ? h + ':' + ms : ms;
  }

  function ladeJson(pfad) {
    return fetch(pfad, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(pfad + ' konnte nicht geladen werden (HTTP ' + r.status + ')');
      return r.json();
    });
  }

  /* ---------------------------------------------------------------- Lage */

  function ladeLage() {
    var lage;
    return ladeJson('daten/lage.json')
      .then(function (l) {
        lage = l;
        // Optional: aktueller Wert über die Netlify-Funktion (nur wenn AGSI_API_KEY gesetzt ist).
        return fetch('/.netlify/functions/speicherstand').then(function (r) {
          return r.ok ? r.json() : null;
        }).catch(function () { return null; });
      })
      .then(function (live) {
        if (live && typeof live.prozent === 'number' && live.prozent > 0 && live.prozent <= 100) {
          lage.fuellstand_prozent = live.prozent;
          if (live.datum) lage.stand_datum = live.datum;
          if (live.arbeitsgas_twh > 0) lage.arbeitsgas_twh = live.arbeitsgas_twh;
          if (typeof live.trend_pp_tag === 'number') lage.einspeicherung_aktuell_pp_tag = live.trend_pp_tag;
          lage.automatisch = true;
        }
        zeigeLage(lage);
        return lage;
      })
      .catch(function (e) {
        var el = $('#rechnung-liste');
        if (el) el.innerHTML = '<p class="fehler">Die Lagedaten konnten nicht geladen werden. Prüfen Sie die Datei daten/lage.json. (' + esc(e.message) + ')</p>';
        return null;
      });
  }

  function zeigeLage(lage) {
    var p = Number(lage.fuellstand_prozent);
    var ziel = Number(lage.ziel_prozent || 80);
    var vorjahr = Number(lage.vorjahr_prozent);
    var arbeitsgas = Number(lage.arbeitsgas_twh);
    var zielDatum = new Date((lage.ziel_datum || '2026-11-01') + 'T00:00:00');
    var heute = new Date();
    var tageBisZiel = Math.max(0, Math.ceil((zielDatum - heute) / TAG));
    var luecke = Math.max(0, ziel - p);
    var lueckeTwh = luecke / 100 * arbeitsgas;
    var proTag = tageBisZiel > 0 ? luecke / tageBisZiel : 0;

    // Held
    setText('#held-prozent', fmtZahl(p, 1));
    setText('#held-ziel', fmtZahl(ziel));
    setText('#held-datum', fmtDatum(lage.stand_datum) + (lage.automatisch ? ' (täglich automatisch abgerufen)' : ''));
    var q = $('#held-quelle');
    if (q && lage.quelle_url) { q.href = lage.quelle_url; q.textContent = lage.quelle_name || lage.quelle_url; }

    // Tank
    var h = 212 * Math.min(100, Math.max(0, p)) / 100;
    var f = $('#gas-fuellung');
    if (f) { f.setAttribute('height', h.toFixed(1)); f.setAttribute('y', (236 - h).toFixed(1)); }
    setText('#gas-wert', fmtZahl(p, 1));
    setzeMarke('#gas-ziel-marke', ziel);
    setText('#gas-ziel-text', fmtZahl(ziel));
    if (isFinite(vorjahr) && vorjahr > 0) {
      setzeMarke('#gas-vorjahr-marke', vorjahr);
      setText('#gas-vorjahr-text', fmtZahl(vorjahr));
    } else {
      var vm = $('#gas-vorjahr-marke'); if (vm) vm.style.display = 'none';
    }

    // Rechnung
    var zeilen = [
      { t: 'Füllstand heute', w: fmtZahl(p, 1) + ' %',
        k: 'etwa ' + fmtZahl(p / 100 * arbeitsgas) + ' von ' + fmtZahl(arbeitsgas) + ' Terawattstunden Speicherkapazität' },
      { t: 'Vorgabe zum ' + fmtDatum(lage.ziel_datum), w: fmtZahl(ziel) + ' %',
        k: 'gesetzlich festgelegt in der Gasspeicherfüllstandsverordnung' },
      { t: 'Es fehlen', w: fmtZahl(luecke, 1) + ' Prozentpunkte',
        k: 'etwa ' + fmtZahl(lueckeTwh) + ' Terawattstunden Erdgas', warnung: luecke > 0 },
      { t: 'Verbleibende Tage', w: fmtZahl(tageBisZiel), k: 'bis zur Vorgabe am ' + fmtDatum(lage.ziel_datum) }
    ];
    if (luecke > 0 && tageBisZiel > 0) {
      var vergleich = '';
      if (typeof lage.einspeicherung_aktuell_pp_tag === 'number') {
        vergleich = 'tatsächlich zuletzt ' + fmtZahl(lage.einspeicherung_aktuell_pp_tag, 2) + ' Prozentpunkte pro Tag';
      } else if (lage.einspeicherung_bisher_pp_tag) {
        vergleich = 'tatsächlich im Sommer zeitweise nur rund ' + fmtZahl(lage.einspeicherung_bisher_pp_tag, 1) + ' Prozentpunkte pro Tag';
      }
      zeilen.push({ t: 'Nötig ab heute, jeden Tag', w: fmtZahl(proTag, 2) + ' Prozentpunkte', k: vergleich, warnung: true });
    }
    if (isFinite(vorjahr) && vorjahr > 0) {
      zeilen.push({ t: 'Vor einem Jahr', w: fmtZahl(vorjahr, 1) + ' %',
        k: 'am ' + fmtDatum(lage.vorjahr_datum) + ', also ' + fmtZahl(vorjahr - p, 1) + ' Prozentpunkte mehr als heute' });
    }
    var dl = $('#rechnung-liste');
    if (dl) {
      dl.innerHTML = zeilen.map(function (z) {
        return '<div' + (z.warnung ? ' class="warnung"' : '') + '><dt>' + esc(z.t) + '</dt><dd>' + esc(z.w) +
          (z.k ? '<small>' + esc(z.k) + '</small>' : '') + '</dd></div>';
      }).join('');
    }
    if (lage.hinweis) {
      var hi = $('#countdown-hinweis');
      if (hi && !lage.hinweis_aus) hi.textContent = lage.hinweis;
    }
  }

  function setzeMarke(sel, prozent) {
    var g = $(sel); if (!g) return;
    var y = 236 - 212 * Math.min(100, Math.max(0, prozent)) / 100;
    var line = g.querySelector('line'); var text = g.querySelector('text');
    if (line) { line.setAttribute('y1', y.toFixed(1)); line.setAttribute('y2', y.toFixed(1)); }
    if (text) text.setAttribute('y', (y + 4).toFixed(1));
  }

  /* ------------------------------------------------------------- Verlauf */

  function ladeVerlauf(ziel) {
    return ladeJson('daten/verlauf.json').then(function (v) { zeichneVerlauf(v, ziel); }).catch(function () {
      var el = $('#verlauf-diagramm'); if (el) el.innerHTML = '';
    });
  }

  function zeichneVerlauf(verlauf, ziel) {
    var punkte = (verlauf.punkte || []).filter(function (x) { return x.datum && isFinite(x.prozent); })
      .sort(function (a, b) { return String(a.datum).localeCompare(String(b.datum)); });
    var ziel_el = $('#verlauf-diagramm');
    if (!ziel_el || punkte.length < 2) return;

    var B = 640, H = 280, L = 44, R = 16, O = 20, U = 36;
    var t0 = new Date(punkte[0].datum + 'T00:00:00');
    var t1 = new Date(punkte[punkte.length - 1].datum + 'T00:00:00');
    var x = function (t) { return L + (t - t0) / (t1 - t0) * (B - L - R); };
    var y = function (v) { return O + (100 - v) / 100 * (H - O - U); };

    var s = '<svg viewBox="0 0 ' + B + ' ' + H + '" role="img" aria-label="Verlauf des Füllstands der deutschen Gasspeicher">';
    [0, 25, 50, 75, 100].forEach(function (v) {
      s += '<line class="gitter" x1="' + L + '" x2="' + (B - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>' +
        '<text class="achse" x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v + ' %</text>';
    });
    s += '<line class="ziel-linie" x1="' + L + '" x2="' + (B - R) + '" y1="' + y(ziel) + '" y2="' + y(ziel) + '"/>' +
      '<text class="ziel-text" x="' + (B - R) + '" y="' + (y(ziel) - 6) + '" text-anchor="end">Vorgabe zum 1. November: ' + ziel + ' %</text>';

    var pfad = punkte.map(function (pt, i) {
      return (i ? 'L' : 'M') + x(new Date(pt.datum + 'T00:00:00')).toFixed(1) + ' ' + y(pt.prozent).toFixed(1);
    }).join(' ');
    s += '<path class="flaeche" d="' + pfad + ' L' + x(t1).toFixed(1) + ' ' + y(0) + ' L' + x(t0).toFixed(1) + ' ' + y(0) + ' Z"/>';
    s += '<path class="linie" d="' + pfad + '"/>';

    // Monatsmarken
    var m = new Date(t0.getFullYear(), t0.getMonth() + 1, 1);
    while (m <= t1) {
      var bez = m.toLocaleDateString('de-DE', m.getMonth() === 0 ? { month: 'short', year: '2-digit' } : { month: 'short' });
      s += '<text class="achse" x="' + x(m).toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle">' + esc(bez) + '</text>';
      m = new Date(m.getFullYear(), m.getMonth() + 1, 1);
    }
    punkte.forEach(function (pt) {
      s += '<circle class="punkt" cx="' + x(new Date(pt.datum + 'T00:00:00')).toFixed(1) + '" cy="' + y(pt.prozent).toFixed(1) + '" r="3.5">' +
        '<title>' + esc(fmtDatum(pt.datum) + ': ' + fmtZahl(pt.prozent, 1) + ' %') + '</title></circle>';
    });
    var letzter = punkte[punkte.length - 1];
    s += '<text class="letzter" x="' + (x(t1) - 8).toFixed(1) + '" y="' + (y(letzter.prozent) - 10).toFixed(1) + '" text-anchor="end">' +
      fmtZahl(letzter.prozent, 1) + ' %</text>';
    s += '</svg>';
    ziel_el.innerHTML = s;
    setText('#verlauf-quelle', verlauf.quelle || '');
  }

  /* ----------------------------------------------------------- Countdown */

  function neuerMonat(d) {
    var n = new Date(d); var tag = n.getDate();
    n.setDate(1); n.setMonth(n.getMonth() + 1);
    var max = new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate();
    n.setDate(Math.min(tag, max));
    return n;
  }
  function differenz(von, bis) {
    var monate = 0; var lauf = new Date(von);
    for (;;) { var n = neuerMonat(lauf); if (n <= bis) { lauf = n; monate++; } else break; }
    var rest = bis - lauf;
    var wochen = Math.floor(rest / (7 * TAG)); rest -= wochen * 7 * TAG;
    var tage = Math.floor(rest / TAG); rest -= tage * TAG;
    var stunden = Math.floor(rest / 3600000); rest -= stunden * 3600000;
    var minuten = Math.floor(rest / 60000); rest -= minuten * 60000;
    var sekunden = Math.floor(rest / 1000);
    return { monate: monate, wochen: wochen, tage: tage, stunden: stunden, minuten: minuten, sekunden: sekunden };
  }
  function tick() {
    var jetzt = new Date(); var wrap = $('#zeit'); if (!wrap) return;
    if (jetzt >= ZIEL_HEIZSAISON) {
      var tage = Math.floor((jetzt - ZIEL_HEIZSAISON) / TAG);
      setText('#countdown-titel', 'Die Heizsaison hat begonnen');
      wrap.hidden = true;
      setText('#countdown-hinweis', 'Seit ' + plural(tage, 'Tag', 'Tagen') + ' wird geheizt. Der Füllstand oben zeigt, womit.');
      return;
    }
    var d = differenz(jetzt, ZIEL_HEIZSAISON);
    Object.keys(d).forEach(function (k) {
      var el = wrap.querySelector('[data-einheit="' + k + '"]');
      if (el) el.textContent = (k === 'stunden' || k === 'minuten' || k === 'sekunden') ? String(d[k]).padStart(2, '0') : String(d[k]);
    });
  }

  /* ------------------------------------------------------------ Einträge */

  var alleEintraege = [];

  function ladeEintraege() {
    return ladeJson('daten/eintraege.json').then(function (daten) {
      alleEintraege = (Array.isArray(daten) ? daten : (daten.eintraege || [])).filter(function (e) { return e && e.zitat && e.wer; });
      alleEintraege.sort(function (a, b) { return String(b.datum || '').localeCompare(String(a.datum || '')); });
      setText('#zaehler-anzahl', fmtZahl(alleEintraege.length));
      setText('#tank-anzahl', plural(alleEintraege.length, 'Phrase erfasst', 'Phrasen erfasst'));

      var kats = []; alleEintraege.forEach(function (e) { if (e.kategorie && kats.indexOf(e.kategorie) < 0) kats.push(e.kategorie); });
      kats.sort();
      var sel = $('#filter-kategorie');
      if (sel) {
        kats.forEach(function (k) {
          var o = document.createElement('option'); o.value = k;
          o.textContent = k + ' (' + alleEintraege.filter(function (e) { return e.kategorie === k; }).length + ')';
          sel.appendChild(o);
        });
        sel.addEventListener('change', zeigeEintraege);
      }
      var sort = $('#sortierung'); if (sort) sort.addEventListener('change', zeigeEintraege);
      zeigeEintraege();
    }).catch(function (e) {
      var el = $('#eintraege');
      if (el) el.innerHTML = '<p class="fehler">Die Liste konnte nicht geladen werden. Prüfen Sie daten/eintraege.json auf fehlende Kommas oder Anführungszeichen. (' + esc(e.message) + ')</p>';
    });
  }

  function sortiere(liste, modus) {
    var feld = modus.indexOf('eingereicht') === 0 ? 'eingereicht' : 'datum';
    var neuesteZuerst = modus.indexOf('-neu') > 0;
    return liste.slice().sort(function (a, b) {
      var x = String(a[feld] || ''), y = String(b[feld] || '');
      if (x === y) return String(b.datum || '').localeCompare(String(a.datum || ''));
      if (!x) return 1; if (!y) return -1; // Einträge ohne Datum ans Ende
      return neuesteZuerst ? y.localeCompare(x) : x.localeCompare(y);
    });
  }

  function zeigeEintraege() {
    var katSel = $('#filter-kategorie'); var kat = katSel ? katSel.value : '';
    var sortSel = $('#sortierung'); var modus = sortSel ? sortSel.value : 'gesagt-neu';
    var liste = kat ? alleEintraege.filter(function (e) { return e.kategorie === kat; }) : alleEintraege;
    liste = sortiere(liste, modus);
    var ziel = $('#eintraege'); if (!ziel) return;
    if (!liste.length) {
      ziel.innerHTML = '<p class="leer">Noch keine Phrase freigegeben. Sie kennen eine? <a href="#melden">Melden Sie sie.</a></p>';
      return;
    }
    ziel.innerHTML = liste.map(baueEintrag).join('');
    $$('.video button', ziel).forEach(function (b) { b.addEventListener('click', ladeVideo); });
  }

  function baueEintrag(e, i) {
    var id = 'eintrag-' + (e.id != null ? String(e.id).replace(/[^\w-]/g, '') : (i + 1));
    var yt = youtubeDaten(e.youtube);
    var quellen = (e.quellen || []).filter(function (q) { return q && q.url; });
    var doks = (e.dokumente || []).filter(function (d) { return d && d.url; });
    var html = '<article class="eintrag" id="' + id + '">';
    html += '<div class="eintrag-kopf">' + (e.kategorie ? '<span class="etikett">' + esc(e.kategorie) + '</span>' : '<span></span>') +
      '<span class="eintrag-daten">' +
      (e.datum ? '<span>Gesagt am <time datetime="' + esc(e.datum) + '">' + esc(fmtDatum(e.datum)) + '</time></span>' : '') +
      (e.eingereicht ? '<span>Eingereicht am <time datetime="' + esc(e.eingereicht) + '">' + esc(fmtDatum(e.eingereicht)) + '</time></span>' : '') +
      '</span></div>';
    html += '<blockquote class="zitat">„' + esc(e.zitat) + '“' + (e.sinngemaess ? ' <small>(sinngemäß)</small>' : '') + '</blockquote>';
    html += '<p class="wer">' + esc(e.wer) + (e.funktion ? ', ' + esc(e.funktion) : '') + '</p>';
    if (e.kontext) html += '<p class="kontext">' + esc(e.kontext) + '</p>';
    if (quellen.length) {
      html += '<p class="listen-titel">Belege</p><ul class="quellen">' + quellen.map(function (q) {
        return '<li><a href="' + esc(sichererLink(q.url)) + '" target="_blank" rel="noopener">' + esc(q.titel || q.url) + '</a></li>';
      }).join('') + '</ul>';
    }
    if (yt) {
      var bereich = yt.ende ? ' Gezeigt wird der Ausschnitt von ' + sekundenInZeit(yt.start) + ' bis ' + sekundenInZeit(yt.ende) + '.'
        : (yt.start ? ' Das Video startet bei ' + sekundenInZeit(yt.start) + '.' : '');
      html += '<div class="video" data-id="' + esc(yt.id) + '" data-start="' + yt.start + '" data-ende="' + yt.ende + '">' +
        '<button type="button" class="knopf klein">Videoausschnitt von YouTube laden</button>' +
        '<span class="hilfe">Erst nach dem Klick werden Daten an YouTube (Google) übertragen.' + bereich + '</span></div>';
    }
    if (doks.length) {
      html += '<p class="listen-titel">Dokumente</p><ul class="dokumente">' + doks.map(function (d) {
        return '<li><a href="' + esc(sichererLink(d.url)) + '" target="_blank" rel="noopener">' + esc(d.titel || d.url) + '</a></li>';
      }).join('') + '</ul>';
    }
    html += '<p class="direktlink"><a href="#' + id + '">Direktlink zu diesem Eintrag</a></p></article>';
    return html;
  }

  // Nimmt eine Adresse (Text) oder ein Objekt { url, id, start, ende } und liefert { id, start, ende } oder null.
  function youtubeDaten(y) {
    if (!y) return null;
    var url = typeof y === 'string' ? y : (y.url || ''); var id = typeof y === 'object' && y.id ? y.id : '';
    var start = typeof y === 'object' && y.start ? Number(y.start) : 0;
    var ende = typeof y === 'object' && y.ende ? Number(y.ende) : 0;
    if (!id && url) {
      var m = url.match(/youtu\.be\/([\w-]{11})/) || url.match(/[?&]v=([\w-]{11})/) ||
        url.match(/\/shorts\/([\w-]{11})/) || url.match(/\/embed\/([\w-]{11})/) || url.match(/\/live\/([\w-]{11})/);
      if (m) id = m[1];
      var t = url.match(/[?&#](?:t|start)=(\d+)(?:s)?/);
      if (t && !start) start = Number(t[1]);
    }
    if (!/^[\w-]{11}$/.test(id)) return null;
    start = Math.max(0, Math.floor(start || 0)); ende = Math.max(0, Math.floor(ende || 0));
    if (ende && ende <= start) ende = 0;
    return { id: id, start: start, ende: ende };
  }

  // Video-Kennung aus einer Adresse holen (für das Formular).
  function youtubeId(url) { var d = youtubeDaten(url); return d ? d.id : ''; }

  function ladeVideo(ev) {
    var box = ev.currentTarget.closest('.video'); if (!box) return;
    var id = box.getAttribute('data-id'); var start = Number(box.getAttribute('data-start')) || 0;
    var ende = Number(box.getAttribute('data-ende')) || 0;
    if (!/^[\w-]{11}$/.test(id)) return;
    var src = 'https://www.youtube-nocookie.com/embed/' + id + '?start=' + start + (ende ? '&end=' + ende : '') + '&autoplay=1&rel=0';
    box.innerHTML = '<iframe src="' + src + '" title="YouTube-Video" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe>';
  }

  /* --------------------------------------------------------------- Bingo */

  function mische(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  function ladeBingo() {
    var raster = $('#bingo-raster'); if (!raster) return;
    return ladeJson('daten/bingo.json').then(function (phrasen) {
      if (!Array.isArray(phrasen) || phrasen.length < 16) { raster.innerHTML = '<p class="fehler">daten/bingo.json braucht mindestens 16 Phrasen.</p>'; return; }
      function neu() {
        var auswahl = mische(phrasen.slice()).slice(0, 16);
        raster.innerHTML = auswahl.map(function (p) { return '<button type="button" aria-pressed="false">' + esc(p) + '</button>'; }).join('');
        setText('#bingo-meldung', '');
        $$('button', raster).forEach(function (b) {
          b.addEventListener('click', function () {
            b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
            pruefe();
          });
        });
      }
      function pruefe() {
        var z = $$('button', raster).map(function (b) { return b.getAttribute('aria-pressed') === 'true'; });
        var linien = [];
        for (var i = 0; i < 4; i++) {
          linien.push([0, 1, 2, 3].map(function (j) { return i * 4 + j; }));
          linien.push([0, 1, 2, 3].map(function (j) { return j * 4 + i; }));
        }
        linien.push([0, 5, 10, 15], [3, 6, 9, 12]);
        var treffer = linien.some(function (l) { return l.every(function (i) { return z[i]; }); });
        setText('#bingo-meldung', treffer ? 'Bingo. Der Heißluftspeicher ist voll. Der Gasspeicher nicht.' : '');
      }
      var knopf = $('#bingo-neu'); if (knopf) knopf.addEventListener('click', neu);
      neu();
    }).catch(function () { raster.innerHTML = ''; });
  }

  /* ------------------------------------------------------------ Formular */

  function richteFormularEin() {
    var form = $('#melde-formular'); if (!form) return;
    var heute = new Date();
    var ein = $('#f-eingereicht');
    if (ein) ein.value = heute.getFullYear() + '-' + String(heute.getMonth() + 1).padStart(2, '0') + '-' + String(heute.getDate()).padStart(2, '0');
    richteSchneidenEin();
    var datei = $('#f-dokument');
    if (datei) {
      datei.addEventListener('change', function () {
        var f = datei.files && datei.files[0];
        if (f && f.size > 10 * 1024 * 1024) {
          alert('Die Datei ist größer als 10 MB. Bitte verkleinern oder stattdessen einen Link angeben.');
          datei.value = '';
        }
      });
    }
    form.addEventListener('submit', function (ev) {
      var link = $('#f-youtube').value.trim();
      var start = zeitInSekunden($('#f-youtube-start').value), ende = zeitInSekunden($('#f-youtube-ende').value);
      var fehler = '';
      if (link && !youtubeId(link)) fehler = 'Der YouTube-Link wurde nicht erkannt. Bitte den Link aus der Adresszeile des Browsers kopieren.';
      else if ($('#f-youtube-start').value.trim() && start === null) fehler = 'Bitte „Ausschnitt ab“ als Minuten:Sekunden angeben, zum Beispiel 12:34.';
      else if ($('#f-youtube-ende').value.trim() && ende === null) fehler = 'Bitte „Ausschnitt bis“ als Minuten:Sekunden angeben, zum Beispiel 13:10.';
      else if (start !== null && ende !== null && ende <= start) fehler = 'Das Ende des Ausschnitts muss nach dem Start liegen.';
      if (fehler) { ev.preventDefault(); alert(fehler); return; }
      var k = $('#melde-knopf'); if (k) { k.disabled = true; k.textContent = 'Wird gesendet …'; }
    });
  }

  /* ------------------------------------------------- Video zuschneiden */

  var ytApi = null; // Promise, die den YouTube-Abspieler bereitstellt
  var spieler = null; var spielerId = '';

  function ladeYoutubeApi() {
    if (ytApi) return ytApi;
    ytApi = new Promise(function (resolve, reject) {
      if (window.YT && window.YT.Player) return resolve(window.YT);
      var vorher = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () { if (vorher) vorher(); resolve(window.YT); };
      var s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = function () { ytApi = null; reject(new Error('Der Abspieler von YouTube konnte nicht geladen werden.')); };
      document.head.appendChild(s);
    });
    return ytApi;
  }

  function richteSchneidenEin() {
    var laden = $('#schneiden-laden'); if (!laden) return;
    var anzeige = $('#schneiden-anzeige');
    function melde(t) { if (anzeige) anzeige.textContent = t; }

    laden.addEventListener('click', function () {
      var id = youtubeId($('#f-youtube').value.trim());
      if (!id) { alert('Bitte zuerst einen YouTube-Link eintragen.'); $('#f-youtube').focus(); return; }
      laden.disabled = true; laden.textContent = 'Abspieler wird geladen …';
      ladeYoutubeApi().then(function (YT) {
        $('#schneiden-spieler').hidden = false; $('#schneiden-knoepfe').hidden = false;
        var start = zeitInSekunden($('#f-youtube-start').value) || 0;
        if (spieler) { spieler.cueVideoById({ videoId: id, startSeconds: start }); spielerId = id; laden.hidden = true; return; }
        spieler = new YT.Player('schneiden-spieler-innen', {
          videoId: id, host: 'https://www.youtube-nocookie.com',
          playerVars: { start: start, rel: 0, modestbranding: 1 },
          events: { onReady: function () { spielerId = id; laden.hidden = true; melde('Video an die gewünschte Stelle spulen, dann Start und Ende setzen.'); } }
        });
      }).catch(function (e) { laden.disabled = false; laden.textContent = 'Video zum Zuschneiden laden'; alert(e.message); });
    });

    // Wird der Link geändert, das neue Video in den vorhandenen Abspieler laden.
    $('#f-youtube').addEventListener('change', function () {
      var id = youtubeId($('#f-youtube').value.trim());
      if (spieler && id && id !== spielerId) { spieler.cueVideoById({ videoId: id }); spielerId = id; }
    });

    function aktuell() { return spieler && spieler.getCurrentTime ? Math.floor(spieler.getCurrentTime()) : null; }
    $('#schneiden-start').addEventListener('click', function () {
      var t = aktuell(); if (t === null) return;
      $('#f-youtube-start').value = sekundenInZeit(t);
      var ende = zeitInSekunden($('#f-youtube-ende').value);
      if (ende !== null && ende <= t) $('#f-youtube-ende').value = '';
      melde('Start gesetzt auf ' + sekundenInZeit(t) + '.');
    });
    $('#schneiden-ende').addEventListener('click', function () {
      var t = aktuell(); if (t === null) return;
      var start = zeitInSekunden($('#f-youtube-start').value) || 0;
      if (t <= start) { melde('Das Ende muss nach dem Start (' + sekundenInZeit(start) + ') liegen.'); return; }
      $('#f-youtube-ende').value = sekundenInZeit(t);
      melde('Ausschnitt: ' + sekundenInZeit(start) + ' bis ' + sekundenInZeit(t) + ' (' + (t - start) + ' Sekunden).');
    });
    $('#schneiden-pruefen').addEventListener('click', function () {
      if (!spieler) return;
      var start = zeitInSekunden($('#f-youtube-start').value) || 0;
      var ende = zeitInSekunden($('#f-youtube-ende').value);
      var opt = { videoId: spielerId, startSeconds: start };
      if (ende !== null && ende > start) opt.endSeconds = ende;
      spieler.loadVideoById(opt);
      melde(ende ? 'Spielt den Ausschnitt ' + sekundenInZeit(start) + ' bis ' + sekundenInZeit(ende) + ' ab.' : 'Spielt ab ' + sekundenInZeit(start) + ' (kein Ende gesetzt).');
    });
  }

  /* --------------------------------------------------------------- Start */

  document.addEventListener('DOMContentLoaded', function () {
    tick(); setInterval(tick, 1000);
    ladeLage().then(function (lage) { ladeVerlauf(lage ? Number(lage.ziel_prozent || 80) : 80); });
    ladeEintraege();
    ladeBingo();
    richteFormularEin();
  });
})();
