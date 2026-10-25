/* Aufgaben-App – Oberfläche. Zeigt die eingelesene Mappe an; Änderungen an Aufgaben sind
   bewusst nicht vorgesehen. */
(function () {
  "use strict";

  const K = window.AufgabenKern;
  const DBX = window.AufgabenDropbox;

  const SPEICHER_DATEN = "aufgabenapp.daten";
  const SPEICHER_UI = "aufgabenapp.ui";
  const SPEICHER_PFAD = "aufgabenapp.pfad";

  const STANDARD_UI = {
    ansicht: "offen",
    filter: {
      offen: { status: "aktiv", prio: "", bereich: "", wer: "", suche: "" },
      erledigt: { status: "", prio: "", bereich: "", wer: "", suche: "" },
      wv: { status: "aktiv", prio: "", bereich: "", wer: "", suche: "" },
    },
    sort: {
      offen: { schluessel: "prio", ab: false },
      erledigt: { schluessel: "aktualisiert", ab: true },
      wv: { schluessel: "termin", ab: false },
    },
  };

  const SORT_JE_ANSICHT = {
    offen: ["prio", "termin", "bereich", "aktualisiert", "id"],
    erledigt: ["aktualisiert", "prio", "bereich", "termin", "id"],
    wv: ["termin", "id"],
  };

  function lies(schluessel) {
    try { return JSON.parse(localStorage.getItem(schluessel)); } catch (e) { return null; }
  }
  function schreib(schluessel, wert) {
    try { localStorage.setItem(schluessel, JSON.stringify(wert)); } catch (e) { /* privater Modus */ }
  }
  function loesche(schluessel) {
    try { localStorage.removeItem(schluessel); } catch (e) { /* ignorieren */ }
  }

  function kopie(o) { return JSON.parse(JSON.stringify(o)); }

  const gespeichertUi = lies(SPEICHER_UI);
  const ui = kopie(STANDARD_UI);
  if (gespeichertUi) {
    if (["offen", "erledigt", "wv"].includes(gespeichertUi.ansicht)) ui.ansicht = gespeichertUi.ansicht;
    for (const a of ["offen", "erledigt", "wv"]) {
      Object.assign(ui.filter[a], (gespeichertUi.filter || {})[a] || {});
      Object.assign(ui.sort[a], (gespeichertUi.sort || {})[a] || {});
      ui.filter[a].suche = "";
    }
  }

  let daten = lies(SPEICHER_DATEN); // {ansichten, geladen, geaendert, fehler}
  let laedt = false;

  const $ = (id) => document.getElementById(id);

  function el(tag, klasse, inhalt) {
    const e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (inhalt !== undefined && inhalt !== null) e.textContent = inhalt;
    return e;
  }

  function heuteIso() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function datumZeit(isoText) {
    const d = new Date(isoText);
    if (isNaN(d)) return "";
    return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) + " " +
      d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  }

  function prioKlasse(p) {
    return { zeitkritisch: "p-zeitkritisch", P1: "p-p1", P2: "p-p2", P3: "p-p3" }[p] || "p-sonst";
  }
  function statusKlasse(s) {
    return { "Offen": "s-offen", "In Arbeit": "s-inarbeit", "Warten auf Dritte": "s-warten", "Erledigt": "s-erledigt", "Entfallen": "s-entfallen" }[s] || "s-offen";
  }

  /* ---------- Laden ---------- */

  function pfad() {
    return lies(SPEICHER_PFAD) || "";
  }

  async function neuLaden() {
    if (laedt) return;
    if (!DBX.istVerbunden() || !pfad()) { zeichne(); return; }
    laedt = true;
    $("neu-laden").classList.add("laedt");
    zeigeMeldung("");
    try {
      const { puffer, geaendert } = await DBX.ladeDatei(pfad());
      const erg = K.leseMappe(window.XLSX, puffer);
      daten = { ansichten: erg.ansichten, fehler: erg.fehler, geladen: new Date().toISOString(), geaendert };
      schreib(SPEICHER_DATEN, daten);
    } catch (e) {
      zeigeMeldung((daten ? "Aktualisierung fehlgeschlagen – angezeigt wird der zuletzt geladene Stand.\n" : "") + e.message);
    } finally {
      laedt = false;
      $("neu-laden").classList.remove("laedt");
      zeichne();
    }
  }

  function zeigeMeldung(t) {
    const m = $("meldung");
    m.textContent = t;
    m.hidden = !t;
  }

  /* ---------- Darstellung ---------- */

  function fuelleSelect(sel, optionen, wert) {
    sel.replaceChildren();
    for (const [v, t] of optionen) {
      const o = el("option", null, t);
      o.value = v;
      sel.appendChild(o);
    }
    sel.value = optionen.some(([v]) => v === wert) ? wert : "";
    sel.classList.toggle("aktiv", !!sel.value && !(sel.id === "f-status" && sel.value === "aktiv"));
    sel.hidden = optionen.length <= 2; // nur "Alle" plus ein Wert: Filter wäre wirkungslos
  }

  function zeichneWerkzeuge(liste) {
    const a = ui.ansicht;
    const f = ui.filter[a];

    const statusOpt = [["", "Alle Status"]];
    const statusWerte = K.werte(liste, "status");
    if (statusWerte.some((s) => K.ABGESCHLOSSEN.includes(s)) && statusWerte.some((s) => !K.ABGESCHLOSSEN.includes(s))) {
      statusOpt.push(["aktiv", "Nur aktive"]);
    }
    for (const s of statusWerte) statusOpt.push([s, s]);
    fuelleSelect($("f-status"), statusOpt, f.status);
    if ($("f-status").value !== f.status) f.status = $("f-status").value;

    for (const [id, feld, alle] of [["f-prio", "prio", "Alle Prioritäten"], ["f-bereich", "bereich", "Alle Bereiche"], ["f-wer", "wer", "Alle Verantwortlichen"]]) {
      const w = K.werte(liste, feld);
      fuelleSelect($(id), [["", alle]].concat(w.map((x) => [x, x])), f[feld]);
      if ($(id).value !== f[feld]) f[feld] = $(id).value;
    }

    const s = ui.sort[a];
    const sortSel = $("sortieren");
    sortSel.replaceChildren();
    for (const k of SORT_JE_ANSICHT[a]) {
      const o = el("option", null, K.SORTIERUNGEN[k].name);
      o.value = k;
      sortSel.appendChild(o);
    }
    if (!SORT_JE_ANSICHT[a].includes(s.schluessel)) s.schluessel = SORT_JE_ANSICHT[a][0];
    sortSel.value = s.schluessel;
    $("richtung").textContent = s.ab ? "↓" : "↑";
    $("richtung").setAttribute("aria-label", s.ab ? "Absteigend – umkehren" : "Aufsteigend – umkehren");

    if (document.activeElement !== $("suche")) $("suche").value = f.suche;
  }

  function feld(dl, titel, wert, knoten) {
    if (!wert && !knoten) return;
    dl.appendChild(el("dt", null, titel));
    const dd = el("dd", null, knoten ? null : wert);
    if (knoten) dd.appendChild(knoten);
    dl.appendChild(dd);
  }

  function verweise(textWert) {
    const f = document.createDocumentFragment();
    let treffer = false;
    for (const teil of textWert.split(/((?:AUF|WV)-\d+(?:\.\d+)*(?:-\d+)?)/)) {
      if (/^(AUF|WV)-/.test(teil) && finde(teil)) {
        const b = el("button", "verweis", teil);
        b.type = "button";
        b.addEventListener("click", (ev) => { ev.preventDefault(); springeZu(teil); });
        f.appendChild(b);
        treffer = true;
      } else if (teil.trim()) {
        f.appendChild(document.createTextNode(teil));
      }
    }
    return treffer ? f : null;
  }

  function karte(r, heute) {
    const li = el("li", "karte");
    li.dataset.id = r.id;
    const ueber = K.istUeberfaellig(r, heute);
    if (ueber) li.classList.add("ueberfaellig");

    const det = el("details");
    const sum = el("summary");
    const z1 = el("div", "zeile1");
    if (r.prio) z1.appendChild(el("span", "marke " + prioKlasse(r.prio), r.prio));
    if (r.status) z1.appendChild(el("span", "marke " + statusKlasse(r.status), r.status));
    z1.appendChild(el("span", "id", r.id));
    sum.appendChild(z1);
    sum.appendChild(el("div", "titel", r.titel));

    const meta = el("div", "meta");
    if (r.termin) {
      const t = el("span", ueber ? "ueber" : null, "📅 " + (r.termin.length > 60 ? r.termin.slice(0, 57) + "…" : r.termin));
      meta.appendChild(t);
    }
    if (r.wer) meta.appendChild(el("span", null, "👤 " + r.wer));
    if (r.bereich) meta.appendChild(el("span", null, r.bereich));
    if (meta.childNodes.length) sum.appendChild(meta);
    det.appendChild(sum);

    const dl = el("dl", "detail");
    feld(dl, "Nächster Schritt", r.schritt);
    if (r.termin && r.termin.length > 60) feld(dl, "Termin oder Auslöser", r.termin);
    feld(dl, "Abhängigkeit", r.abh, r.abh ? verweise(r.abh) : null);
    feld(dl, r.ansicht === "wv" ? "Zugeordnete Aufgabe" : "Verknüpfte Aufgaben", r.verknuepft, r.verknuepft ? verweise(r.verknuepft) : null);
    feld(dl, "Detailabschnitt", r.detail);
    feld(dl, "Zuordnungshinweis", r.hinweis);
    feld(dl, "Beleg- oder Vorgangspfad", r.beleg);
    feld(dl, "Letzte Aktualisierung", r.aktualisiert);
    if (dl.childNodes.length) det.appendChild(dl);

    li.appendChild(det);
    return li;
  }

  function zeichne() {
    const eingerichtet = DBX.istVerbunden() && !!pfad();
    $("willkommen").hidden = !!daten || eingerichtet;

    for (const b of document.querySelectorAll(".segment button")) {
      const a = b.dataset.ansicht;
      b.setAttribute("aria-selected", String(a === ui.ansicht));
      const n = daten ? (daten.ansichten[a] || []).filter((r) => !K.ABGESCHLOSSEN.includes(r.status) || a === "erledigt").length : null;
      b.querySelector(".anzahl").textContent = n === null ? "" : n;
    }

    const stand = $("stand");
    if (daten) {
      const teile = [];
      if (daten.geaendert) teile.push("Mappe vom " + datumZeit(daten.geaendert));
      teile.push("geladen " + datumZeit(daten.geladen));
      stand.textContent = teile.join(" · ");
    } else {
      stand.textContent = laedt ? "Lade …" : "";
    }

    if (daten && daten.fehler && daten.fehler.length && !$("meldung").textContent) {
      zeigeMeldung("Die Mappe weicht vom erwarteten Aufbau ab:\n" + daten.fehler.join("\n"));
    }

    const liste = daten ? daten.ansichten[ui.ansicht] || [] : [];
    zeichneWerkzeuge(liste);

    const s = ui.sort[ui.ansicht];
    const sichtbar = K.sortiere(K.filtere(liste, ui.filter[ui.ansicht]), s.schluessel, s.ab);
    $("zaehler").textContent = daten ? sichtbar.length + " von " + liste.length + " Einträgen" : "";

    const heute = heuteIso();
    const ul = $("liste");
    ul.replaceChildren();
    for (const r of sichtbar) ul.appendChild(karte(r, heute));
    if (daten && !sichtbar.length) ul.appendChild(el("li", "leer", "Keine Einträge für diese Filter."));

    schreib(SPEICHER_UI, ui);
  }

  function finde(id) {
    if (!daten) return null;
    for (const a of ["offen", "erledigt", "wv"]) {
      if ((daten.ansichten[a] || []).some((r) => r.id === id)) return a;
    }
    return null;
  }

  function springeZu(id) {
    const a = finde(id);
    if (!a) return;
    ui.ansicht = a;
    ui.filter[a] = { status: "", prio: "", bereich: "", wer: "", suche: id };
    zeichne();
    const li = document.querySelector('.karte[data-id="' + CSS.escape(id) + '"]');
    if (li) {
      li.classList.add("markiert");
      li.querySelector("details").open = true;
      li.scrollIntoView({ block: "center" });
    }
  }

  /* ---------- Bedienung ---------- */

  for (const b of document.querySelectorAll(".segment button")) {
    b.addEventListener("click", () => { ui.ansicht = b.dataset.ansicht; zeichne(); window.scrollTo(0, 0); });
  }

  let sucheTimer = null;
  $("suche").addEventListener("input", (e) => {
    clearTimeout(sucheTimer);
    sucheTimer = setTimeout(() => { ui.filter[ui.ansicht].suche = e.target.value; zeichne(); }, 150);
  });

  for (const [id, feldName] of [["f-status", "status"], ["f-prio", "prio"], ["f-bereich", "bereich"], ["f-wer", "wer"]]) {
    $(id).addEventListener("change", (e) => { ui.filter[ui.ansicht][feldName] = e.target.value; zeichne(); });
  }

  $("sortieren").addEventListener("change", (e) => {
    const s = ui.sort[ui.ansicht];
    s.schluessel = e.target.value;
    s.ab = e.target.value === "aktualisiert";
    zeichne();
  });
  $("richtung").addEventListener("click", () => { const s = ui.sort[ui.ansicht]; s.ab = !s.ab; zeichne(); });
  $("zuruecksetzen").addEventListener("click", () => {
    ui.filter[ui.ansicht] = kopie(STANDARD_UI.filter[ui.ansicht]);
    ui.sort[ui.ansicht] = kopie(STANDARD_UI.sort[ui.ansicht]);
    $("suche").value = "";
    zeichne();
  });

  $("neu-laden").addEventListener("click", neuLaden);

  /* ---------- Einstellungen ---------- */

  const dialog = $("einstellungen");

  function zeichneEinstellungen() {
    $("pfad").value = pfad();
    const verbunden = DBX.istVerbunden();
    $("getrennt").hidden = verbunden;
    $("verbunden").hidden = !verbunden;
    $("verbindung-fehler").hidden = true;
    if (!verbunden) {
      $("appkey").value = DBX.appKey();
      bereiteAnmeldungVor();
    }
  }

  // Die Anmeldeadresse wird vorab erzeugt, damit Safari den Link nicht als Pop-up blockiert.
  let vorbereitung = 0;
  async function bereiteAnmeldungVor() {
    const link = $("anmelden");
    const key = $("appkey").value.trim();
    const nr = ++vorbereitung;
    link.classList.add("deaktiviert");
    link.setAttribute("aria-disabled", "true");
    link.removeAttribute("href");
    if (!key) return;
    const url = await DBX.anmeldeAdresse(key);
    if (nr !== vorbereitung) return;
    link.href = url;
    link.classList.remove("deaktiviert");
    link.setAttribute("aria-disabled", "false");
  }

  function verbindungsFehler(t) {
    const p = $("verbindung-fehler");
    p.textContent = t;
    p.hidden = !t;
  }

  document.querySelectorAll("[data-oeffne-einstellungen], #einstellungen-oeffnen").forEach((b) => {
    b.addEventListener("click", () => { zeichneEinstellungen(); dialog.showModal(); });
  });

  $("pfad").addEventListener("change", (e) => {
    const p = e.target.value.trim();
    if (p && !p.startsWith("/")) { verbindungsFehler("Der Pfad muss mit „/“ beginnen."); return; }
    verbindungsFehler("");
    schreib(SPEICHER_PFAD, p);
  });

  let keyTimer = null;
  $("appkey").addEventListener("input", () => { clearTimeout(keyTimer); keyTimer = setTimeout(bereiteAnmeldungVor, 300); });

  $("verbinden").addEventListener("click", async () => {
    verbindungsFehler("");
    const code = $("code").value.trim();
    if (!code) { verbindungsFehler("Bitte den von Dropbox angezeigten Code einfügen."); return; }
    try {
      await DBX.codeEinloesen(code);
      $("code").value = "";
      zeichneEinstellungen();
      neuLaden();
    } catch (e) {
      verbindungsFehler(e.message);
    }
  });

  $("abmelden").addEventListener("click", async () => {
    if (!confirm("Dropbox-Verbindung trennen und alle auf diesem Gerät gespeicherten Aufgabendaten löschen?")) return;
    await DBX.abmelden();
    loesche(SPEICHER_DATEN);
    loesche(SPEICHER_UI);
    daten = null;
    zeichneEinstellungen();
    zeichne();
  });

  dialog.addEventListener("close", () => { if (!daten) neuLaden(); else zeichne(); });

  /* ---------- Start ---------- */

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => { /* nur Offline-Komfort */ });
  }

  zeichne();
  neuLaden();
  document.addEventListener("visibilitychange", () => {
    // Beim Zurückkehren in die App nach mehr als fünf Minuten automatisch aktualisieren.
    if (document.visibilityState === "visible" && daten && Date.now() - new Date(daten.geladen) > 5 * 60 * 1000) neuLaden();
  });
})();
