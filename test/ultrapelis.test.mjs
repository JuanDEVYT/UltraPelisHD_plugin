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

// ── el índice publicado, en miniatura ──────────────────────────────────────
const ASSET = "https://github.com/JuanDEVYT/UltraPelisHD_plugin/releases/download/catalog";
const V1 = { version: "2026.11.25-1100", movies: 2, series: 1, shards: [{ name: "catalog-1.json", bytes: 200 }], hosts: ["dood.xxx"] };
const V2 = { version: "2026.11.26-0900", movies: 3, series: 1, shards: [{ name: "catalog-1.json", bytes: 240 }], hosts: ["dood.xxx"] };
const SHARD1 = {
  version: V1.version,
  part: 1,
  parts: 1,
  hosts: ["dood.xxx"],
  movies:
    "533535|movie/deadpool-wolverine-2024|L0e/abc123,E0e/esp456\n" +
    "550|movie/fight-club-1999|L0e/fight01",
  series: "1399|series/game-of-thrones",
};
const DELTA = { version: V2.version, from: V1.version, addMovies: "999|movie/nueva-2026|L0e/nueva01", addSeries: "", remove: ["m:550"] };
let versionActual = V1;
let deltaActual = DELTA;

const catalogo = new Map();
let motorFalta = false;
const llamadasMotor = [];

const TMDB = {
  "/movie/533535": { id: 533535, title: "Deadpool y Wolverine", poster_path: "/p1.jpg", backdrop_path: "/b1.jpg", release_date: "2024-07-24", vote_average: 7.6, overview: "Dos antihéroes.", genres: [{ name: "Acción" }], runtime: 128, imdb_id: "tt6263850" },
  "/movie/550": { id: 550, title: "El club de la lucha", poster_path: "/p2.jpg", backdrop_path: "/b2.jpg", release_date: "1999-10-15", vote_average: 8.4, overview: "Reglas.", genres: [{ name: "Drama" }], runtime: 139 },
  "/movie/999": { id: 999, title: "Nueva", poster_path: "/p3.jpg", backdrop_path: "/b3.jpg", release_date: "2026-01-01", vote_average: 6, overview: "Nueva.", genres: [] },
  "/tv/1399": { id: 1399, name: "Juego de tronos", poster_path: "/t1.jpg", backdrop_path: "/tb1.jpg", first_air_date: "2011-04-17", vote_average: 8.4, overview: "Tronos.", genres: [{ name: "Drama" }], seasons: [{ season_number: 0, episode_count: 3 }, { season_number: 1, episode_count: 2 }], external_ids: { imdb_id: "tt0944947" } },
  "/genre/movie/list": { genres: [{ id: 28, name: "Acción" }, { id: 18, name: "Drama" }] },
  "/genre/tv/list": { genres: [{ id: 18, name: "Drama" }, { id: 10765, name: "Sci-Fi & Fantasy" }] },
};
const listaTmdb = (def, id) => ({ page: 1, total_pages: 1, results: [def] });
const TARJETA = { id: 533535, title: "Deadpool y Wolverine", poster_path: "/p1.jpg", backdrop_path: "/b1.jpg", release_date: "2024-07-24", vote_average: 7.6 };
const SERIE = { id: 1399, name: "Juego de tronos", poster_path: "/t1.jpg", backdrop_path: "/tb1.jpg", first_air_date: "2011-04-17", vote_average: 8.4 };

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
  if (u === ASSET + "/catalog.version.json") return respuesta(200, JSON.stringify(versionActual));
  if (u === ASSET + "/catalog-1.json") return respuesta(200, JSON.stringify(versionActual.version === V2.version ? { ...SHARD1, version: V2.version } : SHARD1));
  if (u.indexOf(ASSET + "/delta/") === 0) {
    const from = u.slice((ASSET + "/delta/").length).replace(/\.json$/, "");
    return respuesta(deltaActual && deltaActual.from === from ? 200 : 404, JSON.stringify(deltaActual || {}));
  }
  if (u === "https://cdn.example/dood.m3u8") return respuesta(200, HLS_OK);
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
  tmdb: async (path, params) => {
    const base = TMDB[path];
    if (!base) {
      if (path === "/trending/movie/week" || path === "/movie/popular" || path === "/movie/now_playing" || path === "/movie/top_rated") return listaTmdb(TARJETA);
      if (path === "/trending/tv/week" || path === "/tv/popular" || path === "/tv/top_rated") return listaTmdb(SERIE);
      if (path === "/discover/tv") return listaTmdb(SERIE);
      if (path === "/discover/movie") return listaTmdb(TARJETA);
      if (path === "/search/movie") return listaTmdb(TARJETA);
      if (path === "/search/tv") return listaTmdb(SERIE);
      throw Object.assign(new Error("404"), { code: "not_found" });
    }
    if (path === "/tv/1399" && params && params.append_to_response) {
      return {
        ...base,
        "season/1": { episodes: [{ episode_number: 1, name: "Invierno", still_path: "/s1.jpg", air_date: "2011-04-17", runtime: 60 }, { episode_number: 2, name: "El camino real" }] },
      };
    }
    return base;
  },
  catalog: {
    upsert: async (items) => { for (const it of items) catalogo.set(it.id, it); },
    get: async (ids) => ids.filter((id) => catalogo.has(id)).map((id) => catalogo.get(id)),
    remove: async (ids) => { for (const id of ids) catalogo.delete(id); },
    clear: async () => { catalogo.clear(); },
    count: async () => catalogo.size,
    search: async () => ({ items: [], total: 0 }),
  },
  plugins: {
    call: async (door, fn, args) => {
      llamadasMotor.push(args && args.url);
      if (motorFalta) throw Object.assign(new Error("provider_missing"), { code: "provider_missing" });
      return { streams: [{ url: "https://cdn.example/dood.m3u8", kind: "hls", referer: "https://dood.xxx/" }] };
    },
  },
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
  catalogo.clear();
  vistos.length = 0;
  llamadasMotor.length = 0;
  navegadorLlamadas = 0;
  puertaEstado = 200;
  m3u8Muerto = false;
  fallaPrimeraCopia = false;
  motorFalta = false;
  versionActual = V1;
  deltaActual = DELTA;
}

