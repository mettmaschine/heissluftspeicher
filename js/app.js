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

  function naechsterTag(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1); }
  function nurDatum(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

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
    setText('#held-kicker-prozent', fmtZahl(p, 1));
    setText('#held-ziel', fmtZahl(ziel));
    if (document.body.getAttribute('data-titel') === 'fuellstand') {
      document.title = 'Gasspeicherfüllstand heute: ' + fmtZahl(p, 1) + ' % (Stand ' + fmtDatum(lage.stand_datum) + ') – Heißluftspeicher';
    }
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
    if (lage.strom) {
      setText('#strom-kraftwerke', fmtZahl(lage.strom.gaskraftwerke_gw || 35));
      setText('#strom-spitze', fmtZahl(lage.strom.gasstrom_spitze_gw || 20));
      setText('#strom-spitze-2', fmtZahl(lage.strom.gasstrom_spitze_gw || 20));
      setText('#strom-speicheranteil', fmtZahl(lage.strom.speicheranteil_januar_prozent || 38));
      setText('#strom-druckgrenze', fmtZahl(lage.strom.druckgrenze_prozent || 50));
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

  // Monotone kubische Interpolation (Fritsch–Carlson): glatte Kurve durch die Messpunkte,
  // ohne Überschwinger, also ohne erfundene Zwischenhochs oder -tiefs.
  function interpolator(pts) {
    var n = pts.length;
    if (n < 2) return function () { return n ? pts[0].v : 0; };
    var xs = pts.map(function (p) { return +p.t; }), ys = pts.map(function (p) { return p.v; });
    var d = [], m = [], i;
    for (i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (i = 1; i < n - 1; i++) m[i] = (d[i - 1] * d[i] <= 0) ? 0 : (d[i - 1] + d[i]) / 2;
    for (i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      var a = m[i] / d[i], b = m[i + 1] / d[i], q = a * a + b * b;
      if (q > 9) { var tau = 3 / Math.sqrt(q); m[i] = tau * a * d[i]; m[i + 1] = tau * b * d[i]; }
    }
    return function (t) {
      t = +t;
      if (t <= xs[0]) return ys[0];
      if (t >= xs[n - 1]) return ys[n - 1];
      var lo = 0, hi = n - 1;
      while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (xs[mid] <= t) lo = mid; else hi = mid; }
      var h = xs[hi] - xs[lo], u = (t - xs[lo]) / h;
      return (1 + 2 * u) * (1 - u) * (1 - u) * ys[lo] + u * (1 - u) * (1 - u) * h * m[lo] + u * u * (3 - 2 * u) * ys[hi] + u * u * (u - 1) * h * m[hi];
    };
  }

  // Glatter SVG-Pfad durch Punkte {t, v}; x und y sind die Achsenfunktionen.
  function glattPfad(pts, x, y) {
    if (pts.length < 2) return '';
    var f = interpolator(pts), t0 = +pts[0].t, t1 = +pts[pts.length - 1].t;
    var schritt = Math.max(TAG / 2, (t1 - t0) / 500), teile = [];
    for (var t = t0; t < t1; t += schritt) teile.push(x(new Date(t)).toFixed(1) + ' ' + y(f(t)).toFixed(1));
    teile.push(x(new Date(t1)).toFixed(1) + ' ' + y(f(t1)).toFixed(1));
    return 'M' + teile.join(' L');
  }

  function zuPunkten(liste) {
    return (liste || []).filter(function (x) { return x.datum && isFinite(x.prozent); })
      .map(function (x) { return { t: new Date(String(x.datum).slice(0, 10) + 'T00:00:00'), v: Number(x.prozent) }; })
      .filter(function (p) { return !isNaN(p.t); })
      .sort(function (a, b) { return a.t - b.t; });
  }

  function ladeVerlauf(lage) {
    var ziel = lage ? Number(lage.ziel_prozent || 80) : 80;
    var verlauf;
    return ladeJson('daten/verlauf.json').then(function (v) {
      verlauf = v;
      // Optional: tägliche Werte über die Netlify-Funktion (nur mit AGSI_API_KEY).
      return fetch('/.netlify/functions/verlauf').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    }).then(function (live) {
      if (live && Array.isArray(live.punkte) && live.punkte.length >= 60 && verlauf.punkte && verlauf.punkte.length) {
        var start = String(verlauf.punkte.map(function (p) { return p.datum; }).sort()[0]).slice(0, 10);
        var startVorjahr = (Number(start.slice(0, 4)) - 1) + start.slice(4);
        var aktuell = live.punkte.filter(function (p) { return p.datum >= start; });
        // Die Vorjahreslinie reicht bis zum gleichen Kalendertag wie der letzte aktuelle Wert (ein Jahr früher),
        // damit „Vorjahr“ im Diagramm und „Vor einem Jahr“ in der Rechnung dieselbe Zahl zeigen.
        var letzterAktuell = aktuell.length ? aktuell[aktuell.length - 1].datum : start;
        var endeVorjahr = (Number(letzterAktuell.slice(0, 4)) - 1) + letzterAktuell.slice(4);
        var vorjahr = live.punkte.filter(function (p) { return p.datum >= startVorjahr && p.datum <= endeVorjahr; });
        if (aktuell.length >= 30) {
          verlauf.punkte = aktuell;
          if (vorjahr.length >= 30) verlauf.vorjahr = vorjahr;
          verlauf.quelle = (live.quelle || 'GIE AGSI+, Tageswerte') + '. ' + (verlauf.quelle || '');
          verlauf.taeglich = true;
        }
      }
      if (lage && verlauf.taeglich) aktualisiereVorjahr(lage, verlauf);
      zeichneVerlauf(verlauf, ziel, lage || {});
      if (lage) { zeichneBedarf(verlauf, lage); ladeRisiko(verlauf, lage); }
    }).catch(function () {
      var el = $('#verlauf-diagramm'); if (el) el.innerHTML = '';
    });
  }

  // Vergleichswert von genau vor einem Jahr aus den Tageswerten holen und die Anzeige neu aufbauen
  function aktualisiereVorjahr(lage, verlauf) {
    var stand = String(lage.stand_datum || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(stand)) return;
    var gesucht = (Number(stand.slice(0, 4)) - 1) + stand.slice(4);
    var alle = (verlauf.vorjahr || []).concat(verlauf.punkte || []);
    var treffer = null, abstand = Infinity;
    alle.forEach(function (p) {
      if (!p.datum || !isFinite(p.prozent)) return;
      var d = Math.abs(new Date(p.datum + 'T00:00:00') - new Date(gesucht + 'T00:00:00')) / TAG;
      if (d < abstand && d <= 3) { abstand = d; treffer = p; }
    });
    if (!treffer) return;
    lage.vorjahr_prozent = Number(treffer.prozent);
    lage.vorjahr_datum = treffer.datum;
    zeigeLage(lage);
  }

  function zeichneVerlauf(verlauf, ziel, lage) {
    var punkte = zuPunkten(verlauf.punkte);
    var ziel_el = $('#verlauf-diagramm');
    if (!ziel_el || punkte.length < 2) return;

    var B = 640, H = 300, L = 44, R = 16, O = 20, U = 36;
    var t0 = punkte[0].t, t1 = punkte[punkte.length - 1].t;
    var x = function (t) { return L + (t - t0) / (t1 - t0) * (B - L - R); };
    var y = function (v) { return O + (100 - v) / 100 * (H - O - U); };

    var s = '<svg viewBox="0 0 ' + B + ' ' + H + '" role="img" aria-label="Verlauf des Füllstands der deutschen Gasspeicher, aktuelle Saison und Vorjahr">';
    // Bereich, in dem Druck und Ausspeicherleistung sinken
    var grenze = lage && lage.strom && isFinite(lage.strom.druckgrenze_prozent) ? Number(lage.strom.druckgrenze_prozent) : 0;
    if (grenze > 0) {
      s += '<rect class="druckzone" x="' + L + '" y="' + y(grenze).toFixed(1) + '" width="' + (B - L - R) + '" height="' + (y(0) - y(grenze)).toFixed(1) + '"/>' +
        '<text class="achse druckzone-text" x="' + (B - R - 6) + '" y="' + (y(0) - 8).toFixed(1) + '" text-anchor="end">unter ' + grenze + ' %: Druck und Ausspeicherleistung sinken</text>';
    }
    for (var v = 0; v <= 100; v += 10) {
      s += '<line class="gitter' + (v % 50 === 0 ? ' stark' : '') + '" x1="' + L + '" x2="' + (B - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>' +
        '<text class="achse" x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v + ' %</text>';
    }
    s += '<line class="ziel-linie" x1="' + L + '" x2="' + (B - R) + '" y1="' + y(ziel) + '" y2="' + y(ziel) + '"/>' +
      '<text class="ziel-text" x="' + (L + 6) + '" y="' + (y(ziel) - 6) + '" text-anchor="start">Vorgabe zum 1. November: ' + ziel + ' %</text>';

    // Stichtagsmarken (z. B. Vorgabe zum 1. Februar)
    (verlauf.marken || []).forEach(function (mk) {
      var t = new Date(String(mk.datum).slice(0, 10) + 'T00:00:00');
      if (isNaN(t) || t < t0 || t > t1 || !isFinite(mk.prozent)) return;
      var b = 12 * TAG;
      s += '<line class="ziel-linie marke" x1="' + x(new Date(t - b)).toFixed(1) + '" x2="' + x(new Date(+t + b)).toFixed(1) + '" y1="' + y(mk.prozent).toFixed(1) + '" y2="' + y(mk.prozent).toFixed(1) + '"/>' +
        '<text class="ziel-text klein" x="' + (x(new Date(t - b)) - 6).toFixed(1) + '" y="' + (y(mk.prozent) + 4).toFixed(1) + '" text-anchor="end">' + esc(mk.text || '') + '</text>';
    });

    var pfad = glattPfad(punkte, x, y);
    s += '<path class="flaeche" d="' + pfad + ' L' + x(t1).toFixed(1) + ' ' + y(0) + ' L' + x(t0).toFixed(1) + ' ' + y(0) + ' Z"/>';

    // Vorjahressaison, um ein Jahr nach vorn verschoben, damit gleiche Kalendertage übereinanderliegen
    var vorjahr = zuPunkten(verlauf.vorjahr).map(function (p) { var d = new Date(p.t); d.setFullYear(d.getFullYear() + 1); return { t: d, v: p.v }; })
      .filter(function (p) { return p.t >= t0 && p.t <= t1; });
    if (vorjahr.length >= 2) {
      s += '<path class="linie vorjahr" d="' + glattPfad(vorjahr, x, y) + '"/>';
      var vl = vorjahr[vorjahr.length - 1];
      s += '<text class="achse vorjahr-text" x="' + (x(vl.t) - 10).toFixed(1) + '" y="' + (y(vl.v) + 18).toFixed(1) + '" text-anchor="end">Vorjahr ' + fmtZahl(vl.v, 1) + ' %</text>';
    }
    s += '<path class="linie" d="' + pfad + '"/>';

    // Monatsmarken
    var m = new Date(t0.getFullYear(), t0.getMonth() + 1, 1);
    while (m <= t1) {
      var bez = m.toLocaleDateString('de-DE', m.getMonth() === 0 ? { month: 'short', year: '2-digit' } : { month: 'short' });
      s += '<text class="achse" x="' + x(m).toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle">' + esc(bez) + '</text>';
      m = new Date(m.getFullYear(), m.getMonth() + 1, 1);
    }
    // Messpunkte nur zeigen, wenn es wenige sind (bei Tageswerten würden sie die Linie verdecken)
    if (punkte.length <= 40) {
      punkte.forEach(function (pt) {
        s += '<circle class="punkt" cx="' + x(pt.t).toFixed(1) + '" cy="' + y(pt.v).toFixed(1) + '" r="3.5"><title>' + esc(fmtDatum(pt.t.toISOString().slice(0, 10)) + ': ' + fmtZahl(pt.v, 1) + ' %') + '</title></circle>';
      });
    }
    // Tiefstand der Saison
    var tief = punkte[0]; punkte.forEach(function (p) { if (p.v < tief.v) tief = p; });
    if (tief !== punkte[punkte.length - 1]) {
      s += '<circle class="punkt tief" cx="' + x(tief.t).toFixed(1) + '" cy="' + y(tief.v).toFixed(1) + '" r="5"/>' +
        '<text class="letzter tief" x="' + x(tief.t).toFixed(1) + '" y="' + (y(tief.v) + 22).toFixed(1) + '" text-anchor="middle">Tiefstand ' + fmtZahl(tief.v, 1) + ' % (' + esc(tief.t.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })) + ')</text>';
    }
    var letzter = punkte[punkte.length - 1];
    var vorjahrWert = vorjahr.length ? vorjahr[vorjahr.length - 1].v : null;
    var unten = vorjahrWert !== null && vorjahrWert > letzter.v; // Vorjahr liegt darüber: eigenen Wert unter die Linie setzen
    s += '<text class="letzter" x="' + (x(t1) - 10).toFixed(1) + '" y="' + (unten ? y(letzter.v) + 22 : y(letzter.v) - 12).toFixed(1) + '" text-anchor="end">heute ' + fmtZahl(letzter.v, 1) + ' %</text>';
    s += '</svg>';
    ziel_el.innerHTML = s;
    setText('#verlauf-quelle', (vorjahr.length >= 2 ? 'Blau: Saison ' + t0.getFullYear() + '/' + String(t1.getFullYear()).slice(2) + '. Grau gestrichelt: die Saison davor, auf dieselben Kalendertage gelegt. ' : '') +
      (verlauf.taeglich ? '' : 'Zwischen den belegten Punkten glatt interpoliert. ') + (verlauf.quelle || ''));
  }

  // Für jeden Tag seit dem Tiefstand: Wie viele Prozentpunkte hätten ab diesem Tag täglich
  // eingespeichert werden müssen, um die Vorgabe noch zu erreichen? Dazu die tatsächliche Einspeicherung.
  function zeichneBedarf(verlauf, lage) {
    var el = $('#bedarf-diagramm'); if (!el) return;
    var ziel = Number(lage.ziel_prozent || 80);
    var zielDatum = new Date((lage.ziel_datum || '2026-11-01') + 'T00:00:00');
    var punkte = zuPunkten(verlauf.punkte);
    var stand = new Date(String(lage.stand_datum || '').slice(0, 10) + 'T00:00:00');
    if (!isNaN(stand) && isFinite(lage.fuellstand_prozent) && (!punkte.length || stand > punkte[punkte.length - 1].t)) {
      punkte.push({ t: stand, v: Number(lage.fuellstand_prozent) });
    }
    var tief = 0; punkte.forEach(function (p, i) { if (p.v < punkte[tief].v) tief = i; });
    punkte = punkte.slice(tief);
    if (punkte.length < 2) { el.innerHTML = ''; return; }

    var heute = new Date(); heute.setHours(0, 0, 0, 0);
    if (heute >= zielDatum) heute = new Date(zielDatum.getTime() - TAG);
    if (heute < punkte[punkte.length - 1].t) heute = punkte[punkte.length - 1].t;

    var fuellstandAm = interpolator(punkte);
    var noetig = [];
    for (var t = nurDatum(punkte[0].t); t <= heute; t = naechsterTag(t)) {
      var rest = Math.round((zielDatum - t) / TAG); if (rest <= 0) break;
      noetig.push({ t: t, w: Math.max(0, (ziel - fuellstandAm(t)) / rest) });
    }
    var ist = [];
    for (var k = 0; k < punkte.length - 1; k++) {
      var d = Math.round((punkte[k + 1].t - punkte[k].t) / TAG);
      if (d > 0) ist.push({ von: punkte[k].t, bis: punkte[k + 1].t, w: (punkte[k + 1].v - punkte[k].v) / d });
    }
    if (!noetig.length) { el.innerHTML = ''; return; }

    var maxW = 0; noetig.forEach(function (p) { maxW = Math.max(maxW, p.w); }); ist.forEach(function (s) { maxW = Math.max(maxW, s.w); });
    var schritt = maxW > 1.2 ? 0.5 : (maxW > 0.6 ? 0.25 : 0.1);
    var yMax = Math.ceil((maxW * 1.15) / schritt) * schritt || schritt;
    var B = 640, H = 280, L = 52, R = 16, O = 20, U = 36;
    var t0 = noetig[0].t, t1 = noetig[noetig.length - 1].t;
    var x = function (t) { return t1 > t0 ? L + (t - t0) / (t1 - t0) * (B - L - R) : L; };
    var y = function (w) { return O + (yMax - w) / yMax * (H - O - U); };

    var s = '<svg viewBox="0 0 ' + B + ' ' + H + '" role="img" aria-label="Nötige und tatsächliche tägliche Einspeicherung in Prozentpunkten">';
    for (var g = 0; g <= yMax + 1e-9; g += schritt) {
      s += '<line class="gitter" x1="' + L + '" x2="' + (B - R) + '" y1="' + y(g).toFixed(1) + '" y2="' + y(g).toFixed(1) + '"/>' +
        '<text class="achse" x="' + (L - 6) + '" y="' + (y(g) + 4).toFixed(1) + '" text-anchor="end">' + fmtZahl(g, 2) + '</text>';
    }
    var m = new Date(t0.getFullYear(), t0.getMonth() + 1, 1);
    while (m <= t1) {
      s += '<text class="achse" x="' + x(m).toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle">' + esc(m.toLocaleDateString('de-DE', { month: 'short' })) + '</text>';
      m = new Date(m.getFullYear(), m.getMonth() + 1, 1);
    }
    // Tatsächliche Einspeicherung (Stufen zwischen den Messpunkten)
    var pfadIst = '';
    ist.forEach(function (seg, i) {
      var bis = seg.bis > t1 ? t1 : seg.bis;
      pfadIst += (i ? 'L' : 'M') + x(seg.von).toFixed(1) + ' ' + y(seg.w).toFixed(1) + ' L' + x(bis).toFixed(1) + ' ' + y(seg.w).toFixed(1) + ' ';
    });
    if (pfadIst) s += '<path class="linie ist" d="' + pfadIst + '"/>';
    // Nötige Einspeicherung
    var pfad = noetig.map(function (p, i) { return (i ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(p.w).toFixed(1); }).join(' ');
    s += '<path class="linie noetig" d="' + pfad + '"/>';
    var letzt = noetig[noetig.length - 1];
    s += '<circle class="punkt noetig" cx="' + x(letzt.t).toFixed(1) + '" cy="' + y(letzt.w).toFixed(1) + '" r="4"/>' +
      '<text class="letzter noetig" x="' + (x(letzt.t) - 8).toFixed(1) + '" y="' + (y(letzt.w) - 10).toFixed(1) + '" text-anchor="end">heute ' + fmtZahl(letzt.w, 2) + '</text>';
    s += '</svg>';
    el.innerHTML = s;

    var istLetzt = ist.length ? ist[ist.length - 1].w : null;
    setText('#bedarf-erklaerung', 'Rote Linie: Prozentpunkte, die ab dem jeweiligen Tag täglich eingespeichert werden müssten, um ' + fmtZahl(ziel) +
      ' % am ' + fmtDatum(lage.ziel_datum) + ' zu erreichen; berechnet aus dem Füllstand des Tages und den verbleibenden Tagen. ' +
      'Blaue Linie: tatsächlich erreichte Einspeicherung, Durchschnitt zwischen den Messpunkten' +
      (istLetzt !== null ? ' (zuletzt ' + fmtZahl(istLetzt, 2) + ' Prozentpunkte pro Tag)' : '') + '. Heute nötig: ' + fmtZahl(letzt.w, 2) + '.');
  }


  /* -------------------------------------------------------------- Risiko */

  // "MM-TT" -> Tage seit dem 1. November derselben Saison
  function saisonTag(mmtt) {
    var m = Number(String(mmtt).slice(0, 2)), t = Number(String(mmtt).slice(3, 5));
    var jahr = m >= 7 ? 2025 : 2026;
    return Math.round((new Date(jahr, m - 1, t) - new Date(2025, 10, 1)) / TAG);
  }
  function stuetzFunktion(pts, vorher, nachher) { // lineare Interpolation über Punkte {t, v}
    pts = pts.slice().sort(function (a, b) { return a.t - b.t; });
    return function (tag) {
      if (!pts.length) return nachher;
      if (tag <= pts[0].t) return vorher != null ? vorher : pts[0].v;
      if (tag >= pts[pts.length - 1].t) return nachher != null ? nachher : pts[pts.length - 1].v;
      for (var i = 0; i < pts.length - 1; i++) {
        if (tag >= pts[i].t && tag <= pts[i + 1].t) return pts[i].v + (pts[i + 1].v - pts[i].v) * (tag - pts[i].t) / ((pts[i + 1].t - pts[i].t) || 1);
      }
      return pts[pts.length - 1].v;
    };
  }
  // Für jeden vergangenen Winter: Gesamtentnahme W (Prozentpunkte) und Funktion entnommen(tagSeitNov1)
  function winterFunktionen(daten) {
    var profil = stuetzFunktion((daten.profil || []).map(function (p) { return { t: saisonTag(p.tag), v: Number(p.anteil) }; }), 0, 1);
    return (daten.winter || []).filter(function (w) { return isFinite(w.start) && isFinite(w.tief) && w.start > w.tief; }).map(function (w) {
      var W = Number(w.start) - Number(w.tief);
      var eigene = (w.verlauf || []).filter(function (p) { return p.tag && isFinite(p.entnommen); }).map(function (p) { return { t: saisonTag(p.tag), v: Math.min(W, Number(p.entnommen)) }; });
      var f = eigene.length >= 3 ? stuetzFunktion([{ t: 0, v: 0 }].concat(eigene), 0, W) : function (tag) { return W * profil(tag); };
      return { saison: w.saison, W: W, entnommen: f, geschaetzt: !!w.geschaetzt };
    });
  }
  // Anteil der Winter, deren Wert größer als x ist; zwischen den Werten linear geglättet
  function anteilGroesser(werte, x) {
    var w = werte.slice().sort(function (a, b) { return a - b; }), n = w.length;
    if (!n) return null;
    if (x < w[0]) return 1;
    if (x >= w[n - 1]) return 0;
    var k = 0; while (k < n - 1 && w[k + 1] <= x) k++;
    var f = (x - w[k]) / ((w[k + 1] - w[k]) || 1);
    return Math.max(0, Math.min(1, 1 - (k + 0.5 + f) / n));
  }
  function anzahlGroesser(werte, x) { return werte.filter(function (v) { return v > x; }).length; }

  // "MM-TT" -> Tage seit dem 1. März desselben Jahres (für das Sommerprofil)
  function sommerTag(mmtt) {
    var m = Number(String(mmtt).slice(0, 2)), t = Number(String(mmtt).slice(3, 5));
    return Math.round((new Date(2026, m - 1, t) - new Date(2026, 2, 1)) / TAG);
  }

  function ladeRisiko(verlauf, lage) {
    if (!$('#risiko-liste')) return;
    var daten;
    ladeJson('daten/winter.json').then(function (d) {
      daten = d;
      return fetch('/.netlify/functions/winter').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    }).then(function (live) {
      if (live && Array.isArray(live.winter) && live.winter.length >= 8) {
        daten.winter = live.winter; daten.quelle = live.quelle; daten.exakt = true;
        if (Array.isArray(live.sommer_rest) && live.sommer_rest.length >= 5) daten.sommer_rest = live.sommer_rest;
      }
      zeigeRisiko(verlauf, lage, daten);
    }).catch(function (e) {
      var el = $('#risiko-liste'); if (el) el.innerHTML = '<p class="fehler">Die Winterdaten konnten nicht geladen werden (daten/winter.json). ' + esc(e.message) + '</p>';
    });
  }

  function zeigeRisiko(verlauf, lage, daten) {
    var punkte = zuPunkten(verlauf.punkte);
    var stand = new Date(String(lage.stand_datum || '').slice(0, 10) + 'T00:00:00');
    if (!isNaN(stand) && isFinite(lage.fuellstand_prozent) && (!punkte.length || stand > punkte[punkte.length - 1].t)) punkte.push({ t: stand, v: Number(lage.fuellstand_prozent) });
    var fns = winterFunktionen(daten);
    var listeEl = $('#risiko-liste');
    if (!listeEl) return;
    if (punkte.length < 2 || fns.length < 3) { if (listeEl) listeEl.innerHTML = '<p class="fehler">Für die Risikorechnung fehlen Daten (Verlauf oder Winter).</p>'; return; }

    var f = interpolator(punkte), letzter = punkte[punkte.length - 1];
    var winterStart = new Date((lage.ziel_datum || '2026-11-01') + 'T00:00:00');
    var schwelle = Number(daten.schwelle_mangellage_prozent || 20);
    var n = fns.length, geschaetzt = fns.filter(function (w) { return w.geschaetzt; }).length;
    var W = fns.map(function (w) { return w.W; });
    // Übliche Einspeicherung vom Kalendertag bis zum 1. November
    var rest = stuetzFunktion((daten.sommer_rest || []).map(function (p) { return { t: sommerTag(p.tag), v: Number(p.pp) }; }).filter(function (p) { return isFinite(p.v); }), null, 0);

    // Rechnung für einen Tag; Daten nur bis zum letzten Messpunkt, danach bleibt alles konstant.
    function fuerTag(tag) {
      var d = tag < letzter.t ? tag : letzter.t;
      var standWert = f(d);
      var e = { datum: d, stand: standWert };
      if (d < winterStart) {
        var st = Math.round((d - new Date(d.getFullYear(), 2, 1)) / TAG);
        e.phase = 'vorher';
        e.rest = Math.max(0, rest(st));
        e.proj = Math.max(0, Math.min(100, standWert + e.rest));
        var vorher = new Date(d.getTime() - 30 * TAG);
        var spanne = vorher < punkte[0].t ? Math.max(1, (d - punkte[0].t) / TAG) : 30;
        e.rate = (f(d) - f(vorher < punkte[0].t ? punkte[0].t : vorher)) / spanne;
        e.projTempo = Math.max(0, Math.min(100, standWert + Math.max(0, e.rate) * Math.max(0, Math.round((winterStart - d) / TAG))));
        var x = e.proj - schwelle;
        e.mangel = anteilGroesser(W, x); e.anzahl = anzahlGroesser(W, x);
      } else {
        var wt = Math.round((d - winterStart) / TAG);
        e.phase = 'winter';
        if (standWert < schwelle) { e.mangel = 1; e.anzahl = n; e.eingetreten = true; }
        else {
          var restW = fns.map(function (w) { return Math.max(0, w.W - w.entnommen(wt)); }), xw = standWert - schwelle;
          e.mangel = anteilGroesser(restW, xw); e.anzahl = anzahlGroesser(restW, xw);
        }
      }
      return e;
    }

    var heute = new Date(); heute.setHours(0, 0, 0, 0);
    var jetzt = fuerTag(heute);

    var zeilen = [
      { t: 'Gasmangellage in diesem Winter (Füllstand unter ' + fmtZahl(schwelle) + ' %)', w: fmtZahl(jetzt.mangel * 100) + ' %',
        k: jetzt.eingetreten ? 'eingetreten: der Füllstand liegt bereits unter der Schwelle' : 'in ' + jetzt.anzahl + ' von ' + n + ' vergangenen Wintern hätte die Entnahme dafür ausgereicht', warnung: jetzt.mangel >= 0.5 }
    ];
    if (jetzt.phase === 'vorher') {
      zeilen.push({ t: 'Erwarteter Füllstand am ' + fmtDatum(lage.ziel_datum), w: fmtZahl(jetzt.proj, 1) + ' %',
        k: 'Stand ' + fmtDatum(jetzt.datum.toISOString().slice(0, 10)) + ' plus die bis dahin übliche Einspeicherung von ' + fmtZahl(jetzt.rest, 1) + ' Prozentpunkten; beim Tempo der letzten 30 Tage (' + fmtZahl(jetzt.rate, 2) + ' pro Tag) wären es ' + fmtZahl(jetzt.projTempo, 1) + ' %' });
    }
    zeilen.push({ t: 'Datengrundlage', w: n + ' Winter', k: daten.exakt ? 'seit 2011/12, exakt aus AGSI-Tageswerten berechnet' : 'seit 2011/12, davon ' + geschaetzt + ' mit geschätzten Werten; mit AGSI-Schlüssel werden sie automatisch exakt' });
    listeEl.innerHTML = zeilen.map(function (z) {
      return '<div' + (z.warnung ? ' class="warnung"' : '') + '><dt>' + esc(z.t) + '</dt><dd>' + esc(z.w) + (z.k ? '<small>' + esc(z.k) + '</small>' : '') + '</dd></div>';
    }).join('');

    var modellEl = $('#risiko-modell');
    if (modellEl) modellEl.innerHTML = '<strong>So wird gerechnet:</strong> ' + esc('Zum heutigen Füllstand wird die Einspeicherung addiert, die in den Jahren seit 2011 zwischen diesem Kalendertag und dem 1. November üblich war' +
      (jetzt.phase === 'vorher' ? ' (heute ' + fmtZahl(jetzt.rest, 1) + ' Prozentpunkte, ergibt ' + fmtZahl(jetzt.proj, 1) + ' % am ' + fmtDatum(lage.ziel_datum) + ')' : '') +
      '. Dann wird für jeden der ' + n + ' vergangenen Winter geprüft, ob die damalige Entnahme zwischen 1. November und Tiefstand ausgereicht hätte, um von diesem Stand unter ' + fmtZahl(schwelle) +
      ' % zu fallen. Der Anteil dieser Winter ist die angezeigte Wahrscheinlichkeit; zwischen den einzelnen Winterwerten wird geglättet. Im Winter selbst wird ab dem tatsächlichen Füllstand mit der jeweils noch ausstehenden Entnahme gerechnet. Die Kurve zeigt diese Rechnung für jeden Tag seit dem Tiefstand, jeweils mit dem Wissensstand dieses Tages.');

    // Kurve seit dem Tiefstand
    var tief = 0; punkte.forEach(function (p, i) { if (p.v < punkte[tief].v) tief = i; });
    var reihe = [];
    for (var t = nurDatum(punkte[tief].t); t <= heute; t = naechsterTag(t)) reihe.push({ t: t, m: fuerTag(t).mangel });
    var el = $('#risiko-diagramm');
    if (!el || reihe.length < 2) return;
    var B = 640, H = 280, L = 52, R = 16, O = 20, U = 36;
    var t0 = reihe[0].t, t1 = reihe[reihe.length - 1].t;
    var x = function (tt) { return L + (tt - t0) / ((t1 - t0) || 1) * (B - L - R); };
    var y = function (v) { return O + (1 - v) * (H - O - U); };
    var s = '<svg viewBox="0 0 ' + B + ' ' + H + '" role="img" aria-label="Wahrscheinlichkeit einer Gasmangellage im Zeitverlauf">';
    for (var g = 0; g <= 1.0001; g += 0.2) {
      s += '<line class="gitter" x1="' + L + '" x2="' + (B - R) + '" y1="' + y(g).toFixed(1) + '" y2="' + y(g).toFixed(1) + '"/>' +
        '<text class="achse" x="' + (L - 6) + '" y="' + (y(g) + 4).toFixed(1) + '" text-anchor="end">' + Math.round(g * 100) + ' %</text>';
    }
    var m = new Date(t0.getFullYear(), t0.getMonth() + 1, 1);
    while (m <= t1) {
      s += '<text class="achse" x="' + x(m).toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle">' + esc(m.toLocaleDateString('de-DE', { month: 'short' })) + '</text>';
      m = new Date(m.getFullYear(), m.getMonth() + 1, 1);
    }
    var pfad = reihe.map(function (p, i) { return (i ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(p.m).toFixed(1); }).join(' ');
    s += '<path class="flaeche rot" d="' + pfad + ' L' + x(t1).toFixed(1) + ' ' + y(0) + ' L' + x(t0).toFixed(1) + ' ' + y(0) + ' Z"/>';
    s += '<path class="linie noetig" d="' + pfad + '"/>';
    var l = reihe[reihe.length - 1];
    s += '<circle class="punkt noetig" cx="' + x(l.t).toFixed(1) + '" cy="' + y(l.m).toFixed(1) + '" r="4"/>' +
      '<text class="letzter noetig" x="' + (x(l.t) - 8).toFixed(1) + '" y="' + (y(l.m) - 10).toFixed(1) + '" text-anchor="end">heute ' + Math.round(l.m * 100) + ' %</text>';
    s += '</svg>';
    el.innerHTML = s;
    setText('#risiko-erklaerung', 'Wahrscheinlichkeit, dass der Füllstand in diesem Winter unter ' + fmtZahl(schwelle) + ' % fällt, berechnet für jeden Tag seit dem Tiefstand mit dem Wissensstand des jeweiligen Tages. Steigt die Kurve, blieb die Einspeicherung hinter dem zurück, was in früheren Jahren üblich war. Datengrundlage: ' + (daten.quelle || 'daten/winter.json') + '.');
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
    // Meldungsnummer und Freigabe-Links: stehen in der Benachrichtigung; die Freigabe selbst ist passwortgeschützt.
    var nummer = zufallsNummer();
    var basis = location.origin + '/freigabe?id=' + nummer + '&aktion=';
    if ($('#f-meldung-id')) $('#f-meldung-id').value = nummer;
    if ($('#f-freigabe-link')) $('#f-freigabe-link').value = basis + 'freigeben';
    if ($('#f-ablehnen-link')) $('#f-ablehnen-link').value = basis + 'ablehnen';
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

  function zufallsNummer() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    var z = ''; var a = new Uint8Array(12);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a); else for (var i = 0; i < 12; i++) a[i] = Math.floor(Math.random() * 256);
    for (var j = 0; j < a.length; j++) z += ('0' + a[j].toString(16)).slice(-2);
    return z;
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
    function feld(id) { return $('#' + id); }
    function startWert() { return zeitInSekunden(feld('f-youtube-start').value) || 0; }
    function endeWert() { return zeitInSekunden(feld('f-youtube-ende').value); }

    // Vorschau: Wir übergeben YouTube keine feste Endzeit, sondern halten selbst am Ende an.
    // So bleibt der Abspieler danach frei spulbar.
    var vorschau = null;
    function stoppeVorschau() { if (vorschau) { clearInterval(vorschau); vorschau = null; } }
    function springe(t) { if (spieler && spieler.seekTo) { stoppeVorschau(); spieler.seekTo(Math.max(0, t), true); spieler.pauseVideo(); } }

    $('#schneiden-start').addEventListener('click', function () {
      var t = aktuell(); if (t === null) return;
      stoppeVorschau();
      feld('f-youtube-start').value = sekundenInZeit(t);
      var ende = endeWert();
      if (ende !== null && ende <= t) { feld('f-youtube-ende').value = ''; melde('Start gesetzt auf ' + sekundenInZeit(t) + '. Das bisherige Ende lag davor und wurde gelöscht.'); }
      else melde('Start gesetzt auf ' + sekundenInZeit(t) + '.');
    });
    $('#schneiden-ende').addEventListener('click', function () {
      var t = aktuell(); if (t === null) return;
      stoppeVorschau();
      var start = startWert();
      if (t <= start) { melde('Das Ende muss nach dem Start (' + sekundenInZeit(start) + ') liegen.'); return; }
      feld('f-youtube-ende').value = sekundenInZeit(t);
      melde('Ausschnitt: ' + sekundenInZeit(start) + ' bis ' + sekundenInZeit(t) + ' (' + (t - start) + ' Sekunden).');
    });
    $('#schneiden-pruefen').addEventListener('click', function () {
      if (!spieler) return;
      var start = startWert(), ende = endeWert();
      stoppeVorschau();
      spieler.seekTo(start, true); spieler.playVideo();
      if (ende !== null && ende > start) {
        vorschau = setInterval(function () {
          if (spieler.getCurrentTime() >= ende) {
            spieler.pauseVideo(); stoppeVorschau();
            melde('Ende des Ausschnitts bei ' + sekundenInZeit(ende) + ' erreicht. Sie können frei weiterspulen und Start oder Ende neu setzen.');
          }
        }, 200);
        melde('Spielt den Ausschnitt ' + sekundenInZeit(start) + ' bis ' + sekundenInZeit(ende) + ' ab.');
      } else {
        melde('Spielt ab ' + sekundenInZeit(start) + '; noch kein Ende gesetzt.');
      }
    });
    $('#schneiden-frei').addEventListener('click', function () {
      stoppeVorschau();
      if (spieler) spieler.playVideo();
      melde('Freies Spulen. Die eingetragenen Zeiten bleiben erhalten.');
    });

    // Feinregler: ±1 s und ±5 s je Feld; springen im Video zur neuen Stelle.
    $$('.feinjustierung button').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.parentNode.getAttribute('data-feld'); var f = feld(id);
        var basis = zeitInSekunden(f.value); if (basis === null) basis = aktuell() || 0;
        var neu = Math.max(0, basis + Number(b.getAttribute('data-delta')));
        f.value = sekundenInZeit(neu);
        springe(neu);
        var start = startWert(), ende = endeWert();
        if (ende !== null && ende <= start) melde('Achtung: Das Ende (' + sekundenInZeit(ende) + ') liegt nicht nach dem Start (' + sekundenInZeit(start) + ').');
        else melde((id === 'f-youtube-start' ? 'Start' : 'Ende') + ' jetzt bei ' + sekundenInZeit(neu) + '.');
      });
    });

    // Von Hand geänderte Zeitfelder: im Video dorthin springen, damit man die Stelle sieht.
    ['f-youtube-start', 'f-youtube-ende'].forEach(function (id) {
      feld(id).addEventListener('change', function () {
        var t = zeitInSekunden(feld(id).value);
        if (t === null) { if (feld(id).value.trim()) melde('Bitte Minuten:Sekunden eingeben, zum Beispiel 12:34.'); return; }
        feld(id).value = sekundenInZeit(t);
        springe(t);
      });
    });
  }

  /* ------------------------------------------------------------ Besucher */

  function richteZaehlerEin() {
    var el = $('#besucher'); if (!el) return;
    var methode = 'GET';
    try {
      // Einmal je Browsersitzung zählen, damit Neuladen nicht doppelt zählt. Kein Cookie, nur ein Sitzungsmerker.
      if (!sessionStorage.getItem('hl-gezaehlt')) { methode = 'POST'; sessionStorage.setItem('hl-gezaehlt', '1'); }
    } catch (e) { methode = 'POST'; }
    fetch('/besucher', { method: methode }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !isFinite(d.besuche)) { el.hidden = true; return; }
      setText('#besucher-zahl', fmtZahl(d.besuche));
      setText('#besucher-seit', fmtDatum(d.seit));
      el.hidden = false;
    }).catch(function () { el.hidden = true; });
  }

  /* --------------------------------------------------------------- Start */

  document.addEventListener('DOMContentLoaded', function () {
    tick(); setInterval(tick, 1000);
    ladeLage().then(function (lage) { ladeVerlauf(lage); });
    ladeEintraege();
    ladeBingo();
    richteFormularEin();
    richteZaehlerEin();
  });
})();
