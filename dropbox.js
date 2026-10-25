/* Aufgaben-App – einziger Netzwerkzugriff. Nur lesend:
   - oauth2/authorize + oauth2/token  (Anmeldung mit PKCE, ohne Geheimnis)
   - 2/files/download                 (Datei herunterladen)
   - 2/auth/token/revoke              (Anmeldung beim Abmelden widerrufen)
   Andere Dropbox-Endpunkte werden nicht aufgerufen. Die Dropbox-App selbst soll nur
   files.content.read und files.metadata.read besitzen. */
(function (global) {
  "use strict";

  const SPEICHER = "aufgabenapp.dropbox";

  function lade() {
    try { return JSON.parse(localStorage.getItem(SPEICHER)) || {}; } catch (e) { return {}; }
  }
  function speichere(z) {
    try { localStorage.setItem(SPEICHER, JSON.stringify(z)); } catch (e) { /* privater Modus */ }
  }

  function base64url(bytes) {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  async function pkcePaar() {
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return { verifier, challenge: base64url(new Uint8Array(hash)) };
  }

  /* Schritt 1: Anmeldeadresse erzeugen. Ohne redirect_uri zeigt Dropbox nach der Zustimmung
     einen Code an, den man in die App einfügt – zuverlässig auch als Home-Bildschirm-App. */
  async function anmeldeAdresse(appKey) {
    const p = await pkcePaar();
    const z = lade();
    z.appKey = appKey;
    z.verifier = p.verifier;
    speichere(z);
    const q = new URLSearchParams({
      client_id: appKey,
      response_type: "code",
      code_challenge: p.challenge,
      code_challenge_method: "S256",
      token_access_type: "offline",
    });
    return "https://www.dropbox.com/oauth2/authorize?" + q.toString();
  }

  async function tokenAnfrage(params) {
    const r = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error_description || j.error || "Anmeldung fehlgeschlagen (" + r.status + ")");
    return j;
  }

  // Schritt 2: angezeigten Code gegen ein dauerhaftes Refresh-Token tauschen.
  async function codeEinloesen(code) {
    const z = lade();
    if (!z.appKey || !z.verifier) throw new Error("Bitte zuerst Schritt 1 ausführen.");
    const j = await tokenAnfrage({
      code: code.trim(),
      grant_type: "authorization_code",
      client_id: z.appKey,
      code_verifier: z.verifier,
    });
    speichere({
      appKey: z.appKey,
      refresh: j.refresh_token,
      access: j.access_token,
      ablauf: Date.now() + (j.expires_in - 60) * 1000,
    });
  }

  function istVerbunden() {
    return !!lade().refresh;
  }

  async function accessToken() {
    const z = lade();
    if (!z.refresh) throw new Error("Nicht mit Dropbox verbunden.");
    if (z.access && z.ablauf > Date.now()) return z.access;
    const j = await tokenAnfrage({ grant_type: "refresh_token", refresh_token: z.refresh, client_id: z.appKey });
    z.access = j.access_token;
    z.ablauf = Date.now() + (j.expires_in - 60) * 1000;
    speichere(z);
    return z.access;
  }

  // HTTP-Header dürfen nur ASCII enthalten; Dropbox verlangt \uXXXX für Umlaute im Pfad.
  function headerJson(obj) {
    return JSON.stringify(obj).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
  }

  /* Lädt die Datei herunter. Rückgabe: {puffer, geaendert} – geaendert ist der Zeitpunkt der
     letzten Änderung laut Dropbox (ISO), soweit Dropbox ihn mitliefert. */
  async function ladeDatei(pfad) {
    const token = await accessToken();
    const r = await fetch("https://content.dropboxapi.com/2/files/download", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Dropbox-API-Arg": headerJson({ path: pfad }) },
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      if (r.status === 409 && t.includes("not_found")) throw new Error("Datei nicht gefunden – Pfad in den Einstellungen prüfen.");
      if (r.status === 401) throw new Error("Dropbox-Anmeldung abgelaufen oder widerrufen – bitte neu verbinden.");
      throw new Error("Download fehlgeschlagen (" + r.status + ").");
    }
    let geaendert = null;
    try { geaendert = JSON.parse(r.headers.get("Dropbox-API-Result")).server_modified || null; } catch (e) { /* nicht freigegeben */ }
    return { puffer: await r.arrayBuffer(), geaendert };
  }

  async function abmelden() {
    const z = lade();
    try {
      if (z.refresh) {
        const token = await accessToken();
        await fetch("https://api.dropboxapi.com/2/auth/token/revoke", { method: "POST", headers: { Authorization: "Bearer " + token } });
      }
    } catch (e) { /* lokal trotzdem löschen */ }
    try { localStorage.removeItem(SPEICHER); } catch (e) { /* ignorieren */ }
  }

  function appKey() {
    return lade().appKey || "";
  }

  global.AufgabenDropbox = { anmeldeAdresse, codeEinloesen, istVerbunden, ladeDatei, abmelden, appKey };
})(window);
