/* Aufgaben-App – reine Logik ohne Oberfläche und ohne Netzwerk.
   Liest die Arbeitsmappe "Aufgaben-und-Wiedervorlagen_Familie.xlsx" ein, normalisiert die
   Zeilen und stellt Datums-, Filter- und Sortierfunktionen bereit. Schreibt nie zurück. */
(function (global) {
  "use strict";

  const AUFGABEN_SPALTEN = {
    id: "ID",
    status: "Status",
    prio: "Priorität",
    bereich: "Bereich",
    titel: "Aufgabe",
    schritt: "Nächster konkreter Schritt",
    wer: "Verantwortlicher",
    termin: "Termin oder Auslöser",
    abh: "Abhängigkeit",
    beleg: "Beleg- oder Vorgangspfad",
    verknuepft: "Verknüpfte Aufgaben-IDs",
    aktualisiert: "Letzte Aktualisierung",
  };

  const WV_SPALTEN = {
    id: "WV-ID",
    termin: "Auslöser / Termin",
    titel: "Danach zu tun",
    detail: "Detailabschnitt",
    verknuepft: "Zugeordnete Aufgaben-ID",
    hinweis: "Zuordnungshinweis",
    status: "Status",
  };

  // Spalten, ohne die eine Ansicht nicht sinnvoll ist; die übrigen sind optional.
  const PFLICHT = {
    aufgaben: ["id", "status", "prio", "titel"],
    wv: ["id", "termin", "titel", "status"],
  };

  const ANSICHTEN = [
    { key: "offen", blatt: "Offene Aufgaben", spalten: AUFGABEN_SPALTEN, pflicht: PFLICHT.aufgaben },
    { key: "erledigt", blatt: "Erledigte Aufgaben", spalten: AUFGABEN_SPALTEN, pflicht: PFLICHT.aufgaben },
    { key: "wv", blatt: "Wiedervorlagen", spalten: WV_SPALTEN, pflicht: PFLICHT.wv },
  ];

  const PRIO_RANG = { zeitkritisch: 0, P1: 1, P2: 2, P3: 3, unbewertet: 4 };
  const ABGESCHLOSSEN = ["Erledigt", "Entfallen"];

  const MONATE = {
    jan: 1, januar: 1, feb: 2, februar: 2, mär: 3, märz: 3, maerz: 3, mrz: 3, apr: 4, april: 4,
    mai: 5, jun: 6, juni: 6, jul: 7, juli: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
    okt: 10, oktober: 10, nov: 11, november: 11, dez: 12, dezember: 12,
  };
  const ZEITRAUM = {
    anfang: 1, frühjahr: 3, fruehjahr: 3, mitte: 6, sommer: 6, herbst: 9, ende: 12, winter: 12,
    q1: 1, q2: 4, q3: 7, q4: 10,
  };

  function iso(j, m, t) {
    return String(j).padStart(4, "0") + "-" + String(m).padStart(2, "0") + "-" + String(t).padStart(2, "0");
  }

  function gueltig(j, m, t) {
    if (m < 1 || m > 12 || t < 1 || t > 31) return false;
    const d = new Date(j, m - 1, t);
    return d.getFullYear() === j && d.getMonth() === m - 1 && d.getDate() === t;
  }

  /* Liefert {iso, ungefaehr} oder null. Exakte Daten haben Vorrang vor Monats- oder
     Jahresangaben; Text ohne erkennbares Datum ergibt null. */
  function parseDatum(wert) {
    if (wert === null || wert === undefined || wert === "") return null;
    if (wert instanceof Date && !isNaN(wert)) {
      return { iso: iso(wert.getFullYear(), wert.getMonth() + 1, wert.getDate()), ungefaehr: false };
    }
    const s = String(wert);
    let m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (m && gueltig(+m[3], +m[2], +m[1])) return { iso: iso(+m[3], +m[2], +m[1]), ungefaehr: false };
    m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m && gueltig(+m[1], +m[2], +m[3])) return { iso: iso(+m[1], +m[2], +m[3]), ungefaehr: false };
    for (const w of s.toLowerCase().matchAll(/([a-zäöü0-9]+)\.?\s+(20\d{2})\b/g)) {
      if (MONATE[w[1]]) return { iso: iso(+w[2], MONATE[w[1]], 1), ungefaehr: true };
      if (ZEITRAUM[w[1]]) return { iso: iso(+w[2], ZEITRAUM[w[1]], 1), ungefaehr: true };
    }
    m = s.match(/\b(\d{1,2})\/(20\d{2})\b/);
    if (m && +m[1] >= 1 && +m[1] <= 12) return { iso: iso(+m[2], +m[1], 1), ungefaehr: true };
    m = s.match(/\b(20\d{2})\b/);
    if (m) return { iso: iso(+m[1], 1, 1), ungefaehr: true };
    return null;
  }

  function text(wert) {
    if (wert === null || wert === undefined) return "";
    if (wert instanceof Date && !isNaN(wert)) {
      return String(wert.getDate()).padStart(2, "0") + "." + String(wert.getMonth() + 1).padStart(2, "0") + "." + wert.getFullYear();
    }
    return String(wert).trim();
  }

  function findeKopfzeile(zeilen, idSpalte) {
    for (let i = 0; i < Math.min(zeilen.length, 15); i++) {
      const z = (zeilen[i] || []).map(text);
      if (z.includes(idSpalte) && z.includes("Status")) return i;
    }
    return -1;
  }

  /* Liest eine Arbeitsmappe (ArrayBuffer) und gibt {ansichten: {offen, erledigt, wv}, fehler: []}
     zurück. Fehlende Blätter oder Pflichtspalten werden als Fehler gemeldet, nicht geraten. */
  function leseMappe(XLSX, puffer) {
    const wb = XLSX.read(puffer, { type: "array", cellDates: true });
    const ergebnis = { ansichten: {}, fehler: [] };

    for (const a of ANSICHTEN) {
      ergebnis.ansichten[a.key] = [];
      const ws = wb.Sheets[a.blatt];
      if (!ws) {
        ergebnis.fehler.push("Blatt „" + a.blatt + "“ fehlt.");
        continue;
      }
      const zeilen = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true, blankrows: false });
      const k = findeKopfzeile(zeilen, a.spalten.id);
      if (k < 0) {
        ergebnis.fehler.push("Blatt „" + a.blatt + "“: Kopfzeile nicht gefunden.");
        continue;
      }
      const kopf = zeilen[k].map(text);
      const idx = {};
      for (const [feld, name] of Object.entries(a.spalten)) idx[feld] = kopf.indexOf(name);
      const fehlend = a.pflicht.filter((f) => idx[f] < 0).map((f) => a.spalten[f]);
      if (fehlend.length) {
        ergebnis.fehler.push("Blatt „" + a.blatt + "“: Spalte fehlt – " + fehlend.join(", ") + ".");
        continue;
      }

      for (let i = k + 1; i < zeilen.length; i++) {
        const z = zeilen[i] || [];
        const roh = (f) => (idx[f] >= 0 ? z[idx[f]] : null);
        const id = text(roh("id"));
        if (!id) continue;
        const termin = parseDatum(roh("termin"));
        const akt = parseDatum(roh("aktualisiert"));
        ergebnis.ansichten[a.key].push({
          ansicht: a.key,
          id,
          status: text(roh("status")),
          prio: text(roh("prio")),
          bereich: text(roh("bereich")),
          titel: text(roh("titel")),
          schritt: text(roh("schritt")),
          wer: text(roh("wer")),
          termin: text(roh("termin")),
          terminIso: termin ? termin.iso : null,
          terminUngefaehr: termin ? termin.ungefaehr : false,
          abh: text(roh("abh")),
          beleg: text(roh("beleg")),
          verknuepft: text(roh("verknuepft")),
          aktualisiert: text(roh("aktualisiert")),
          aktualisiertIso: akt ? akt.iso : null,
          detail: text(roh("detail")),
          hinweis: text(roh("hinweis")),
        });
      }
    }
    return ergebnis;
  }

  function prioRang(p) {
    return p in PRIO_RANG ? PRIO_RANG[p] : 5;
  }

  // Natürlicher Vergleich, damit AUF-15.2-010 hinter AUF-15.2-009 und AUF-15.10 hinter AUF-15.9 steht.
  function idVergleich(a, b) {
    return a.localeCompare(b, "de", { numeric: true, sensitivity: "base" });
  }

  function textVergleich(a, b) {
    if (!a && b) return 1;
    if (a && !b) return -1;
    return a.localeCompare(b, "de", { sensitivity: "base" });
  }

  // Leere Werte stehen unabhängig von der Richtung immer am Ende.
  function mitLeerAmEnde(va, vb, vergleich, absteigend) {
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    const r = vergleich(va, vb);
    return absteigend ? -r : r;
  }

  const SORTIERUNGEN = {
    prio: { name: "Priorität", f: (a, b, ab) => (ab ? -1 : 1) * (prioRang(a.prio) - prioRang(b.prio)) },
    termin: { name: "Termin", f: (a, b, ab) => mitLeerAmEnde(a.terminIso, b.terminIso, (x, y) => x.localeCompare(y), ab) },
    aktualisiert: { name: "Letzte Aktualisierung", f: (a, b, ab) => mitLeerAmEnde(a.aktualisiertIso, b.aktualisiertIso, (x, y) => x.localeCompare(y), ab) },
    bereich: { name: "Bereich", f: (a, b, ab) => mitLeerAmEnde(a.bereich || null, b.bereich || null, textVergleich, ab) },
    id: { name: "ID", f: (a, b, ab) => (ab ? -1 : 1) * idVergleich(a.id, b.id) },
  };

  function sortiere(liste, schluessel, absteigend) {
    const s = SORTIERUNGEN[schluessel] || SORTIERUNGEN.id;
    return liste.slice().sort((a, b) => {
      return s.f(a, b, absteigend) || prioRang(a.prio) - prioRang(b.prio) || idVergleich(a.id, b.id);
    });
  }

  function normalisiere(s) {
    return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  /* filter: {status, prio, bereich, wer, suche}. status "aktiv" blendet Erledigt/Entfallen aus;
     leere Werte bedeuten "alle". */
  function filtere(liste, filter) {
    const suche = filter.suche ? normalisiere(filter.suche.trim()) : "";
    return liste.filter((r) => {
      if (filter.status === "aktiv") {
        if (ABGESCHLOSSEN.includes(r.status)) return false;
      } else if (filter.status && r.status !== filter.status) return false;
      if (filter.prio && r.prio !== filter.prio) return false;
      if (filter.bereich && r.bereich !== filter.bereich) return false;
      if (filter.wer && r.wer !== filter.wer) return false;
      if (suche) {
        const heu = normalisiere([r.id, r.titel, r.schritt, r.bereich, r.wer, r.termin, r.abh, r.verknuepft, r.detail, r.hinweis].join(" "));
        if (!suche.split(/\s+/).every((w) => heu.includes(w))) return false;
      }
      return true;
    });
  }

  function werte(liste, feld) {
    const s = new Set(liste.map((r) => r[feld]).filter(Boolean));
    const arr = Array.from(s);
    if (feld === "prio") return arr.sort((a, b) => prioRang(a) - prioRang(b));
    return arr.sort((a, b) => a.localeCompare(b, "de"));
  }

  function istUeberfaellig(r, heuteIso) {
    return !!r.terminIso && !r.terminUngefaehr && r.terminIso < heuteIso && !ABGESCHLOSSEN.includes(r.status);
  }

  global.AufgabenKern = {
    ANSICHTEN, SORTIERUNGEN, ABGESCHLOSSEN,
    parseDatum, leseMappe, sortiere, filtere, werte, istUeberfaellig, prioRang,
  };
})(typeof window !== "undefined" ? window : globalThis);