/** Deja el índice importado como si la persona ya lo hubiera descargado. */
async function importaIndice() {
  const r = await plugin.screenEvent({ name: "index", state: {} });
  let state = r.state;
  for (let i = 0; i < 6 && state && state.indexing; i++) state = (await plugin.screenEvent({ name: "indexTick", state })).state;
  return state;
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

// ── índice (kino.catalog + TMDB + deltas) ───────────────────────────────────

test("índice: las películas del catálogo se reproducen con el motor, sin abrir la puerta", async () => {
  limpia();
  await importaIndice();
  assert.equal(catalogo.size, 3, "2 películas + 1 serie");
  const r = await plugin.resolve("m:533535");
  assert.deepEqual(llamadasMotor, ["https://dood.xxx/e/abc123"]);
  assert.equal(r.label, "🇲🇽 Latino · DoodStream");
  assert.equal(r.mime, "application/vnd.apple.mpegurl");
  assert.equal(r.alternatives[0].ref, "c:E0e/esp456");
  assert.equal(vistos.some((u) => u.indexOf("/api/uph-member-watch/") >= 0), false, "no se abre la puerta");
});

test("índice: sin motor de reproducción cae a la sesión del sitio", async () => {
  limpia();
  await importaIndice();
  motorFalta = true;
  puertaEstado = 401;
  await assert.rejects(
    () => plugin.resolve("m:533535"),
    (e) => {
      assert.match(String(e.userMessage), /cuenta gratis/i);
      return true;
    },
  );
  assert.ok(vistos.some((u) => u.indexOf("/api/uph-member-watch/") >= 0), "probó la sesión");
});

test("inicio con índice: filas de TMDB filtradas por el catálogo", async () => {
  limpia();
  await importaIndice();
  const rows = await plugin.home();
  assert.ok(rows.length >= 3, "hay filas: " + rows.map((r) => r.title).join(", "));
  const rec = rows.find((r) => r.ref === "browse:recent");
  assert.ok(rec, "fila de recién agregadas");
  assert.equal(rec.items[0].ref, "m:533535");
  assert.equal(rec.items[0].title, "Deadpool y Wolverine");
  assert.ok(rec.items.some((i) => Array.isArray(i.badges) && i.badges.includes("Latino")), "chip de idioma");
  assert.ok(rows.some((r) => r.ref === "browse:recentTv" && r.items[0].ref === "s:1399"));
});

test("búsqueda, navegación y ficha usan TMDB y el índice", async () => {
  limpia();
  await importaIndice();
  const found = await plugin.search({ q: "deadpool" });
  assert.equal(found[0].ref, "m:533535");

  const page = await plugin.browse("browse:trending");
  assert.ok(page.items.some((i) => i.ref === "m:533535"));

  const cats = await plugin.categories();
  assert.ok(cats.some((c) => c.ref === "browse:genre:28"), "los géneros de TMDB");

  const d = await plugin.details("m:533535");
  assert.equal(d.title, "Deadpool y Wolverine");
  assert.equal(d.ids.tmdb, 533535);
  assert.equal(d.runtimeMinutes, 128);
});

test("episodios: los de TMDB, listos para la sesión", async () => {
  limpia();
  await importaIndice();
  const r = await plugin.episodes("s:1399");
  assert.equal(r.episodes.length, 2);
  assert.equal(r.episodes[0].ref, "e:1399:1:1");
  assert.equal(r.episodes[0].title, "Invierno");
  assert.equal(r.series.title, "Juego de tronos");
});

test("job: deja el delta preparado y el inicio lo aplica", async () => {
  limpia();
  await importaIndice();
  versionActual = V2;
  await plugin.job();
  assert.ok(store.get("catPending"), "el job guardó el delta");
  await plugin.home();
  assert.ok(catalogo.has("m:999"), "entra la película nueva");
  assert.equal(catalogo.has("m:550"), false, "sale la que ya no está");
  assert.equal(JSON.parse(store.get("catRecentM"))[0], "m:999");
  assert.equal(store.get("catVersion"), V2.version);
});

test("pantalla: el índice en curso enseña su barra y su tick", async () => {
  limpia();
  const v = await plugin.screen({ state: { indexing: true, indexPart: 1, indexShards: 2, indexSeen: 10, indexTotal: 20 }, device: "phone" });
  assert.equal(v.type, "Scaffold");
  const json = JSON.stringify(v);
  assert.match(json, /LinearProgressIndicator/);
  assert.match(json, /indexTick/);
  assert.match(json, /10 de 20/);
});

test("ajustes: la tarjeta del índice ofrece descargarlo", async () => {
  limpia();
  const v = await plugin.screen({ state: { nav: "ajustes" }, device: "phone" });
  const json = JSON.stringify(v);
  assert.match(json, /Catálogo sin descargar/);
  assert.match(json, /Descargar catálogo/);
  assert.match(json, /"onPressed":"index"/);
});
