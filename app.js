(async function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var eur = function (n) { return n == null || n === "" || isNaN(n) ? "—" : new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n); };
  var fdate = function (s) { return s ? String(s).slice(0, 10).split("-").reverse().join("/") : "—"; };
  var nowISO = function () { return new Date().toISOString(); };
  var DEFAULT_PAG = ["Bonifico", "Carta conto corrente (Visa *6497)", "Prelievo diretto", "C/C", "Carta prepagata", "Donazione", "Omaggio"];
  var DOC_TIPI = ["Fattura", "Scontrino", "Ricevuta", "DDT / bolla", "Altro"];
  var SIZES = {
    s: { w: 70, h: 37, cols: 3, rows: 8, label: "Piccola 70 × 37 mm · 24 per foglio A4" },
    l: { w: 105, h: 57, cols: 2, rows: 5, label: "Grande 105 × 57 mm · 10 per foglio A4" }
  };

  var S = {
    items: [], progetti: [], config: {}, me: null, names: {}, loaded: { items: false, progetti: false },
    canWrite: true, canAdmin: false, view: "beni", sel: new Set(), size: "s", skip: 0,
    f: { q: "", proj: "", tipo: "", chip: "tutti" }, lf: { q: "", proj: "", solo: true }
  };
  var API = { db: null, user: null, assets: null, downloads: null };
  S.booting = true;

  /* ---------- utilità dati ---------- */
  function codeOf(it) { return it.tipo === "C" ? it.num + "C" : String(it.num); }
  function projOf(id) { return S.progetti.find(function (p) { return p.id === id; }); }
  function projName(id) { var p = projOf(id); return p ? p.nome : ""; }
  function hasDoc(it) { return (it.documenti && it.documenti.length) || it.docLink; }
  function missing(it) {
    var m = [];
    if (it.valore == null) m.push("importo");
    if (!it.dataAcquisto) m.push("data acquisto");
    if (!it.progettoId) m.push("progetto");
    if (!it.pagamento) m.push("metodo di pagamento");
    return m;
  }
  function cmp(a, b) { if (a.tipo !== b.tipo) return a.tipo === "D" ? -1 : 1; return (a.num || 0) - (b.num || 0); }
  function ivaIncl(it) { var v = Number(it.valore), a = Number(it.iva == null ? 22 : it.iva); return isNaN(v) ? 0 : v * a / (100 + a); }
  function nameOf(id, legacy) { if (legacy) return legacy; if (!id) return "—"; return S.names[id] || "Un socio"; }
  function parseNum(v) { v = String(v || "").trim().replace(/\s/g, "").replace("€", ""); if (!v) return null; if (v.indexOf(",") > -1) v = v.replace(/\./g, "").replace(",", "."); var n = parseFloat(v); return isNaN(n) ? null : n; }
  function toast(msg) { var t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 3800); }
  function errMsg(e) { return (e && (e.message || e.code)) || "errore sconosciuto"; }

  async function resolveNames(ids) {
    if (!API.user || !API.user.profiles) return;
    var need = ids.filter(function (i) { return i && !(i in S.names); });
    if (!need.length) return;
    try {
      var ps = await API.user.profiles(need);
      need.forEach(function (i) { S.names[i] = (ps[i] && ps[i].name) || ""; });
      render();
    } catch (e) { }
  }

  /* ---------- rendering ---------- */
  function render() {
    renderWho();
    document.querySelectorAll("#tabs button").forEach(function (b) { b.setAttribute("aria-selected", b.dataset.v === S.view ? "true" : "false"); });
    var tag = (S.config.nome || "GiN APS").toUpperCase().replace(/\s+/g, "·");
    $("#brandTag").textContent = tag;
    var main = $("#main");
    if (!API.db) { main.innerHTML = loginHtml(); return; }
    if (S.view === "beni") main.innerHTML = viewBeni();
    else if (S.view === "progetti") main.innerHTML = viewProgetti();
    else if (S.view === "etichette") { main.innerHTML = viewEtichette(); drawPreviews(); }
    else main.innerHTML = viewImpostazioni();
    restoreFocus();
  }
  var lastFocus = null;
  function restoreFocus() { if (lastFocus) { var el = document.getElementById(lastFocus.id); if (el) { el.focus(); try { el.setSelectionRange(lastFocus.s, lastFocus.e); } catch (e) { } } } }
  function loginHtml() {
    var g = window.GIN || {};
    if (S.booting) return '<div class="login"><div class="note">Carico…</div></div>';
    if (!g.configured) return '<div class="login"><h2>Configurazione mancante</h2><div class="note">Compila il file config.js con l\'indirizzo e la chiave del tuo progetto Supabase (vedi LEGGIMI.md).</div></div>';
    if (g.signedIn) return '<div class="login"><h2>Account non abilitato</h2><div class="note">Hai effettuato l\'accesso ma non risulti tra i soci. Chiedi a un amministratore di abilitarti.</div><button class="btn" id="logout">Esci</button></div>';
    return '<div class="login"><h2>Accedi all\'inventario</h2><div class="note">Inserisci la tua email: ti mandiamo un link per entrare, senza password. Possono accedere solo i soci invitati.</div><div class="fld"><label for="loginEmail">Email</label><input type="text" id="loginEmail" inputmode="email" autocomplete="email"></div><button class="btn primary" id="loginBtn">Invia il link di accesso</button><div class="note" id="loginMsg"></div></div>';
  }
  function renderWho() {
    var w = $("#who");
    if (!API.db) { w.textContent = ""; return; }
    var me = S.names[S.me] || "Socio";
    w.innerHTML = '<b>' + esc(me) + '</b> · ' + (S.canWrite ? (S.canAdmin ? "amministratore" : "socio") : "sola lettura") + ' · <button class="btn" id="logout" style="padding:3px 9px">Esci</button>';
  }

  function filtered() {
    var q = S.f.q.trim().toLowerCase();
    return S.items.filter(function (it) {
      if (S.f.proj && (it.progettoId || "") !== S.f.proj) return false;
      if (S.f.tipo && it.tipo !== S.f.tipo) return false;
      var st = it.stato || "in_uso";
      if (S.f.chip === "uso" && st !== "in_uso") return false;
      if (S.f.chip === "dismessi" && st === "in_uso") return false;
      if (S.f.chip === "nodoc" && hasDoc(it)) return false;
      if (S.f.chip === "incompleti" && !missing(it).length) return false;
      if (q) {
        var hay = [codeOf(it), it.descrizione, it.marca, it.numFattura, it.note, projName(it.progettoId), it.ubicazione, it.pagamento].join(" ").toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    }).sort(cmp);
  }

  function viewBeni() {
    var list = filtered();
    var tot = 0, iva = 0;
    list.forEach(function (it) { if (it.valore != null) { tot += Number(it.valore); iva += ivaIncl(it); } });
    var nodoc = S.items.filter(function (i) { return !hasDoc(i); }).length;
    var inc = S.items.filter(function (i) { return missing(i).length; }).length;
    var cnt = function (fn) { return S.items.filter(fn).length; };
    var chips = [
      ["tutti", "Tutti", S.items.length], ["uso", "In uso", cnt(function (i) { return (i.stato || "in_uso") === "in_uso"; })],
      ["dismessi", "Dismessi", cnt(function (i) { return (i.stato || "in_uso") !== "in_uso"; })],
      ["nodoc", "Senza fattura", nodoc], ["incompleti", "Dati mancanti", inc]
    ].map(function (c) { return '<button class="chip" data-chip="' + c[0] + '" aria-pressed="' + (S.f.chip === c[0]) + '">' + c[1] + '<span class="n">' + c[2] + '</span></button>'; }).join("");
    var popts = '<option value="">Tutti i progetti</option>' + sortedProj().map(function (p) { return '<option value="' + esc(p.id) + '"' + (S.f.proj === p.id ? " selected" : "") + '>' + esc(p.nome) + '</option>'; }).join("");
    var rows = list.map(function (it) {
      var m = missing(it), d = (it.documenti || []).length + (it.docLink ? 1 : 0);
      var flags = (it.stato && it.stato !== "in_uso" ? '<span class="pill mute">' + esc(statoLabel(it.stato)) + '</span>' : "") +
        (d ? '<span class="pill ok">' + d + (d === 1 ? " documento" : " documenti") + '</span>' : '<span class="pill warn">Manca fattura</span>') +
        (m.length ? '<span class="pill bad" title="Mancano: ' + esc(m.join(", ")) + '">Dati mancanti</span>' : "");
      var p = projOf(it.progettoId);
      return '<div class="row" role="button" tabindex="0" data-open="' + esc(it.id) + '">' +
        '<div class="c-code"><span class="tag">' + esc(codeOf(it)) + '</span></div>' +
        '<div class="c-main"><b>' + esc(it.descrizione || "(senza descrizione)") + '</b><span>' + esc(it.marca || "") + '</span></div>' +
        '<div class="c-proj">' + (p ? esc(p.nome) + '<small>' + esc(p.codice || "") + '</small>' : '<span class="pill bad">Progetto da indicare</span>') + '</div>' +
        '<div class="c-val num">' + eur(it.valore) + '</div>' +
        '<div class="c-date num">' + fdate(it.dataAcquisto) + '</div>' +
        '<div class="c-flags">' + flags + '</div></div>';
    }).join("");
    var empty = !S.loaded.items ? '<div class="empty">Carico l\'inventario…</div>' :
      (!S.items.length ? '<div class="empty"><b>L\'inventario è vuoto</b>Aggiungi il primo bene con “Nuovo bene”. Ogni bene riceve un numero e potrai stampare la sua etichetta con la fonte dei fondi.</div>' :
        '<div class="empty"><b>Nessun bene corrisponde ai filtri</b>Cambia la ricerca o scegli “Tutti”.</div>');
    return '<div class="ledger">' +
      '<div><div class="k">Beni nella vista</div><div class="v">' + list.length + '</div></div>' +
      '<div><div class="k">Valore totale</div><div class="v">' + eur(tot) + '</div></div>' +
      '<div><div class="k">di cui IVA</div><div class="v">' + eur(iva) + '</div></div>' +
      '<div><div class="k">Senza fattura caricata</div><div class="v' + (nodoc ? " warn" : "") + '">' + nodoc + '</div></div></div>' +
      '<div class="toolbar"><input class="grow" type="search" id="q" placeholder="Cerca per nome, marca, n° fattura, progetto…" value="' + esc(S.f.q) + '" aria-label="Cerca">' +
      '<select id="fProj" aria-label="Progetto">' + popts + '</select>' +
      '<select id="fTipo" aria-label="Tipo"><option value="">Durevoli e consumo</option><option value="D"' + (S.f.tipo === "D" ? " selected" : "") + '>Solo durevoli</option><option value="C"' + (S.f.tipo === "C" ? " selected" : "") + '>Solo a consumo</option></select>' +
      (S.canWrite ? '<button class="btn primary" id="newItem">Nuovo bene</button>' : "") +
      (API.downloads ? '<button class="btn" id="csv">Esporta CSV</button>' : "") + '</div>' +
      '<div class="chips">' + chips + '</div>' +
      '<div class="table"><div class="row head"><div>N°</div><div>Bene</div><div>Progetto</div><div style="text-align:right">Importo</div><div style="text-align:right">Acquisto</div><div>Stato</div></div>' +
      (rows || empty) + '</div>';
  }
  function statoLabel(s) { return s === "dismesso" ? "Dismesso" : s === "donato" ? "Donato" : s === "smarrito" ? "Smarrito / rubato" : s === "ceduto" ? "Ceduto" : "In uso"; }
  function sortedProj() { return S.progetti.slice().sort(function (a, b) { var x = a.stato === "chiuso" ? 1 : 0, y = b.stato === "chiuso" ? 1 : 0; return x - y || String(a.nome).localeCompare(b.nome); }); }

  function fundLines(p) {
    if (!p) return { head: "FONTE DEI FONDI", text: "Da indicare", code: "" };
    var text = p.testoEtichetta || ((p.programma ? p.programma + " — " : "") + p.nome);
    return { head: "ACQUISTATO CON FONDI", text: text, code: p.codice ? "Cod. " + p.codice : "" };
  }

  function viewProgetti() {
    var rows = sortedProj().map(function (p) {
      var its = S.items.filter(function (i) { return i.progettoId === p.id; });
      var tot = its.reduce(function (a, i) { return a + (Number(i.valore) || 0); }, 0);
      var f = fundLines(p);
      return '<div class="proj" role="button" tabindex="0" data-proj="' + esc(p.id) + '"><div><h3>' + esc(p.nome) + '</h3><div class="code">' + esc(p.codice || "senza codice") + '</div><div class="prog">' + esc(p.programma || "") + '</div>' +
        '<div class="labelpreview"><span class="note">Sull\'etichetta:</span> ' + esc(f.text) + '</div></div>' +
        '<div class="note">' + its.length + (its.length === 1 ? " bene" : " beni") + ' · ' + eur(tot) + '</div>' +
        '<div><span class="pill ' + (p.stato === "chiuso" ? "mute" : "ok") + '">' + (p.stato === "chiuso" ? "Chiuso" : "Attivo") + '</span></div></div>';
    }).join("");
    return '<div class="toolbar"><div class="grow note">Ogni bene è collegato a un progetto. Il testo scelto qui finisce sull\'etichetta come fonte dei fondi.</div>' +
      (S.canAdmin ? '<button class="btn primary" id="newProj">Nuovo progetto</button>' : "") + '</div>' +
      '<div class="table">' + (rows || '<div class="empty"><b>Nessun progetto</b>' + (S.canAdmin ? "Crea il primo progetto con “Nuovo progetto”." : "Chiedi a un amministratore di creare i progetti.") + '</div>') + '</div>' +
      (S.canAdmin ? "" : '<p class="note">I progetti si modificano con ruolo di amministratore.</p>');
  }

  function viewImpostazioni() {
    var c = S.config, pag = (c.pagamenti || DEFAULT_PAG).join("\n");
    var dis = S.canAdmin ? "" : " disabled";
    return '<div class="sheet"><div class="grid2">' +
      '<div class="fld full"><label for="cMe">Il tuo nome (compare nello storico delle modifiche)</label><div style="display:flex;gap:8px"><input type="text" id="cMe" value="' + esc(S.names[S.me] || "") + '"><button class="btn" id="saveMe">Salva</button></div></div>' +
      '<div class="fld"><label for="cNome">Nome associazione</label><input type="text" id="cNome" value="' + esc(c.nome || "GiN APS") + '"' + dis + '></div>' +
      '<div class="fld"><label for="cTes">Link cartella Tesoreria (fatture e scontrini)</label><input type="url" id="cTes" value="' + esc(c.cartellaTesoreria || "") + '" placeholder="https://drive.google.com/…"' + dis + '></div>' +
      '<div class="fld full"><label for="cUrl">Indirizzo di questa pagina (per il QR code sulle etichette)</label><input type="url" id="cUrl" value="' + esc(c.appUrl || "") + '" placeholder="https://claude.ai/…"' + dis + '><div class="hint">Il QR apre direttamente la scheda del bene. Se lasci vuoto, il QR contiene solo il codice.</div></div>' +
      '<div class="fld full"><label for="cPag">Metodi di pagamento (uno per riga)</label><textarea id="cPag" rows="8"' + dis + '>' + esc(pag) + '</textarea></div></div>' +
      (S.canAdmin ? '<div><button class="btn primary" id="saveCfg">Salva impostazioni</button></div>' : '<p class="note">Solo chi ha ruolo di amministratore può cambiare le impostazioni.</p>') + '</div>';
  }

  /* ---------- etichette ---------- */
  function labelCandidates() {
    var q = S.lf.q.trim().toLowerCase();
    return S.items.filter(function (it) {
      if (S.lf.proj && it.progettoId !== S.lf.proj) return false;
      if (S.lf.solo && it.etichettaStampataAt) return false;
      if ((it.stato || "in_uso") !== "in_uso") return false;
      if (q && (codeOf(it) + " " + it.descrizione + " " + (it.marca || "")).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(cmp);
  }
  function viewEtichette() {
    var list = labelCandidates();
    var popts = '<option value="">Tutti i progetti</option>' + sortedProj().map(function (p) { return '<option value="' + esc(p.id) + '"' + (S.lf.proj === p.id ? " selected" : "") + '>' + esc(p.nome) + '</option>'; }).join("");
    var rows = list.map(function (it) {
      return '<label><input type="checkbox" data-sel="' + esc(it.id) + '"' + (S.sel.has(it.id) ? " checked" : "") + '><span class="tag">' + esc(codeOf(it)) + '</span><span class="d">' + esc(it.descrizione) + '<small>' + esc(projName(it.progettoId) || "progetto da indicare") + '</small></span><span class="pill ' + (it.etichettaStampataAt ? "ok" : "warn") + '">' + (it.etichettaStampataAt ? "stampata" : "da stampare") + '</span></label>';
    }).join("");
    var n = S.sel.size;
    var sopts = Object.keys(SIZES).map(function (k) { return '<option value="' + k + '"' + (S.size === k ? " selected" : "") + '>' + SIZES[k].label + '</option>'; }).join("");
    return '<div class="lab-layout"><div style="display:grid;gap:8px"><div class="toolbar"><input class="grow" type="search" id="lq" placeholder="Cerca bene…" value="' + esc(S.lf.q) + '" aria-label="Cerca bene"><select id="lProj" aria-label="Progetto">' + popts + '</select></div>' +
      '<div class="toolbar"><label class="note"><input type="checkbox" id="lSolo"' + (S.lf.solo ? " checked" : "") + '> Solo non ancora stampate</label><span class="grow"></span><button class="btn" id="selAll">Seleziona tutte</button><button class="btn" id="selNone">Nessuna</button></div>' +
      '<div class="pick">' + (rows || '<div class="empty">Nessun bene da mostrare. Togli il filtro “non ancora stampate” per vedere tutti.</div>') + '</div></div>' +
      '<div class="sheet"><div class="opts"><div><label class="l" for="lSize">Formato etichetta</label><select id="lSize">' + sopts + '</select></div>' +
      '<div><label class="l" for="lSkip">Salta le prime (foglio già usato)</label><input type="number" id="lSkip" min="0" max="23" value="' + S.skip + '"></div></div>' +
      '<div class="note">' + n + (n === 1 ? " etichetta selezionata" : " etichette selezionate") + '. Scarica il PDF e stampalo al 100%, senza adattare alla pagina.</div>' +
      '<div class="toolbar"><button class="btn primary" id="pdf"' + (n && API.downloads ? "" : " disabled") + '>Scarica PDF (A4)</button></div>' +
      '<div class="previews" id="previews"></div></div></div>';
  }

  var fontsP = null;
  function fontsReady() {
    if (!fontsP) fontsP = Promise.all([
      document.fonts.load('600 20px "IBM Plex Sans"'), document.fonts.load('400 20px "IBM Plex Sans"'), document.fonts.load('600 20px "IBM Plex Mono"')
    ]).catch(function () { });
    return fontsP;
  }
  function wrap(x, text, maxW, maxLines) {
    var words = String(text || "").split(/\s+/).filter(Boolean), lines = [], cur = "";
    for (var i = 0; i < words.length; i++) {
      var t = cur ? cur + " " + words[i] : words[i];
      if (x.measureText(t).width <= maxW || !cur) cur = t; else { lines.push(cur); cur = words[i]; }
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      var l = lines[maxLines - 1];
      while (l.length > 1 && x.measureText(l + "…").width > maxW) l = l.slice(0, -1);
      lines[maxLines - 1] = l + "…";
    }
    return lines;
  }
  function itemUrl(it) {
    var u = (S.config.appUrl || "").trim().replace(/#.*$/, "");
    return u ? u + "#" + it.id : "GINAPS " + it.id;
  }
  async function drawLabel(it, sz) {
    await fontsReady();
    var W = Math.round(sz.w / 25.4 * 300), H = Math.round(sz.h / 25.4 * 300);
    var cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    var x = cv.getContext("2d"), s = W / 827, m = 26 * s;
    x.fillStyle = "#fff"; x.fillRect(0, 0, W, H);
    x.strokeStyle = "#111"; x.lineWidth = 3 * s; x.strokeRect(1.5 * s, 1.5 * s, W - 3 * s, H - 3 * s);
    x.fillStyle = "#111"; x.textBaseline = "alphabetic";
    x.font = "600 " + 27 * s + 'px "IBM Plex Sans",sans-serif'; x.textAlign = "left";
    x.fillText(((S.config.nome || "GiN APS") + " · INVENTARIO").toUpperCase(), m, 52 * s);
    x.font = "600 " + 58 * s + 'px "IBM Plex Mono",monospace'; x.textAlign = "right";
    x.fillText("N° " + codeOf(it), W - m, 62 * s);
    x.fillRect(m, 78 * s, W - 2 * m, 3 * s);
    var q = 168 * s, qx = W - m - q, qy = 98 * s, tw = qx - m - 20 * s;
    x.textAlign = "left";
    x.font = "600 " + 35 * s + 'px "IBM Plex Sans",sans-serif';
    var y = 132 * s;
    wrap(x, it.descrizione, tw, 2).forEach(function (l) { x.fillText(l, m, y); y += 39 * s; });
    if (it.marca) { x.font = "400 " + 23 * s + 'px "IBM Plex Sans",sans-serif'; x.fillStyle = "#333"; x.fillText(wrap(x, it.marca, tw, 1)[0], m, y - 4 * s); y += 30 * s; x.fillStyle = "#111"; }
    var f = fundLines(projOf(it.progettoId));
    y += 6 * s; x.font = "600 " + 18 * s + 'px "IBM Plex Sans",sans-serif'; try { x.letterSpacing = 2 * s + "px"; } catch (e) { }
    x.fillText(f.head, m, y); try { x.letterSpacing = "0px"; } catch (e) { }
    y += 28 * s; x.font = "500 " + 27 * s + 'px "IBM Plex Sans",sans-serif';
    wrap(x, f.text, tw, 3).forEach(function (l) { x.fillText(l, m, y); y += 32 * s; });
    if (f.code) { x.font = "500 " + 20 * s + 'px "IBM Plex Mono",monospace'; x.fillText(wrap(x, f.code, tw, 1)[0], m, y + 2 * s); }
    x.font = "400 " + 19 * s + 'px "IBM Plex Sans",sans-serif'; x.fillStyle = "#333";
    var foot = [it.dataAcquisto ? "Acquisto " + fdate(it.dataAcquisto) : "", it.numFattura ? "Doc. " + it.numFattura : ""].filter(Boolean).join(" · ");
    x.fillText(wrap(x, foot, W - 2 * m, 1)[0] || "", m, H - m + 6 * s);
    if (typeof qrcode === "function") {
      try {
        var qr = qrcode(0, "M"); qr.addData(itemUrl(it)); qr.make();
        var n = qr.getModuleCount(), cell = Math.floor(q / (n + 2)), off = Math.floor((q - cell * n) / 2);
        x.fillStyle = "#111";
        for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (qr.isDark(r, c)) x.fillRect(qx + off + c * cell, qy + off + r * cell, cell, cell);
      } catch (e) { }
    }
    return cv;
  }
  var prevTimer = 0;
  function drawPreviews() {
    clearTimeout(prevTimer);
    prevTimer = setTimeout(async function () {
      var box = $("#previews"); if (!box) return;
      var ids = Array.from(S.sel).filter(function (id) { return S.items.some(function (i) { return i.id === id; }); });
      box.innerHTML = "";
      if (!ids.length) { box.innerHTML = '<div class="note">Seleziona uno o più beni a sinistra per vedere l\'anteprima delle etichette.</div>'; return; }
      var sz = SIZES[S.size];
      for (var k = 0; k < Math.min(ids.length, 12); k++) {
        var it = S.items.find(function (i) { return i.id === ids[k]; });
        var cv = await drawLabel(it, sz);
        if (!$("#previews")) return;
        box.appendChild(cv);
      }
      if (ids.length > 12) { var d = document.createElement("div"); d.className = "note"; d.textContent = "…e altre " + (ids.length - 12) + " nel PDF."; box.appendChild(d); }
    }, 60);
  }
  async function makePdf() {
    if (!window.jspdf) { toast("Libreria PDF non caricata. Ricarica la pagina."); return; }
    var sz = SIZES[S.size], per = sz.cols * sz.rows;
    var ids = Array.from(S.sel).map(function (id) { return S.items.find(function (i) { return i.id === id; }); }).filter(Boolean).sort(cmp);
    var pdf = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
    var x0 = (210 - sz.cols * sz.w) / 2, y0 = (297 - sz.rows * sz.h) / 2, pos = Math.max(0, Math.min(per - 1, S.skip | 0));
    var btn = $("#pdf"); if (btn) btn.disabled = true;
    for (var i = 0; i < ids.length; i++) {
      if (pos >= per) { pdf.addPage(); pos = 0; }
      var cv = await drawLabel(ids[i], sz), c = pos % sz.cols, r = Math.floor(pos / sz.cols);
      pdf.addImage(cv.toDataURL("image/png"), "PNG", x0 + c * sz.w, y0 + r * sz.h, sz.w, sz.h);
      pos++;
    }
    try {
      await API.downloads.save({ filename: "etichette-inventario-" + nowISO().slice(0, 10) + ".pdf", data: pdf.output("blob") });
      toast("PDF salvato.");
      for (var j = 0; j < ids.length; j++) { try { await API.db.doc("items/" + ids[j].id).update({ etichettaStampataAt: nowISO() }); } catch (e) { } }
    } catch (e) { if (e && e.code !== "declined") toast("Salvataggio non riuscito: " + errMsg(e)); }
    render();
  }

  /* ---------- CSV ---------- */
  async function exportCsv() {
    var list = filtered();
    var head = ["Numero", "Tipo", "Descrizione", "Marca e modello", "Progetto", "Codice progetto", "Metodo di pagamento", "Valore all'acquisto", "Aliquota IVA %", "Di cui IVA", "Imponibile", "Data acquisto", "Numero fattura/scontrino", "Documenti caricati", "Link documenti", "Stato", "Data cessazione", "Ubicazione/assegnatario", "Note", "Inserito da", "Data inserimento"];
    var q = function (v) { v = v == null ? "" : String(v); return '"' + v.replace(/"/g, '""') + '"'; };
    var num = function (n) { return n == null ? "" : String(Number(n).toFixed(2)).replace(".", ","); };
    var lines = [head.map(q).join(";")];
    list.forEach(function (it) {
      var p = projOf(it.progettoId) || {}, i = it.valore == null ? null : ivaIncl(it);
      lines.push([codeOf(it), it.tipo === "C" ? "A consumo" : "Durevole", it.descrizione, it.marca, p.nome, p.codice, it.pagamento, num(it.valore), it.iva == null ? 22 : it.iva, num(i), it.valore == null ? "" : num(it.valore - i), fdate(it.dataAcquisto).replace("—", ""), it.numFattura, (it.documenti || []).length, it.docLink, statoLabel(it.stato), fdate(it.dataCessazione).replace("—", ""), it.ubicazione, it.note, nameOf(it.createdBy, it.createdByLegacy), fdate(it.createdAt).replace("—", "")].map(q).join(";"));
    });
    try { await API.downloads.save({ filename: "inventario-" + nowISO().slice(0, 10) + ".csv", data: "﻿" + lines.join("\r\n") }); toast("File salvato."); }
    catch (e) { if (e && e.code !== "declined") toast("Salvataggio non riuscito: " + errMsg(e)); }
  }

  /* ---------- modali ---------- */
  var M = null;
  function openLayer(html) {
    $("#layer").innerHTML = '<div class="overlay" id="ov"><div class="modal" role="dialog" aria-modal="true">' + html + '</div></div>';
    $("#ov").addEventListener("mousedown", function (e) { if (e.target.id === "ov") closeLayer(); });
  }
  function closeLayer() { $("#layer").innerHTML = ""; M = null; }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && M) closeLayer(); });

  function fld(id, label, inner, cls, hint) { return '<div class="fld ' + (cls || "") + '"><label for="' + id + '">' + label + '</label>' + inner + (hint ? '<div class="hint">' + hint + '</div>' : "") + '</div>'; }
  function docListHtml() {
    if (!M.docs.length) return '<div class="note">Nessun file caricato.</div>';
    return M.docs.map(function (d, i) {
      return '<div class="doc"><span class="t">' + esc(d.tipo) + '</span><a href="#" data-doc="' + esc(d.id) + '">' + esc(d.nome) + '</a>' +
        (S.canWrite ? (M.confirmDoc === i ? '<button data-docdel="' + i + '"><b>Conferma rimozione</b></button>' : '<button data-docdel="' + i + '">Rimuovi</button>') : "") + '</div>';
    }).join("");
  }
  function openItem(id) {
    var it = id ? S.items.find(function (x) { return x.id === id; }) : null;
    var lastProj = ""; try { lastProj = localStorage.getItem("gin.lastProj") || ""; } catch (e) { }
    M = { kind: "item", id: id, isNew: !it, docs: ((it && it.documenti) || []).slice(), confirmDoc: -1, confirmDel: false };
    var v = it || { tipo: "D", iva: 22, stato: "in_uso", progettoId: lastProj };
    var ro = S.canWrite ? "" : " disabled";
    var popts = '<option value="">— da indicare —</option>' + sortedProj().map(function (p) { return '<option value="' + esc(p.id) + '"' + (v.progettoId === p.id ? " selected" : "") + '>' + esc(p.nome) + (p.stato === "chiuso" ? " (chiuso)" : "") + '</option>'; }).join("");
    var pag = (S.config.pagamenti || DEFAULT_PAG).map(function (p) { return '<option value="' + esc(p) + '">'; }).join("");
    var ivaOpts = [22, 10, 5, 4, 0].map(function (a) { return '<option value="' + a + '"' + (Number(v.iva == null ? 22 : v.iva) === a ? " selected" : "") + '>' + a + '%</option>'; }).join("");
    var stOpts = ["in_uso", "dismesso", "donato", "ceduto", "smarrito"].map(function (s) { return '<option value="' + s + '"' + ((v.stato || "in_uso") === s ? " selected" : "") + '>' + statoLabel(s) + '</option>'; }).join("");
    var tipoSel = '<select id="fTipoI"' + (it ? " disabled" : ro) + '><option value="D"' + (v.tipo === "D" ? " selected" : "") + '>Durevole (stampanti, tecnologia…)</option><option value="C"' + (v.tipo === "C" ? " selected" : "") + '>A consumo (bobine, materiali…)</option></select>';
    var upl = API.assets && S.canWrite ?
      '<div class="upl"><select id="dTipo" aria-label="Tipo documento">' + DOC_TIPI.map(function (t) { return '<option>' + t + '</option>'; }).join("") + '</select><label class="btn" for="dFile" style="cursor:pointer">Carica file o scatta foto</label><input type="file" id="dFile" accept="image/*,application/pdf" multiple hidden><span class="note" id="dStatus"></span></div>' :
      '<div class="banner" style="margin-top:8px">' + (S.canWrite ? "Per caricare file serve l'ruolo di amministratore. Puoi comunque incollare qui sotto il link al documento nella cartella Tesoreria." : "Sola lettura.") + '</div>';
    var tes = S.config.cartellaTesoreria ? ' <a href="' + esc(S.config.cartellaTesoreria) + '" target="_blank" rel="noopener">Apri cartella Tesoreria</a>' : "";
    openLayer(
      '<header><h2>' + (it ? '<span class="tag">' + esc(codeOf(it)) + '</span> ' + esc(it.descrizione) : "Nuovo bene") + '</h2><button class="btn" data-close>Chiudi</button></header>' +
      '<div class="body"><div class="grid2">' +
      fld("fTipoI", "Tipo", tipoSel, "full") +
      fld("fDesc", "Descrizione *", '<input type="text" id="fDesc" value="' + esc(v.descrizione || "") + '" placeholder="Es. Stampante 3D"' + ro + '>', "") +
      fld("fMarca", "Marca e modello", '<input type="text" id="fMarca" value="' + esc(v.marca || "") + '"' + ro + '>', "") +
      fld("fProgetto", "Progetto (fonte dei fondi) *", '<select id="fProgetto"' + ro + '>' + popts + '</select>', "full", "Compare sull'etichetta. I progetti si gestiscono nella scheda “Progetti e fondi”.") +
      fld("fValore", "Valore all'acquisto, IVA inclusa (€)", '<input type="text" inputmode="decimal" id="fValore" value="' + (v.valore == null ? "" : String(v.valore).replace(".", ",")) + '"' + ro + '>', "") +
      fld("fIva", "Aliquota IVA", '<select id="fIva"' + ro + '>' + ivaOpts + '</select>', "") +
      fld("fData", "Data di acquisto", '<input type="date" id="fData" value="' + esc(v.dataAcquisto || "") + '"' + ro + '>', "") +
      fld("fPag", "Metodo di pagamento", '<input type="text" id="fPag" list="pagList" value="' + esc(v.pagamento || "") + '"' + ro + '><datalist id="pagList">' + pag + '</datalist>', "") +
      fld("fFatt", "Numero fattura / scontrino", '<input type="text" id="fFatt" value="' + esc(v.numFattura || "") + '"' + ro + '>', "full") +
      '</div>' +
      '<fieldset><legend>Fatture e scontrini</legend><div class="docs" id="docs">' + docListHtml() + '</div>' + upl +
      '<div class="fld" style="margin-top:10px"><label for="fLink">Oppure link al documento (Drive, Tesoreria…)</label><input type="url" id="fLink" value="' + esc(v.docLink || "") + '"' + ro + '>' + (tes ? '<div class="hint">' + tes + '</div>' : "") + '</div></fieldset>' +
      '<div class="grid2">' +
      fld("fUbi", "Dove si trova / chi lo ha in custodia", '<input type="text" id="fUbi" value="' + esc(v.ubicazione || "") + '"' + ro + '>', "full") +
      fld("fStato", "Stato", '<select id="fStato"' + ro + '>' + stOpts + '</select>', "") +
      fld("fCess", "Data cessazione (se dismesso)", '<input type="date" id="fCess" value="' + esc(v.dataCessazione || "") + '"' + ro + '>', "") +
      fld("fNote", "Note", '<textarea id="fNote"' + ro + '>' + esc(v.note || "") + '</textarea>', "full") + '</div>' +
      (it ? '<fieldset><legend>Tracciabilità</legend><div class="note">Inserito da <b>' + esc(nameOf(it.createdBy, it.createdByLegacy)) + '</b> il ' + fdate(it.createdAt) + '</div><div class="hist" id="hist">Carico lo storico…</div></fieldset>' : "") +
      '</div>' +
      '<footer>' + (S.canWrite ? '<button class="btn primary" id="saveItem">Salva</button>' : "") + (it ? '<button class="btn" data-label="' + esc(it.id) + '">Etichetta</button>' : "") +
      '<span class="sp"></span>' + (it && S.canAdmin ? '<button class="btn danger" id="delItem">Elimina</button>' : "") + '</footer>');
    if (it) loadHistory(it.id);
  }
  async function loadHistory(id) {
    try {
      var snap = await API.db.collection("log").where("itemId", "==", id).get();
      var rows = snap.docs.map(function (d) { return d.data(); }).sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
      await resolveNames(rows.map(function (r) { return r.uid; }));
      var h = $("#hist"); if (!h) return;
      h.innerHTML = rows.length ? rows.slice(0, 12).map(function (r) { return '<div><time>' + fdate(r.at) + '</time><span>' + esc(nameOf(r.uid)) + ' · ' + esc(r.azione) + (r.dettaglio ? ': ' + esc(r.dettaglio) : "") + '</span></div>'; }).join("") : "Nessuna modifica registrata dopo l'importazione.";
    } catch (e) { var h2 = $("#hist"); if (h2) h2.textContent = ""; }
  }
  async function addLog(itemId, azione, dettaglio) { try { await API.db.collection("log").add({ itemId: itemId, uid: S.me, at: nowISO(), azione: azione, dettaglio: dettaglio || "" }); } catch (e) { } }

  async function uploadFiles(files) {
    var tipo = $("#dTipo").value, st = $("#dStatus");
    for (var i = 0; i < files.length; i++) {
      st.textContent = "Carico " + files[i].name + "…";
      try {
        var r = await API.assets.upload(files[i]);
        M.docs.push({ id: r.id, nome: files[i].name, tipo: tipo, mime: r.contentType, size: r.sizeBytes, by: S.me, at: nowISO() });
      } catch (e) { toast("Caricamento non riuscito (" + files[i].name + "): " + errMsg(e)); }
    }
    st.textContent = "";
    $("#docs").innerHTML = docListHtml();
    if (!M.isNew) {
      try { await API.db.doc("items/" + M.id).update({ documenti: M.docs, updatedAt: nowISO(), updatedBy: S.me }); await addLog(M.id, "documenti", "aggiunto " + tipo.toLowerCase()); toast("Documento salvato."); }
      catch (e) { toast("Documento caricato ma non collegato al bene: " + errMsg(e)); }
    } else toast("File pronto: premi Salva per collegarlo al bene.");
  }

  function readForm() {
    return {
      descrizione: $("#fDesc").value.trim(), marca: $("#fMarca").value.trim(), progettoId: $("#fProgetto").value,
      valore: parseNum($("#fValore").value), iva: Number($("#fIva").value), dataAcquisto: $("#fData").value, pagamento: $("#fPag").value.trim(),
      numFattura: $("#fFatt").value.trim(), docLink: $("#fLink").value.trim(), ubicazione: $("#fUbi").value.trim(),
      stato: $("#fStato").value, dataCessazione: $("#fCess").value, note: $("#fNote").value.trim(), documenti: M.docs
    };
  }
  var LBL = { descrizione: "descrizione", marca: "marca", progettoId: "progetto", valore: "importo", iva: "IVA", dataAcquisto: "data acquisto", pagamento: "pagamento", numFattura: "n° fattura", docLink: "link documento", ubicazione: "ubicazione", stato: "stato", dataCessazione: "data cessazione", note: "note" };
  async function saveItem() {
    var d = readForm();
    if (!d.descrizione) { toast("Scrivi la descrizione del bene."); $("#fDesc").focus(); return; }
    var btn = $("#saveItem"); btn.disabled = true;
    try {
      if (M.isNew) {
        var tipo = $("#fTipoI").value, num = 1;
        S.items.forEach(function (i) { if (i.tipo === tipo && (i.num || 0) >= num) num = i.num + 1; });
        var ref, tries = 0;
        for (;;) { ref = API.db.doc("items/" + tipo + num); var ex = await ref.get(); if (!ex.exists || tries++ > 20) break; num++; }
        d.tipo = tipo; d.num = num; d.createdAt = nowISO(); d.createdBy = S.me; d.updatedAt = d.createdAt; d.updatedBy = S.me;
        await ref.set(d);
        await addLog(tipo + num, "inserito", d.descrizione);
        try { localStorage.setItem("gin.lastProj", d.progettoId || ""); } catch (e) { }
        toast("Bene inserito con il numero " + (tipo === "C" ? num + "C" : num) + ".");
      } else {
        var old = S.items.find(function (i) { return i.id === M.id; }) || {}, ch = [];
        Object.keys(LBL).forEach(function (k) { if ((old[k] == null ? "" : old[k]) !== (d[k] == null ? "" : d[k])) ch.push(LBL[k]); });
        d.updatedAt = nowISO(); d.updatedBy = S.me;
        await API.db.doc("items/" + M.id).update(d);
        if (ch.length) await addLog(M.id, "modificato", ch.join(", "));
        toast("Modifiche salvate.");
      }
      closeLayer();
    } catch (e) { btn.disabled = false; toast("Salvataggio non riuscito: " + errMsg(e)); }
  }

  function openProj(id) {
    var p = id ? projOf(id) : null, v = p || { stato: "attivo", programma: "Corpo europeo di solidarietà" };
    var dis = S.canAdmin ? "" : " disabled";
    M = { kind: "proj", id: id };
    openLayer('<header><h2>' + (p ? esc(p.nome) : "Nuovo progetto") + '</h2><button class="btn" data-close>Chiudi</button></header><div class="body"><div class="grid2">' +
      fld("pNome", "Titolo del progetto *", '<input type="text" id="pNome" value="' + esc(v.nome || "") + '"' + dis + '>', "full") +
      fld("pCod", "Codice progetto", '<input type="text" id="pCod" value="' + esc(v.codice || "") + '"' + dis + '>', "") +
      fld("pStato", "Stato", '<select id="pStato"' + dis + '><option value="attivo"' + (v.stato !== "chiuso" ? " selected" : "") + '>Attivo</option><option value="chiuso"' + (v.stato === "chiuso" ? " selected" : "") + '>Chiuso</option></select>', "") +
      fld("pProg", "Programma / ente finanziatore", '<input type="text" id="pProg" value="' + esc(v.programma || "") + '" placeholder="Es. Erasmus+ · Corpo europeo di solidarietà"' + dis + '>', "full") +
      fld("pTesto", "Testo personalizzato per l'etichetta (facoltativo)", '<textarea id="pTesto" rows="3"' + dis + '>' + esc(v.testoEtichetta || "") + '</textarea>', "full", "Se lo compili sostituisce “programma — titolo” sulle etichette. Usa la dicitura richiesta dal finanziatore.") +
      fld("pNote", "Note interne", '<textarea id="pNote"' + dis + '>' + esc(v.note || "") + '</textarea>', "full") + '</div></div>' +
      '<footer>' + (S.canAdmin ? '<button class="btn primary" id="saveProj">Salva</button>' : '<span class="note">Solo chi ha ruolo di amministratore può modificare i progetti.</span>') + '</footer>');
  }
  async function saveProj() {
    var d = { nome: $("#pNome").value.trim(), codice: $("#pCod").value.trim(), stato: $("#pStato").value, programma: $("#pProg").value.trim(), testoEtichetta: $("#pTesto").value.trim(), note: $("#pNote").value.trim() };
    if (!d.nome) { toast("Scrivi il titolo del progetto."); return; }
    var id = M.id || ("p" + Date.now().toString(36));
    try { await API.db.doc("progetti/" + id).set(d); toast("Progetto salvato."); closeLayer(); } catch (e) { toast("Salvataggio non riuscito: " + errMsg(e)); }
  }

  /* ---------- eventi ---------- */
  document.addEventListener("click", async function (e) {
    var t = e.target.closest("button,[data-open],[data-proj],label.btn,a[data-doc]"); if (!t) return;
    if (t.dataset.doc) { e.preventDefault(); return window.GIN.openDoc(t.dataset.doc); }
    if (t.id === "logout") return window.GIN.logout();
    if (t.id === "loginBtn") {
      var em = $("#loginEmail").value.trim(), msg = $("#loginMsg"); if (!em) { msg.textContent = "Scrivi la tua email."; return; }
      t.disabled = true; msg.textContent = "Invio in corso…";
      try { await window.GIN.login(em); msg.textContent = "Controlla la posta: ti abbiamo inviato il link. Puoi chiudere questa pagina."; }
      catch (er) { t.disabled = false; msg.textContent = "Non riesco a inviare il link: " + errMsg(er); }
      return;
    }
    if (t.id === "saveMe") { var nm = $("#cMe").value.trim(); if (!nm) return; try { await window.GIN.setName(nm); S.names[S.me] = nm; toast("Nome salvato."); render(); } catch (er) { toast(errMsg(er)); } return; }
    var d = t.dataset;
    if (t.id === "newItem") return openItem();
    if (d.open) return openItem(d.open);
    if (d.proj) return openProj(d.proj);
    if (t.id === "newProj") return openProj();
    if (d.close !== undefined) return closeLayer();
    if (d.chip) { S.f.chip = d.chip; return render(); }
    if (d.v) { S.view = d.v; return render(); }
    if (t.id === "csv") return exportCsv();
    if (t.id === "saveItem") return saveItem();
    if (t.id === "saveProj") return saveProj();
    if (d.label) { S.sel = new Set([d.label]); S.view = "etichette"; S.lf.solo = false; closeLayer(); return render(); }
    if (d.docdel !== undefined) {
      var i = Number(d.docdel);
      if (M.confirmDoc !== i) { M.confirmDoc = i; $("#docs").innerHTML = docListHtml(); return; }
      var gone = M.docs.splice(i, 1)[0]; M.confirmDoc = -1; $("#docs").innerHTML = docListHtml();
      if (!M.isNew) { try { await API.db.doc("items/" + M.id).update({ documenti: M.docs, updatedAt: nowISO(), updatedBy: S.me }); await addLog(M.id, "documenti", "rimosso " + gone.nome); } catch (er) { toast(errMsg(er)); } }
      if (API.assets) { try { await API.assets.delete(gone.id); } catch (er) { } }
      return;
    }
    if (t.id === "delItem") {
      if (!M.confirmDel) { M.confirmDel = true; t.textContent = "Conferma eliminazione definitiva"; return; }
      try { await API.db.doc("items/" + M.id).delete(); await addLog(M.id, "eliminato", ""); toast("Bene eliminato."); closeLayer(); } catch (er) { toast(errMsg(er)); }
      return;
    }
    if (t.id === "saveCfg") {
      var cfg = { nome: $("#cNome").value.trim() || "GiN APS", cartellaTesoreria: $("#cTes").value.trim(), appUrl: $("#cUrl").value.trim(), pagamenti: $("#cPag").value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean) };
      try { await API.db.doc("config/main").set(cfg); toast("Impostazioni salvate."); } catch (er) { toast(errMsg(er)); }
      return;
    }
    if (t.id === "selAll") { labelCandidates().forEach(function (i) { S.sel.add(i.id); }); return render(); }
    if (t.id === "selNone") { S.sel.clear(); return render(); }
    if (t.id === "pdf") return makePdf();
  });
  document.addEventListener("keydown", function (e) {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches("[data-open],[data-proj]")) { e.preventDefault(); e.target.click(); }
  });
  document.addEventListener("input", function (e) {
    var t = e.target, id = t.id;
    var keep = function () { lastFocus = { id: id, s: t.selectionStart, e: t.selectionEnd }; };
    if (id === "q") { S.f.q = t.value; keep(); render(); }
    else if (id === "lq") { S.lf.q = t.value; keep(); render(); }
  });
  document.addEventListener("change", function (e) {
    var t = e.target, id = t.id; lastFocus = null;
    if (id === "fProj") { S.f.proj = t.value; render(); }
    else if (id === "fTipo") { S.f.tipo = t.value; render(); }
    else if (id === "lProj") { S.lf.proj = t.value; render(); }
    else if (id === "lSolo") { S.lf.solo = t.checked; render(); }
    else if (id === "lSize") { S.size = t.value; drawPreviews(); }
    else if (id === "lSkip") { S.skip = Number(t.value) || 0; }
    else if (t.dataset && t.dataset.sel) { if (t.checked) S.sel.add(t.dataset.sel); else S.sel.delete(t.dataset.sel); var n = S.sel.size; drawPreviews(); var b = $("#pdf"); if (b) b.disabled = !(n && API.downloads); }
    else if (id === "dFile") { uploadFiles(Array.from(t.files)); t.value = ""; }
  });

  /* ---------- avvio ---------- */
  render();
  var C = window.claude;
  if (!C || !C.use) { render(); return; }
  var got = await Promise.all(["db", "user", "assets", "downloads"].map(function (n) { return C.use(n).catch(function () { return null; }); }));
  API.db = got[0]; API.user = got[1]; API.assets = got[2]; API.downloads = got[3];
  S.booting = false;
  if (!API.db) { render(); return; }
  try {
    if (API.user) {
      S.me = await API.user.id(); S.canAdmin = !!(await API.user.canEdit());
      var cw = await API.user.can("data.write"); S.canWrite = cw !== false;
      if (S.me) resolveNames([S.me]);
    }
  } catch (e) { }
  var hashDone = false;
  function onErr(e) { toast("Errore di lettura: " + errMsg(e)); }
  API.db.collection("items").onSnapshot(function (snap) {
    S.items = snap.docs.map(function (d) { var o = d.data(); o.id = d.id; return o; });
    S.loaded.items = true;
    resolveNames(S.items.map(function (i) { return i.createdBy; }));
    render();
    if (!hashDone) {
      hashDone = true;
      var h = (location.hash || "").slice(1);
      if (h && S.items.some(function (i) { return i.id === h; })) openItem(h);
    }
  }, onErr);
  API.db.collection("progetti").onSnapshot(function (snap) {
    S.progetti = snap.docs.map(function (d) { var o = d.data(); o.id = d.id; return o; });
    S.loaded.progetti = true; render();
  }, onErr);
  API.db.doc("config/main").onSnapshot(function (snap) { S.config = snap.exists ? snap.data() : {}; if (!M) render(); }, onErr);
})();
