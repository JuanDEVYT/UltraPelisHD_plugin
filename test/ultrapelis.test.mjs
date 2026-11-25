// Tests de UltraPelisHD sin red: se imita kino (fetch, storage, config, log, rank, browser) y se
// monta el sitio en fixtures: la ficha con su puerta, la puerta con sus fuentes, el pass, la lista de
// servidores y los manifiestos. Lo que se prueba es el motor: sesión, presupuesto, caché, copias
// alternativas y la pantalla.
import test from "node:test";
import assert from "node:assert/strict";

// ── el sitio, en miniatura ───────────────────────────────────────────────────
const BASE = "https://ultrapelishd.com";
const PAPI = "https://api-encrypted.moviemaster.lat";
const PASS_PATH = "/api/player-pass?t=movie:533535:aaa";

const HLS_OK = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n720/index.m3u8\n";
const HLS_MEDIA = "#EXTM3U\n#EXTINF:10,\nseg1.ts\n#EXTINF:10,\nseg2.ts\n";

let puertaEstado = 200;      // 200 con fuentes, 401 sin sesión, 404 ficha cambiada
let m3u8Muerto = false;      // los manifiestos contestan 410 (el token caducó)
let fallaPrimeraCopia = false;

const pagina = (slugs) =>
  '<!doctype html><html><body>' +
  '<a class="cd" href="/movie/otra">Otra</a>' +
  '<div class="player" data-player><div class="facade" data-embed="watch-api-aaa" ' +
  'data-uph-watch="/api/uph-member-watch/movie/366"></div></div>' +
  slugs +
  "</body></html>";

const FUENTES = {
  ok: true,
  sources: {
    "watch-api-aaa": {
      html:
        '<iframe src="https://api-encrypted.moviemaster.lat/embed/movie/533535?lang=LAT" ' +
        'data-pass="/api/player-pass?t=movie:533535:aaa"></iframe>',
      host: "api-encrypted.moviemaster.lat",
    },
  },
};

const SERVIDORES = {
  servers: [
    { id: "1", k: "s1", name: "Servidor 1", lang: "LAT", type: "hls", mode: "direct" },
    { id: "2", k: "s2", name: "Servidor 2", lang: "LAT", type: "hls", mode: "direct" },
    { id: "3", k: "s3", name: "Servidor 3", lang: "SUB", type: "hls", mode: "proxy" },
  ],
};

const store = new Map();
const vistos = [];
let navegadorLlamadas = 0;

function respuesta(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => body,
    json: () => {
      try {
        return JSON.parse(body);
      } catch (e) {
        return null;
      }
    },
  };
}

async function fetchFalso(url, opciones) {
  const u = String(url);
  vistos.push(u);
  if (u === BASE + "/") return respuesta(200, pagina(""));
  if (u.indexOf(BASE + "/movie/") === 0 || u.indexOf(BASE + "/series/") === 0) return respuesta(200, pagina(""));
  if (u.indexOf("/api/uph-member-watch/") >= 0) {
    if (puertaEstado === 401) return respuesta(401, '{"ok":false,"error":"login_required"}');
    if (puertaEstado === 404) return respuesta(404, '{"error":"Not Found","status":404}');
    return respuesta(200, JSON.stringify(FUENTES));
  }
  if (u.indexOf("/api/player-pass") === 0 || u.indexOf(BASE + "/api/player-pass") === 0) return respuesta(200, '{"pass":"P1","ttl":600}');
  if (u.indexOf(PAPI + "/servers?") === 0) return respuesta(200, JSON.stringify(SERVIDORES));
  if (u.indexOf(PAPI + "/video?") === 0) {
    if (m3u8Muerto) return respuesta(410, '{"error":"token inválido o caducado"}');
    if (fallaPrimeraCopia && /embed=1(&|$)/.test(u)) return respuesta(404, "<html>404</html>");
    return respuesta(200, HLS_OK);
  }
  if (u.indexOf("/api/suggest") === 0) return respuesta(200, '{"titles":[{"title":"Deadpool","url":"/movie/deadpool-2016","type":"movie","year":2016}]}');
  return respuesta(404, "<html>404</html>");
}

