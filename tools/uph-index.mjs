#!/usr/bin/env node
//
// Construye el índice de reproducción de UltraPelisHD y lo empaqueta para el release `catalog`.
//
//   node tools/uph-index.mjs collect                 lee los sitemaps y guarda la lista de fichas
//   node tools/uph-index.mjs crawl [opciones]        recorre las fichas y apunta las copias DoodStream
//   node tools/uph-index.mjs build                   arma catalog.json (+ deltas) para publicar
//   node tools/uph-index.mjs status                  resume lo que hay hecho
//
// Opciones de `crawl`:
//   --only movies|series   limita a un tipo de ficha
//   --limit N              se detiene tras N fichas nuevas (para probar)
//   --concurrency N        peticiones a la vez (por defecto 4)
//   --delay MS             espera entre peticiones de un mismo worker (por defecto 120)
//
// Necesita la sesión de `node tools/uph-login.mjs`. Lo único que se guarda en disco son las rutas,
// los ids de TMDB y los códigos de las copias públicas de DoodStream; nunca la cuenta ni la sesión
// dentro del catálogo.
//
// El avance queda en out/entries.ndjson: si se corta, al volver a lanzarlo sigue donde iba.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(REPO, "out");
const SESSION = join(REPO, ".uph-session.json");
const URLS = join(OUT, "urls.json");
const ENTRIES = join(OUT, "entries.ndjson");
const ERRORS = join(OUT, "errors.ndjson");
const HOSTS = join(OUT, "hosts.json");
const PREV = join(OUT, "prev.json");
const BASE = "https://ultrapelishd.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
// kino.fetch corta el cuerpo a 5 MB: cada trozo del catálogo queda muy por debajo.
const SHARD_BYTES = 4_200_000;
const MAX_SLOTS = 6;

mkdirSync(OUT, { recursive: true });
mkdirSync(join(OUT, "delta"), { recursive: true });

// ---------------------------------------------------------------- sesión y http

let cookie = "";
function loadSession() {
  if (!existsSync(SESSION)) return false;
  try {
    const o = JSON.parse(readFileSync(SESSION, "utf8"));
    const pairs = Object.entries(o.cookies || {}).map(([k, v]) => `${k}=${v}`);
    cookie = pairs.join("; ");
    return pairs.length > 0;
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(url, { json = false, timeoutMs = 20000, method = "GET", body = null } = {}) {
  const headers = { "User-Agent": UA, "Accept-Language": "es-MX,es;q=0.9,en;q=0.8" };
  headers.Accept = json ? "application/json" : "text/html,application/xhtml+xml,*/*;q=0.8";
  if (cookie) headers.Cookie = cookie;
  if (method === "GET") headers.Referer = BASE + "/";
  const res = await fetch(url, { method, headers, body, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  return { status: res.status, ok: res.ok, body: text, url: res.url || url };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- fichas

function tmdbOf(html, kind) {
  const re = new RegExp("themoviedb\\.org\\/" + (kind === "series" ? "tv" : "movie") + "\\/(\\d+)");
  const m = re.exec(String(html || ""));
  return m ? Number(m[1]) : 0;
}

function gateOf(html) {
  const m = /data-uph-watch="([^"]+)"/.exec(String(html || ""));
  return m ? m[1].replace(/&amp;/g, "&") : "";
}

/** ¿La ficha anuncia alguna copia de un servidor indexable? (`data-embed="watch-source-…"`) */
const hasSourceCopies = (html) => /data-embed="watch-source-\d+"/.test(String(html || ""));

const LANG_LETTER = { latino: "L", castellano: "E", subtitulado: "S", ingles: "I", original: "O" };
function langMap(html) {
  const map = {};
  const re = /<details[^>]*class="dd dd-s"[^>]*id="lp-([a-z]+)"[^>]*>([\s\S]*?)<\/details>/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    const letter = LANG_LETTER[m[1]] || "";
    if (!letter) continue;
    const b = /data-embed="([^"]+)"/g;
    let k;
    while ((k = b.exec(m[2]))) map[k[1]] = letter;
  }
  return map;
}

