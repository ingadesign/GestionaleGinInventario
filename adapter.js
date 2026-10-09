/* Collega l'interfaccia (app.js) a Supabase.
   Espone window.claude.use("db" | "user" | "assets" | "downloads") con le stesse funzioni usate da app.js,
   e window.GIN con login, logout e apertura dei documenti. */
(function () {
  "use strict";
  var cfg = window.GIN_CONFIG || {};
  var configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && !/INCOLLA/.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY));
  var sb = configured && window.supabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  var session = null, member = null;
  var BUCKET = "documenti";

  function E(err) { return { code: (err && (err.code || err.status)) || "error", message: (err && err.message) || "errore" }; }
  async function ck(p) { var r = await p; if (r.error) throw E(r.error); return r.data; }

  /* ---- corrispondenza campi app <-> tabella beni ---- */
  var BENI = [
    ["tipo", "tipo"], ["num", "num"], ["descrizione", "descrizione"], ["marca", "marca"], ["progettoId", "progetto_id"],
    ["pagamento", "pagamento"], ["valore", "valore", "num"], ["iva", "iva", "num"], ["dataAcquisto", "data_acquisto"],
    ["numFattura", "num_fattura"], ["docLink", "doc_link"], ["ubicazione", "ubicazione"], ["stato", "stato"],
    ["dataCessazione", "data_cessazione"], ["note", "note"], ["etichettaStampataAt", "etichetta_stampata_at"],
    ["createdAt", "created_at"], ["createdBy", "created_by"], ["createdByLegacy", "created_by_legacy"],
    ["updatedAt", "updated_at"], ["updatedBy", "updated_by"]
  ];
  var READONLY_ON_UPDATE = { created_at: 1, created_by: 1, created_by_legacy: 1, updated_at: 1, updated_by: 1, tipo: 1, num: 1 };
  function beneToRow(d, isUpdate) {
    var out = {};
    BENI.forEach(function (m) {
      var k = m[0], c = m[1];
      if (!(k in d)) return;
      if (isUpdate && READONLY_ON_UPDATE[c]) return;
      if (c === "updated_at" || c === "updated_by") return; // li imposta il database
      var v = d[k];
      if (v === "" || v === undefined) v = (c === "descrizione") ? "" : null;
      if (c === "iva" && v == null) v = 22;
      out[c] = v;
    });
    return out;
  }
  function docFromRow(r) { return { id: r.path, nome: r.nome, tipo: r.tipo, mime: r.mime, size: r.size, by: r.uploaded_by, at: r.uploaded_at }; }
  function beneFromRow(r) {
    var o = {};
    BENI.forEach(function (m) {
      var v = r[m[1]];
      if (m[2] === "num") o[m[0]] = v == null ? null : Number(v);
      else o[m[0]] = v == null ? "" : v;
    });
    if (o.iva === "" || o.iva == null) o.iva = 22;
    o.documenti = (r.documenti || []).slice().sort(function (a, b) { return String(a.uploaded_at).localeCompare(String(b.uploaded_at)); }).map(docFromRow);
    return o;
  }
  var PROJ = [["nome", "nome"], ["codice", "codice"], ["stato", "stato"], ["programma", "programma"], ["testoEtichetta", "testo_etichetta"], ["note", "note"]];
  function projFromRow(r) { var o = {}; PROJ.forEach(function (m) { o[m[0]] = r[m[1]] == null ? "" : r[m[1]]; }); return o; }
  function projToRow(d) { var o = {}; PROJ.forEach(function (m) { if (m[0] in d) o[m[1]] = d[m[0]] === "" ? null : d[m[0]]; }); if (!o.nome) o.nome = d.nome; return o; }
  function cfgFromRow(r) { return { nome: r.nome || "", cartellaTesoreria: r.cartella_tesoreria || "", appUrl: r.app_url || "", pagamenti: r.pagamenti || [] }; }

  /* ---- lettura ---- */
  async function fetchAll(kind) {
    if (kind === "items") { var rows = await ck(sb.from("beni").select("*, documenti(*)")); return rows.map(function (r) { return { id: r.id, data: beneFromRow(r) }; }); }
    if (kind === "progetti") { var p = await ck(sb.from("progetti").select("*")); return p.map(function (r) { return { id: r.id, data: projFromRow(r) }; }); }
    if (kind === "config") { var c = await ck(sb.from("config").select("*").eq("id", 1).maybeSingle()); return c ? [{ id: "main", data: cfgFromRow(c) }] : []; }
    return [];
  }
  function snapOf(list) { return { docs: list.map(function (x) { return { id: x.id, data: function () { return JSON.parse(JSON.stringify(x.data)); } }; }) }; }

  var listeners = [], timer = 0;
  function listen(kind, id, cb, errCb) {
    var l = { kind: kind, id: id, cb: cb, errCb: errCb };
    listeners.push(l); run(l);
    return function () { listeners = listeners.filter(function (x) { return x !== l; }); };
  }
  async function run(l) {
    try {
      var list = await fetchAll(l.kind);
      if (l.id) { var hit = list.filter(function (x) { return x.id === l.id; })[0]; l.cb({ exists: !!hit, data: function () { return hit ? hit.data : undefined; } }); }
      else l.cb(snapOf(list));
    } catch (e) { if (l.errCb) l.errCb(e); }
  }
  function refreshSoon() { clearTimeout(timer); timer = setTimeout(function () { listeners.slice().forEach(run); }, 250); }

  /* ---- scrittura ---- */
  async function syncDocs(beneId, docs) {
    var rows = await ck(sb.from("documenti").select("id,path").eq("bene_id", beneId));
    var have = {}; rows.forEach(function (r) { have[r.path] = r.id; });
    var want = {}; (docs || []).forEach(function (d) { want[d.id] = d; });
    var add = Object.keys(want).filter(function (p) { return !(p in have); }).map(function (p) {
      var d = want[p]; return { bene_id: beneId, tipo: d.tipo || "Altro", nome: d.nome || "documento", path: p, mime: d.mime || null, size: d.size || null };
    });
    var gone = Object.keys(have).filter(function (p) { return !(p in want); }).map(function (p) { return have[p]; });
    if (add.length) await ck(sb.from("documenti").insert(add));
    if (gone.length) await ck(sb.from("documenti").delete().in("id", gone));
  }
  async function write(coll, id, d, isUpdate) {
    if (coll === "items") {
      var row = beneToRow(d, isUpdate);
      if (!isUpdate) { row.id = id; await ck(sb.from("beni").insert(row)); }
      else if (Object.keys(row).length) await ck(sb.from("beni").update(row).eq("id", id));
      if ("documenti" in d) await syncDocs(id, d.documenti);
    } else if (coll === "progetti") {
      var pr = projToRow(d); pr.id = id; await ck(sb.from("progetti").upsert(pr));
    } else if (coll === "config") {
      await ck(sb.from("config").upsert({ id: 1, nome: d.nome || null, cartella_tesoreria: d.cartellaTesoreria || null, app_url: d.appUrl || null, pagamenti: d.pagamenti || [] }));
    } else throw { code: "invalid_argument", message: "collezione sconosciuta" };
    refreshSoon();
  }
  async function remove(coll, id) {
    if (coll === "items") await ck(sb.from("beni").delete().eq("id", id));
    else if (coll === "progetti") await ck(sb.from("progetti").delete().eq("id", id));
    refreshSoon();
  }
  function docRef(path) {
    var p = path.split("/"), c = p[0], id = p[1];
    return {
      get: async function () {
        var list = await fetchAll(c), hit = list.filter(function (x) { return x.id === id; })[0];
        return { exists: !!hit, data: function () { return hit ? hit.data : undefined; } };
      },
      set: function (d) { return write(c, id, d, false); },
      update: function (d) { return write(c, id, d, true); },
      delete: function () { return remove(c, id); },
      onSnapshot: function (cb, err) { return listen(c, id, cb, err); }
    };
  }
  var db = {
    doc: docRef,
    collection: function (name) {
      return {
        onSnapshot: function (cb, err) { return listen(name, null, cb, err); },
        add: async function () { /* lo storico lo scrive il database da solo */ },
        where: function (f, op, v) {
          return {
            get: async function () {
              if (name !== "log") return { docs: [] };
              var rows = await ck(sb.from("storico").select("*").eq("bene_id", v).order("at", { ascending: false }).limit(30));
              return { docs: rows.map(function (r) { return { id: String(r.id), data: function () { return { itemId: r.bene_id, uid: r.user_id, at: r.at, azione: r.azione, dettaglio: r.dettaglio }; } }; }) };
            }
          };
        }
      };
    }
  };

  /* ---- utenti, file, download ---- */
  var user = {
    id: async function () { return session ? session.user.id : null; },
    canEdit: async function () { return !!member && member.ruolo === "admin"; },
    can: async function () { return !!member; },
    profiles: async function (ids) {
      var rows = await ck(sb.from("members").select("user_id,nome,email").in("user_id", ids)), out = {};
      rows.forEach(function (r) { out[r.user_id] = { name: r.nome || (r.email || "").split("@")[0] }; });
      return out;
    }
  };
  function safe(n) { return String(n || "file").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80); }
  var assets = {
    upload: async function (blob) {
      var id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
      var path = session.user.id + "/" + id + "-" + safe(blob.name);
      await ck(sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || "application/octet-stream" }));
      return { id: path, url: null, sizeBytes: blob.size, contentType: blob.type };
    },
    delete: async function (path) { await ck(sb.storage.from(BUCKET).remove([path])); }
  };
  var downloads = {
    save: async function (req) {
      var blob = req.data instanceof Blob ? req.data : new Blob([req.data]);
      var url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = req.filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      return { status: "saved" };
    }
  };

  /* ---- sessione ---- */
  var ready = (async function () {
    if (!sb) return;
    try {
      var r = await sb.auth.getSession(); session = r.data.session;
      if (session) {
        var m = await sb.from("members").select("*").eq("user_id", session.user.id).maybeSingle();
        member = m.data || null;
      }
    } catch (e) { }
    sb.auth.onAuthStateChange(function (ev, s) {
      if (ev === "SIGNED_OUT") location.reload();
      else if (ev === "SIGNED_IN" && !session && s) location.reload();
    });
    if (session && member) {
      try {
        sb.channel("gin-live").on("postgres_changes", { event: "*", schema: "public" }, refreshSoon).subscribe();
      } catch (e) { }
      document.addEventListener("visibilitychange", function () { if (!document.hidden) refreshSoon(); });
      setInterval(refreshSoon, 120000);
    }
  })();

  window.GIN = {
    configured: configured,
    get signedIn() { return !!session; },
    login: async function (email) {
      var r = await sb.auth.signInWithOtp({ email: email, options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname } });
      if (r.error) throw E(r.error);
    },
    logout: async function () { try { await sb.auth.signOut(); } catch (e) { } location.reload(); },
    setName: async function (nome) {
      await ck(sb.from("members").update({ nome: nome }).eq("user_id", session.user.id));
      if (member) member.nome = nome;
    },
    openDoc: async function (path) {
      var w = window.open("", "_blank");
      try {
        var r = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
        if (r.error) throw r.error;
        if (w) w.location = r.data.signedUrl; else location.href = r.data.signedUrl;
      } catch (e) { if (w) w.close(); alert("Non riesco ad aprire il documento: " + (e.message || e)); }
    }
  };
  window.claude = {
    use: async function (name) {
      await ready;
      if (!sb || !session || !member) return null;
      return { db: db, user: user, assets: assets, downloads: downloads }[name] || null;
    }
  };
})();