globalThis.kino = {
  fetch: (url, opciones) => fetchFalso(url, opciones),
  error: (code, message, extra) => Object.assign(new Error(message || code), { code: code }, extra || {}),
  log: () => {},
  sleep: async () => {},
  lang: "es",
  config: { get: (k) => (k === "lang" ? "auto" : "") },
  storage: {
    get: (k) => (store.has(k) ? store.get(k) : null),
    set: (k, v) => store.set(k, v),
    remove: (k) => store.delete(k),
    keys: () => Array.from(store.keys()),
  },
  rank: { filterRelevant: (a) => a, shortQuery: (s) => s, sortBySimilarity: (a) => a },
  browser: {
    page: async () => {
      navegadorLlamadas++;
      throw Object.assign(new Error("not_allowed"), { code: "not_allowed" });
    },
    capture: async () => {
      navegadorLlamadas++;
      throw Object.assign(new Error("not_allowed"), { code: "not_allowed" });
    },
  },
};

const plugin = await import("../plugin.js");

const REF = "movie/deadpool-wolverine-2024";

function limpia() {
  store.clear();
  vistos.length = 0;
  navegadorLlamadas = 0;
  puertaEstado = 200;
  m3u8Muerto = false;
  fallaPrimeraCopia = false;
}

// ── resolve ─────────────────────────────────────────────────────────────────

test("resolve: sin sesión avisa de la cuenta y no insiste con el pass", async () => {
  limpia();
  puertaEstado = 401;
  await assert.rejects(
    () => plugin.resolve(REF),
    (e) => {
      assert.equal(e.code, "unavailable");
      assert.match(String(e.userMessage), /cuenta gratis/i);
      return true;
    },
  );
  assert.equal(vistos.some((u) => u.indexOf("player-pass") >= 0), false, "no se pide un pass que va a fallar");
});

test("resolve: entrega la primera copia con su etiqueta y el resto como alternativas", async () => {
  limpia();
  const r = await plugin.resolve(REF);
  assert.match(r.url, /\/video\?/);
  assert.match(r.url, /embed=1/);
  assert.equal(r.mime, "application/vnd.apple.mpegurl");
  assert.equal(r.label, "🇲🇽 Latino · Servidor 1");
  assert.equal(r.alternatives.length, 2);
  assert.deepEqual(r.alternatives.map((a) => a.ref), [REF + "|s2", REF + "|s3"]);
  assert.equal(r.alternatives[1].label, "🇬🇧 Subtitulado · Servidor 3");
  assert.ok(store.get("ok:" + REF), "queda guardado para la próxima");
});

test("resolve: si la primera copia da 404 salta a la siguiente", async () => {
  limpia();
  fallaPrimeraCopia = true;
  const r = await plugin.resolve(REF);
  assert.ok(/embed=2/.test(r.url), "abre la copia viva: " + r.url);
  assert.equal(r.label, "🇲🇽 Latino · Servidor 2");
});

test("resolve: si ninguna copia da manifiesto lo dice claro y rápido", async () => {
  limpia();
  m3u8Muerto = true;
  const t = Date.now();
  await assert.rejects(
    () => plugin.resolve(REF),
    (e) => {
      assert.equal(e.code, "unavailable");
      assert.match(String(e.userMessage), /Ninguna copia/);
      return true;
    },
  );
  assert.ok(Date.now() - t < 9000, "no se queda reintentando");
  assert.equal(store.get("ok:" + REF), undefined, "no se guarda nada muerto");
});