function iframeSrc(html) {
  const raw = String(html || "");
  const tag = (/<iframe[^>]*>/i.exec(raw) || [raw])[0];
  const m = /src=["']([^"']+)/i.exec(tag);
  return m ? m[1].replace(/&amp;/g, "&") : "";
}

const DOOD = /dood|ds2play|dsvplay|d0000d|do0od/i;

/** Los hosts de DoodStream que aparecen, en una tabla estable host → un dígito hexadecimal. */
function hostsTable() {
  if (!existsSync(HOSTS)) return [];
  try {
    const o = JSON.parse(readFileSync(HOSTS, "utf8"));
    return Array.isArray(o.hosts) ? o.hosts : [];
  } catch {
    return [];
  }
}
function hostIndex(host) {
  const table = hostsTable();
  const at = table.indexOf(host);
  if (at >= 0) return at;
  if (table.length >= 16) return -1;
  table.push(host);
  writeFileSync(HOSTS, JSON.stringify({ hosts: table }, null, 2) + "\n");
  return table.length - 1;
}

/** Una copia como `<idioma><host><camino>`: "L0e/ab12cd34". */
function slotOf(lang, url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return "";
  }
  if (!DOOD.test(u.hostname)) return "";
  const path = u.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!/^[a-z]{1,3}\/[A-Za-z0-9]+$/.test(path)) return "";
  const h = hostIndex(u.hostname);
  if (h < 0) return "";
  return lang + h.toString(16) + path;
}

// ---------------------------------------------------------------- collect

async function collect() {
  const index = await request(BASE + "/sitemap.xml");
  if (!index.ok) throw new Error("sitemap.xml respondió " + index.status);
  const maps = [...String(index.body).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const movies = [];
  const series = [];
  let launch = 0;
  for (const url of maps) {
    const name = url.split("/").pop();
    if (/^sitemap-(genres|pages)/.test(name)) continue;
    const r = await request(url);
    if (!r.ok) {
      console.warn("· " + name + " respondió " + r.status);
      continue;
    }
    let added = 0;
    for (const m of String(r.body).matchAll(/<url>[\s\S]*?<loc>([^<]+)<\/loc>[\s\S]*?<lastmod>([^<]*)<\/lastmod>[\s\S]*?<\/url>/g)) {
      const loc = m[1];
      const lastmod = m[2] || "";
      const path = loc.replace(BASE + "/", "");
      if (/^movie\//.test(path)) {
        movies.push({ path, lastmod });
        added++;
      } else if (/^series\//.test(path)) {
        series.push({ path, lastmod });
        added++;
      }
    }
    if (/^sitemap-launch/.test(name)) launch += added;
    console.log("· " + name + ": " + added + " fichas");
  }
  const dedupe = (list) => {
    const seen = new Set();
    return list.filter((x) => !seen.has(x.path) && seen.add(x.path));
  };
  const out = { at: new Date().toISOString(), movies: dedupe(movies), series: dedupe(series) };
  writeFileSync(URLS, JSON.stringify(out) + "\n");
  console.log("\nPelículas: " + out.movies.length + " · Series: " + out.series.length + " · (launch solapadas: " + launch + ")");
  console.log("Guardado en " + URLS.replace(REPO + "/", ""));
}

// ---------------------------------------------------------------- crawl

function entries() {
  if (!existsSync(ENTRIES)) return [];
  return readFileSync(ENTRIES, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** La puerta del título: sus copias DoodStream, ya como slots. Lanza si la sesión ya no vale. */
async function gateSlots(gatePath, langOf) {
  const url = /^https?:\/\//.test(gatePath) ? gatePath : BASE + gatePath;
  const r = await request(url, { json: true, timeoutMs: 15000 });
  if (r.status === 401 || r.status === 403) {
    const e = new Error("la puerta respondió " + r.status + ": la sesión ya no vale");
    e.session = true;
    throw e;
  }
  if (!r.ok) throw new Error("la puerta respondió " + r.status);
  const data = parseJson(r.body);
  const sources = (data && data.sources) || {};
  const slots = [];
  const langs = [];
  for (const [key, value] of Object.entries(sources)) {
    const src = iframeSrc(value && (value.html || value.src));
    if (!src) continue;
    const lang = langOf[key] || "";
    const slot = slotOf(lang || "?", src);
    if (!slot) continue;
    if (slots.includes(slot)) continue;
    slots.push(slot);
    langs.push(lang || "?");
    if (slots.length >= MAX_SLOTS) break;
  }
  return { slots, langs, keys: Object.keys(sources).length };
}

async function movieEntry(item) {
  const r = await request(BASE + "/" + item.path);
  if (!r.ok) throw new Error("ficha " + r.status);
  const page = r.body;
  const tmdb = tmdbOf(page, "movie");
  if (!tmdb) return null; // sin id de TMDB no hay forma de nombrarla
  if (!hasSourceCopies(page)) return null; // solo copias «Automático»: no se puede indexar
  const gate = gateOf(page);
  if (!gate) return null;
  const { slots } = await gateSlots(gate, langMap(page));
  if (!slots.length) return null;
  return { kind: "movie", tmdb, path: item.path, lastmod: item.lastmod, slots: slots.join(",") };
}

async function seriesEntry(item) {
  const r = await request(BASE + "/" + item.path);
  if (!r.ok) throw new Error("ficha " + r.status);
  const tmdb = tmdbOf(r.body, "series");
  if (!tmdb) return null;
  return { kind: "series", tmdb, path: item.path, lastmod: item.lastmod };
}

async function crawl({ only, limit, concurrency, delay }) {
  if (!existsSync(URLS)) await collect();
  if (!loadSession()) {
    console.error("No hay sesión. Ejecuta antes: node tools/uph-login.mjs");
    process.exit(1);
  }
  const list = JSON.parse(readFileSync(URLS, "utf8"));
  const todo = [];
  for (const p of list.movies) if (!only || only === "movies") todo.push({ type: "movie", path: p.path, lastmod: p.lastmod });
  for (const p of list.series) if (!only || only === "series") todo.push({ type: "series", path: p.path, lastmod: p.lastmod });

  const done = new Set(entries().map((e) => e.kind + ":" + e.tmdb + ":" + e.path));
  const seenPath = new Set(entries().map((e) => e.path));
  const pending = todo.filter((x) => !seenPath.has(x.path));
  console.log("Pendientes: " + pending.length + " de " + todo.length + " (ya hechas: " + done.size + ")");

  let added = 0;
  let next = 0;
  let stop = false;
  const target = limit && limit > 0 ? limit : Infinity;

  const worker = async () => {
    while (!stop) {
      const i = next++;
      if (i >= pending.length) return;
      const item = pending[i];
      try {
        const entry = item.type === "movie" ? await movieEntry(item) : await seriesEntry(item);
        if (entry) {
          appendFileSync(ENTRIES, JSON.stringify(entry) + "\n");
          added++;
        }
      } catch (e) {
        if (e && e.session) {
          stop = true;
          console.error("\n" + e.message + " · vuelve a iniciar sesión con: node tools/uph-login.mjs");
          return;
        }
        appendFileSync(ERRORS, JSON.stringify({ at: new Date().toISOString(), path: item.path, error: String((e && e.message) || e) }) + "\n");
      }
      if (added % 25 === 0) {
        console.log("· " + added + " nuevas · " + i + "/" + pending.length + " · " + item.path);
      }
      if (added >= target) {
        stop = true;
        return;
      }
      if (delay) await sleep(delay);
    }
  };

  const started = Date.now();
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  const mins = Math.max(1, Math.round((Date.now() - started) / 60000));
  console.log("\nHecho: " + added + " fichas nuevas en " + mins + " min. Total en el índice: " + entries().length + ".");
  if (added) console.log("Siguiente paso: node tools/uph-index.mjs build");
}

// ---------------------------------------------------------------- build

const pad2 = (n) => String(n).padStart(2, "0");
function versionOf(d = new Date()) {
  return d.getUTCFullYear() + "." + pad2(d.getUTCMonth() + 1) + "." + pad2(d.getUTCDate()) + "-" + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes());
}

async function build() {
  const list = entries();
  if (!list.length) throw new Error("no hay fichas en el índice; ejecuta antes: node tools/uph-index.mjs crawl");
  const byKey = new Map();
  for (const e of list) byKey.set(e.kind + ":" + e.tmdb, e); // la última lectura manda
  const movies = [];
  const series = [];
  for (const e of byKey.values()) {
    if (e.kind === "movie") movies.push(e.tmdb + "|" + e.path + "|" + e.slots);
    else series.push(e.tmdb + "|" + e.path);
  }
  movies.sort((a, b) => Number(b.split("|")[0]) - Number(a.split("|")[0])); // el build los deja en orden estable
  series.sort((a, b) => Number(b.split("|")[0]) - Number(a.split("|")[0]));

  const version = versionOf();
  const hosts = hostsTable();
  const versionFile = { version, at: new Date().toISOString(), movies: movies.length, series: series.length, shards: [], hosts };

  // Trozos por tamaño: cada uno se descarga con un fetch normal, sin llegar al tope de 5 MB.
  const shards = [];
  let cur = { movies: [], series: [], bytes: 0 };
  const push = (kind, line) => {
    const size = Buffer.byteLength(line) + 1;
    if (cur.bytes + size > SHARD_BYTES && (cur.movies.length || cur.series.length)) {
      shards.push(cur);
      cur = { movies: [], series: [], bytes: 0 };
    }
    cur[kind].push(line);
    cur.bytes += size;
  };
  for (const line of movies) push("movies", line);
  for (const line of series) push("series", line);
  if (cur.movies.length || cur.series.length) shards.push(cur);

  shards.forEach((s, i) => {
    const name = "catalog-" + (i + 1) + ".json";
    versionFile.shards.push({ name, bytes: s.bytes });
    writeFileSync(
      join(OUT, name),
      JSON.stringify({ version, part: i + 1, parts: shards.length, hosts, movies: s.movies.join("\n"), series: s.series.join("\n") }) + "\n",
    );
  });
  writeFileSync(join(OUT, "catalog.version.json"), JSON.stringify(versionFile, null, 2) + "\n");

  // Delta desde la versión anterior, si la hay: lo nuevo y lo que se fue.
  let prev = null;
  if (existsSync(PREV)) {
    try {
      prev = JSON.parse(readFileSync(PREV, "utf8"));
    } catch {
      prev = null;
    }
  }
  if (prev && prev.version && prev.version !== version) {
    const nowM = new Map(movies.map((l) => [l.split("|")[0], l]));
    const nowS = new Map(series.map((l) => [l.split("|")[0], l]));
    const addMovies = movies.filter((l) => prev.movies[l.split("|")[0]] !== l);
    const addSeries = series.filter((l) => prev.series[l.split("|")[0]] !== l);
    const remove = [];
    for (const id of Object.keys(prev.movies)) if (!nowM.has(id)) remove.push("m:" + id);
    for (const id of Object.keys(prev.series)) if (!nowS.has(id)) remove.push("s:" + id);
    const delta = { version, from: prev.version, addMovies, addSeries, remove };
    writeFileSync(join(OUT, "delta", prev.version + ".json"), JSON.stringify(delta) + "\n");
    console.log("Delta " + prev.version + " → " + version + ": +" + addMovies.length + " películas, +" + addSeries.length + " series, −" + remove.length);
  }

  writeFileSync(
    PREV,
    JSON.stringify({
      version,
      movies: Object.fromEntries(movies.map((l) => [l.split("|")[0], l])),
      series: Object.fromEntries(series.map((l) => [l.split("|")[0], l])),
    }) + "\n",
  );

  const bytes = shards.reduce((n, s) => n + s.bytes, 0);
  console.log("\nVersión " + version + ": " + movies.length + " películas, " + series.length + " series, " + Math.round(bytes / 1024) + " KB en " + shards.length + " trozo(s).");
  console.log("Listo para publicar desde " + OUT.replace(REPO + "/", "") + "/ en el release `catalog`.");
}

// ---------------------------------------------------------------- status

function status() {
  const list = entries();
  const movies = list.filter((e) => e.kind === "movie");
  const series = list.filter((e) => e.kind === "series");
  const copies = movies.reduce((n, e) => n + String(e.slots || "").split(",").filter(Boolean).length, 0);
  console.log("Películas indexadas: " + movies.length + " (" + copies + " copias) · Series: " + series.length);
  const errors = existsSync(ERRORS) ? readFileSync(ERRORS, "utf8").split("\n").filter(Boolean).length : 0;
  console.log("Errores acumulados: " + errors);
  if (existsSync(URLS)) {
    const u = JSON.parse(readFileSync(URLS, "utf8"));
    console.log("Fichas en los sitemaps: " + u.movies.length + " películas + " + u.series.length + " series");
  }
  if (existsSync(join(OUT, "catalog.version.json"))) {
    const v = JSON.parse(readFileSync(join(OUT, "catalog.version.json"), "utf8"));
    console.log("Última versión construida: " + v.version + " (" + v.shards.length + " trozo(s))");
  }
}

// ---------------------------------------------------------------- principal

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const main = async () => {
  const cmd = args[0] || "status";
  if (cmd === "collect") await collect();
  else if (cmd === "crawl")
    await crawl({
      only: opt("only", ""),
      limit: Number(opt("limit", 0)),
      concurrency: Number(opt("concurrency", 4)),
      delay: Number(opt("delay", 120)),
    });
  else if (cmd === "build") await build();
  else if (cmd === "status") status();
  else console.log("Uso: node tools/uph-index.mjs collect|crawl|build|status");
};
main().catch((e) => {
  console.error("Error: " + ((e && e.message) || e));
  process.exit(1);
});