test("resolve: un enlace guardado que ya da 410 no se sirve y se borra", async () => {
  limpia();
  const uno = await plugin.resolve(REF);
  assert.ok(uno.url);
  m3u8Muerto = true;
  await assert.rejects(
    () => plugin.resolve(REF),
    (e) => {
      assert.match(String(e.userMessage), /Ninguna copia/);
      return true;
    },
  );
  assert.equal(store.get("ok:" + REF), undefined, "la caché muerta se borra");
});

test("resolve: la caché buena se sirve sin volver a pedir la ficha", async () => {
  limpia();
  await plugin.resolve(REF);
  vistos.length = 0;
  const dos = await plugin.resolve(REF);
  assert.ok(dos.url);
  assert.equal(vistos.some((u) => u.indexOf("/api/uph-member-watch/") >= 0), false, "no se reabre la ficha");
});

test("resolve: una copia diferida (ref con |) se abre con sesión fresca", async () => {
  limpia();
  const r = await plugin.resolve(REF + "|s3");
  assert.match(r.url, /embed=3/);
  assert.equal(r.label, "🇬🇧 Subtitulado · Servidor 3");
  assert.equal(r.alternatives, undefined, "una copia suelta no reparte alternativas");
});

test("resolve: 404 de la puerta se cuenta como ficha cambiada, no como cuenta", async () => {
  limpia();
  puertaEstado = 404;
  await assert.rejects(
    () => plugin.resolve(REF),
    (e) => {
      assert.equal(e.code, "not_found");
      assert.match(String(e.userMessage), /cambió las fuentes/i);
      return true;
    },
  );
});

test("prepare no lanza cuando el sitio pide cuenta", async () => {
  limpia();
  puertaEstado = 401;
  await plugin.prepare(REF);
  assert.equal(navegadorLlamadas, 0, "prepare no abre ventanas");
});

// ── pantalla ────────────────────────────────────────────────────────────────

test("pantalla: Scaffold con barra de Kino y cinco destinos en el teléfono", async () => {
  limpia();
  const v = await plugin.screen({ state: {}, device: "phone" });
  assert.equal(v.type, "Scaffold");
  assert.equal(v.appBar.mergeWithKinoBar, true);
  assert.equal(v.appBar.leading.icon, "close");
  assert.equal(v.bottomNavigationBar.type, "NavigationBar");
  assert.equal(v.bottomNavigationBar.items.length, 5);
  assert.equal(v.bottomNavigationBar.items[4].key, "ajustes");
  assert.equal(v.bottomNavigationBar.value, "inicio");
});

test("pantalla: en el televisor no hay barra inferior y los destinos van arriba", async () => {
  limpia();
  const v = await plugin.screen({ state: { nav: "peliculas" }, device: "tv" });
  assert.equal(v.bottomNavigationBar, undefined);
  const json = JSON.stringify(v.appBar);
  assert.match(json, /navTabs/, "los destinos van en la cabecera");
  assert.match(json, /"TabBar"|"tabBar"/);
});

test("pantalla: la navegación cambia de destino y la búsqueda cierra la hoja", async () => {
  limpia();
  const a = await plugin.screenEvent({ name: "nav", value: "series", state: { nav: "inicio" } });
  assert.equal(a.state.nav, "series");
  assert.deepEqual(a.ui, [{ hide: "busy" }]);

  const b = await plugin.screenEvent({ name: "search", value: "  deadpool  ", state: { nav: "inicio" } });
  assert.equal(b.state.query, "deadpool");
  assert.deepEqual(b.ui, [{ hide: "busy" }, { close: "buscar" }]);

  const c = await plugin.screenEvent({ name: "clearSearch", state: { nav: "inicio", query: "x" } });
  assert.equal(c.state.query, "");
});

test("pantalla: ajustes enseña el aviso de la cuenta y sus acciones", async () => {
  limpia();
  const v = await plugin.screen({ state: { nav: "ajustes" }, device: "phone" });
  const json = JSON.stringify(v);
  assert.match(json, /Iniciar sesión/);
  assert.match(json, /cuenta gratis/);
  assert.match(json, /Borrar la caché/);
});
