/// <reference path="./kino.d.ts" />
//
// UltraPelisHD para Kino — plugin de JuanDEVYT.
//
// El sitio no publica archivos de video: su reproductor pide un "pass" de pocos minutos a
// ultrapelishd.com y con él consulta la API del reproductor (api-encrypted.moviemaster.lat) que
// devuelve la lista de servidores por idioma y, por servidor, el manifiesto HLS.
// Aquí se hace lo mismo: se lee la página del título, se pide el pass, se listan los servidores y
// cada uno se ofrece a Kino como una copia (menú Servidor) etiquetada con la bandera de su idioma.

const BASE = "https://ultrapelishd.com";
const PAPI = "https://api-encrypted.moviemaster.lat";
const HLS = "application/vnd.apple.mpegurl";
// El sitio protege sus páginas contra clientes que no parecen un navegador: con el User-Agent de
// Kino contestó una página de verificación en inglés, de 12 KB y sin catálogo. Por eso se pide como
// un Chrome de Android de verdad, y si igual llega la verificación se reintenta con otro perfil.
const UA_PAGE = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Upgrade-Insecure-Requests": "1",
  Referer: "https://ultrapelishd.com/",
};

const UA_ALT = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  "Cache-Control": "no-cache",
  Referer: "https://ultrapelishd.com/",
};
const UA_API = {
  Accept: "application/json",
  Origin: BASE,
  Referer: BASE + "/",
};

// Los idiomas que trae el reproductor, con su bandera. LAT/ESP/SUB/ENG son los cuatro del sitio; el
// resto se agrega por si algún día entregan más doblajes.
const LANGS = {
  LAT: { flag: "🇲🇽", name: "Latino" },
  ESP: { flag: "🇪🇸", name: "Castellano" },
  SUB: { flag: "🇬🇧", name: "Subtitulado" },
  ENG: { flag: "🇺🇸", name: "Inglés" },
  ING: { flag: "🇺🇸", name: "Inglés" },
  POR: { flag: "🇧🇷", name: "Portugués" },
  BRA: { flag: "🇧🇷", name: "Portugués" },
  ITA: { flag: "🇮🇹", name: "Italiano" },
  FRA: { flag: "🇫🇷", name: "Francés" },
  DEU: { flag: "🇩🇪", name: "Alemán" },
  GER: { flag: "🇩🇪", name: "Alemán" },
  JPN: { flag: "🇯🇵", name: "Japonés" },
  KOR: { flag: "🇰🇷", name: "Coreano" },
  RUS: { flag: "🇷🇺", name: "Ruso" },
  HIN: { flag: "🇮🇳", name: "Hindi" },
  TUR: { flag: "🇹🇷", name: "Turco" },
  ARA: { flag: "🇸🇦", name: "Árabe" },
  CHI: { flag: "🇨🇳", name: "Chino" },
};

const TABS = [
  { id: "peliculas", label: "Películas" },
  { id: "series", label: "Series" },
  { id: "anime", label: "Anime" },
  { id: "doramas", label: "Doramas" },
];

// ---------------------------------------------------------------- utilidades de HTML

function decode(s) {
  return String(s == null ? "" : s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (m, n) => {
      const code = Number(n);
      return code > 0 && code < 1114112 ? String.fromCharCode(code) : m;
    })
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => {
      const code = parseInt(n, 16);
      return code > 0 && code < 1114112 ? String.fromCharCode(code) : m;
    })
    .replace(/&amp;/g, "&");
}

function textOf(html) {
  if (!html) return "";
  return decode(String(html).replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function rowSlug(s) {
  const base = String(s || "").toLowerCase();
  let out = "";
  for (let i = 0; i < base.length; i++) {
    const c = base.charAt(i);
    if (/[a-z0-9]/.test(c)) out += c;
    else if ("áàäâ".indexOf(c) >= 0) out += "a";
    else if ("éèëê".indexOf(c) >= 0) out += "e";
    else if ("íìïî".indexOf(c) >= 0) out += "i";
    else if ("óòöô".indexOf(c) >= 0) out += "o";
    else if ("úùüû".indexOf(c) >= 0) out += "u";
    else if (c === "ñ") out += "n";
    else if (out.slice(-1) !== "-") out += "-";
  }
  return out.replace(/^-+|-+$/g, "").slice(0, 40) || "fila";
}

// ---------------------------------------------------------------- registro

// Todo lo que hace el plugin deja una línea en el Registro de Kino (Ajustes ▸ UltraPelisHD ▸
// Registro, con el modo debug encendido) y un resumen en Ajustes ▸ Últimas lecturas, para que se
// pueda ver qué pasó sin adivinar.
function log() {
  if (typeof kino.log !== "function") return;
  const parts = [];
  for (let i = 0; i < arguments.length; i++) parts.push(String(arguments[i]));
  try {
    kino.log(parts.join(" ").slice(0, 300));
  } catch (e) {
    // el registro nunca es motivo para fallar
  }
}

function remember(what, text) {
  try {
    kino.storage.set("diag:" + what, { at: Date.now(), text: String(text).slice(0, 180) });
  } catch (e) {
    // idem
  }
}

function cacheGet(key) {
  try {
    const hit = kino.storage.get("cache:" + key);
    if (hit && hit.at && hit.value && Date.now() - hit.at < 600000) return hit.value;
  } catch (e) {
    // sin caché
  }
  return null;
}

function cachePut(key, value) {
  try {
    kino.storage.set("cache:" + key, { at: Date.now(), value: value });
  } catch (e) {
    // sin caché
  }
}

function countItems(rows) {
  let n = 0;
  for (let i = 0; i < rows.length; i++) n += (rows[i].items || []).length;
  return n;
}

function pageTitle(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html || ""));
  return m ? textOf(m[1]).slice(0, 70) : "";
}

// Una página del sitio con catálogo trae tarjetas, una ficha o el reproductor. La de verificación
// no trae ninguna de esas marcas y pesa muy poco.
function looksLikeCatalog(body) {
  return /class="cd"|class="tp"|data-player|data-embed|data-pass|<section class="row"|class="ep"|class="gt"/.test(
    String(body || ""),
  );
}

function blockedNote(body) {
  const title = pageTitle(body);
  return (body.length + "B") + (title ? " «" + title + "»" : "") + (looksLikeCatalog(body) ? "" : " sin catálogo");
}

// Cuando el sitio contesta su verificación, las páginas HTML no van a servir durante un rato: se
// anota para no gastar peticiones del presupuesto de Kino en cada reintento del Inicio.
let blockedUntil = 0;

// UltraPelisHD está detrás de Cloudflare y a algunas redes le contesta «Un momento…». El navegador
// oculto de Kino (kino.browser.page) es un WebView de verdad: pasa ese chequeo solo y devuelve el
// HTML ya renderizado, que es justo lo que este plugin lee.
//
// Kino solo lo deja abrir mientras la persona usa la app (su Inicio, su búsqueda, su lista, su título
// o su play) y nunca en una llamada de fondo: el precalentamiento del Inicio al arrancar contesta
// «not_allowed». Por eso, cuando la ventana no se deja abrir no se castiga a la siguiente llamada y
// el último Inicio bueno queda guardado para servir de respaldo mientras se vuelve a intentar.
let browserModeUntil = 0;
let pageQueue = Promise.resolve();

function canUseHiddenBrowser() {
  return !!(kino.browser && typeof kino.browser.page === "function");
}

// Con waitFor, Kino devuelve el HTML solo cuando la página ya pasó el chequeo automático del sitio y
// su DOM coincide: es la diferencia entre recibir el «Un momento…» a medio resolver (~11 KB, el
// WebView tarda 1-3 s y lo entrega tal cual) y el catálogo de verdad.
const WAIT_FOR_CATALOG = '(?:href="/movie/|href="/serie|data-embed=|data-pass=)';

// Una página a la vez: Kino abre una sola ventana oculta y a la segunda le responde «busy».
function readHiddenPage(url, ms, waitFor) {
  const run = pageQueue.then(() =>
    kino.browser.page(url, {
      // Kino recorta al tiempo que le queda a la llamada, así que se pide de más: el desafío del sitio
      // tarda hasta 9-10 s en pasar y con 8 s se quedaba a medias en el buscador.
      timeoutMs: Math.max(12000, Math.min(20000, ms)),
      waitFor: waitFor || WAIT_FOR_CATALOG,
    }),
  );
  pageQueue = run.then(
    () => null,
    () => null,
  );
  return run.then((r) => (r && r.html ? String(r.html) : ""));
}

// Kino contesta «not_allowed» en la llamada de fondo que hace al arrancar y vuelve a dejar abrir la
// ventana en cuanto la persona toca. Se reintenta una sola vez (Kino permite 20 páginas por minuto y
// cada fila de la sección gasta una), sin insistir cuando el fallo es de verdad: timeout o blocked.
const HIDDEN_WAITS = [0, 900];

async function hiddenPage(url, short, ms) {
  if (!canUseHiddenBrowser()) return "";
  for (let i = 0; i < HIDDEN_WAITS.length; i++) {
    if (HIDDEN_WAITS[i]) {
      try {
        await kino.sleep(HIDDEN_WAITS[i]);
      } catch (e) {}
    }
    try {
      const html = await readHiddenPage(url, ms);
      if (looksLikeCatalog(html)) {
        browserModeUntil = Date.now() + 5 * 60000;
        log("navegador oculto", short, "->", html.length + "B", "con catálogo", i ? "· intento " + (i + 1) : "");
        return html;
      }
      log("navegador oculto", short, "sin catálogo ·", html.length + "B");
      return "";
    } catch (e) {
      const code = (e && e.code) || (e && e.message) || "error";
      log("navegador oculto", short, i + 1 + "/" + HIDDEN_WAITS.length + ":", code);
      if (code === "timeout") log("navegador oculto", short, "no pasó el chequeo del sitio a tiempo");
      // Solo se insiste cuando es cuestión de momento: la app en segundo plano, o la ventana ocupada.
      if (code !== "not_allowed" && code !== "busy") return "";
    }
  }
  log("navegador oculto", short, "sigue sin dejarse abrir; se probará al abrir Inicio");
  return "";
}

// Una respuesta JSON abierta en el WebView queda dentro de un <pre>; se saca de ahí y se parsea. Sirve
// para las rutas que el sitio solo entrega a la ventana que ya pasó su verificación (el pass del
// reproductor y la lista de servidores responden 403 a un fetch aparte en algunas redes).
function jsonFromPage(html) {
  const s = String(html || "");
  const pre = /<pre[^>]*>([\s\S]*?)<\/pre>/i.exec(s);
  const text = (pre ? pre[1] : s)
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  try {
    return JSON.parse(text.trim());
  } catch (e) {}
  const inner = /\{[\s\S]*\}/.exec(text);
  if (inner) {
    try {
      return JSON.parse(inner[0]);
    } catch (e) {}
  }
  return null;
}

async function browserJson(url, waitFor, ms) {
  if (!canUseHiddenBrowser()) return null;
  try {
    const html = await readHiddenPage(url, ms, waitFor);
    const j = jsonFromPage(html);
    if (j) return j;
    log("navegador oculto (json)", "sin respuesta legible ·", String(html || "").length + "B");
  } catch (e) {
    log("navegador oculto (json):", (e && e.code) || (e && e.message) || "error");
  }
  return null;
}

// El último resultado bueno de una página del catálogo, para no quedarse en blanco mientras el sitio
// contesta su verificación.
function savedRows(key) {
  try {
    const hit = kino.storage.get(key);
    if (hit && hit.rows && hit.rows.length) return hit.rows;
  } catch (e) {}
  return null;
}

function saveRows(key, rows) {
  try {
    if (rows && rows.length) kino.storage.set(key, { at: Date.now(), rows: rows });
  } catch (e) {}
}

async function get(url, timeoutMs) {
  const short = String(url).replace(BASE, "");
  const ms = Math.max(3000, Math.min(20000, Number(timeoutMs) || 12000));

  // Si esta red ya necesitó la ventana oculta, se va directo a ella: ahorra el viaje que siempre
  // vuelve con la página de verificación.
  let triedHidden = false;
  if (Date.now() < browserModeUntil && canUseHiddenBrowser()) {
    triedHidden = true;
    const html = await hiddenPage(url, short, ms);
    if (html) return html;
  }

  let r = await kino.fetch(url, { headers: UA_PAGE, timeoutMs: ms });
  let body = r.text();
  const type = String((r.headers && r.headers["content-type"]) || "").split(";")[0];
  log("GET", short, "->", r.status, body.length + "B", type);

  if (r.ok && body.length < 30000 && !looksLikeCatalog(body)) {
    log("sin catálogo en", short, "·", blockedNote(body));
    remember("fetch", short + ": " + blockedNote(body));

    // 1º: otro perfil de navegador.
    try {
      const again = await kino.fetch(url, { headers: UA_ALT, timeoutMs: ms });
      const other = again.text();
      log("GET (2º intento)", short, "->", again.status, other.length + "B", looksLikeCatalog(other) ? "con catálogo" : "sin catálogo");
      if (again.ok) {
        r = again;
        body = other;
      }
    } catch (e) {
      log("2º intento falló:", (e && e.code) || "error");
    }

    // 2º: el navegador oculto, que sí resuelve la verificación del sitio.
    if (!looksLikeCatalog(body) && !triedHidden && canUseHiddenBrowser()) {
      const html = await hiddenPage(url, short, ms);
      if (html) {
        remember("fetch", "verificación pasada con el navegador oculto en " + short);
        return html;
      }
    }
  }

  if (!r.ok) {
    remember("fetch", "HTTP " + r.status + " en " + short);
    throw kino.error(r.status === 404 ? "not_found" : "unavailable", "UltraPelisHD respondió " + r.status);
  }
  return body;
}

// El id de Kino no puede llevar "/": se guarda el ref (la ruta del sitio) y un id corto y estable.
function kinoId(path) {
  const s = String(path || "")
    .replace(/[^A-Za-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.slice(0, 120) || "item";
}

function relative(url) {
  const s = String(url || "");
  const cut = s.indexOf(BASE);
  if (cut === 0) return s.slice(BASE.length).replace(/^\/+/, "");
  return s.replace(/^https?:\/\/[^/]+\//, "").replace(/^\/+/, "");
}

// ---------------------------------------------------------------- títulos

function kindOf(path) {
  if (/^movie\//.test(path)) return "movie";
  if (/^(series|anime|dorama|novela)\//.test(path)) return "series";
  return "";
}

// Cada tarjeta del sitio es <a class="cd" href="/movie/slug"> con su póster, su título y una línea
// de metadatos (nota de la comunidad, año y duración o número de temporadas).
function cards(html) {
  const out = [];
  const seen = {};
  const re = /<a class="cd" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(String(html || "")))) {
    const path = relative(decode(m[1]));
    let kind = kindOf(path);
    const body = m[2];
    if (!kind) continue;
    const title = textOf((/<span class="cd-t">([\s\S]*?)<\/span>/.exec(body) || [])[1]);
    if (!title || seen[path]) continue;
    seen[path] = true;
    if (/class="tag"[^>]*>\s*Serie/i.test(body)) kind = "series";

    const item = { id: kinoId(path), ref: path, title: title, kind: kind };

    const img = /<img[^>]+src="([^"]+)"/i.exec(body);
    if (img) item.poster = decode(img[1]);

    const rating = /class="match">\s*(\d{1,3})\s*%/.exec(body);
    if (rating) {
      const value = Number(rating[1]) / 10;
      if (isFinite(value) && value > 0) item.rating = Math.min(10, Math.round(value * 10) / 10);
    }

    const year = /<span>(\d{4})<\/span>/.exec(body);
    if (year) item.year = year[1];

    out.push(item);
  }
  return out;
}

function nextOf(html) {
  const m = /<link rel="next" href="([^"]+)"/i.exec(String(html || ""));
  return m ? relative(decode(m[1])) : "";
}

function rowsOf(html) {
  const rows = [];
  const chunks = String(html || "").split('<section class="row"');
  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i];
    const title = textOf((/<h2 class="row-t">([\s\S]*?)<\/h2>/.exec(chunk) || [])[1]);
    if (!title) continue;
    const items = cards(chunk);
    if (!items.length) continue;
    const row = { id: "row-" + rowSlug(title), title: title, items: items.slice(0, 30) };
    const more = /class="more"[^>]*href="([^"]+)"/i.exec(chunk);
    if (more) row.ref = relative(decode(more[1]));
    rows.push(row);
    if (rows.length >= 16) break;
  }
  return rows;
}

const GENRES = [
  { id: "accion", title: "Acción" },
  { id: "comedia", title: "Comedia" },
  { id: "drama", title: "Drama" },
  { id: "suspense", title: "Suspense" },
  { id: "terror", title: "Terror" },
  { id: "animacion", title: "Animación" },
  { id: "crimen", title: "Crimen" },
  { id: "romance", title: "Romance" },
  { id: "aventura", title: "Aventura" },
  { id: "misterio", title: "Misterio" },
  { id: "fantasia", title: "Fantasía" },
  { id: "ciencia-ficcion", title: "Ciencia ficción" },
];

// ---------------------------------------------------------------- fichas

function ldOf(html) {
  const out = {};
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    let json;
    try {
      json = JSON.parse(m[1]);
    } catch (e) {
      continue;
    }
    const list = json && json["@graph"] ? json["@graph"] : [json];
    for (let i = 0; i < list.length; i++) {
      const node = list[i];
      if (node && node["@type"] && !out[node["@type"]]) out[node["@type"]] = node;
    }
  }
  return out;
}

function seriesInfo(html) {
  const ld = ldOf(html);
  const node = ld.TVSeries || ld.Movie || {};
  const info = {};
  if (node.name) info.title = textOf(node.name);
  if (node.description) info.overview = textOf(node.description);
  const images = node.image ? (Array.isArray(node.image) ? node.image : [node.image]) : [];
  if (images.length) info.poster = images[0];
  if (images.length > 1) info.backdrop = images[1];
  if (node.genre) info.genres = (Array.isArray(node.genre) ? node.genre : [node.genre]).slice(0, 5);
  if (node.datePublished) info.year = String(node.datePublished).slice(0, 4);
  const rating = node.aggregateRating && node.aggregateRating.ratingValue;
  if (rating) info.rating = Number(rating);
  if (!info.title) {
    const h1 = /<h1 class="bb-t">([\s\S]*?)<\/h1>/.exec(String(html || ""));
    const alt = /<img[^>]+alt="([^"]+)"/.exec(h1 ? h1[1] : "");
    if (alt) info.title = decode(alt[1]);
  }
  return info;
}

function seasonsOf(html, basePath) {
  const out = [];
  const re = /<a class="chip( on)?" href="([^"]*\/season\/(\d+))"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(String(html || "")))) {
    const ref = relative(decode(m[2]));
    const number = Number(m[3]);
    const title = textOf(m[4]) || "Temporada " + number;
    out.push({ id: kinoId(ref), ref: ref, title: title, number: number, current: !!m[1] });
  }
  // El chip de la temporada abierta puede no venir marcado: si la respuesta es la temporada de la
  // propia ruta, esa es la actual.
  if (out.length && basePath) {
    let marked = false;
    for (let i = 0; i < out.length; i++) if (out[i].current) marked = true;
    if (!marked) {
      for (let i = 0; i < out.length; i++) if (out[i].ref === basePath) out[i].current = true;
    }
  }
  return out;
}

function isoDate(txt) {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(txt || ""));
  if (!m) return "";
  const d = m[1].length === 1 ? "0" + m[1] : m[1];
  const mo = m[2].length === 1 ? "0" + m[2] : m[2];
  return m[3] + "-" + mo + "-" + d;
}

function episodesOf(html) {
  const out = [];
  const re = /<a class="ep( on)?" href="([^"]+)">([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(String(html || "")))) {
    const href = decode(m[2]);
    if (!/\/episode\//.test(href)) continue;
    const body = m[3];
    const seasonHit = /\/season\/(\d+)\//.exec(href);
    const numberHit = /\/episode\/(\d+)/.exec(href);
    const season = seasonHit ? Number(seasonHit[1]) : 1;
    const number = numberHit ? Number(numberHit[1]) : out.length + 1;
    const ep = { season: season, number: number, ref: relative(href) };

    const title = textOf((/<span class="ep-t">([\s\S]*?)<\/span>/.exec(body) || [])[1]).replace(/^\d+\.\s*/, "");
    if (title) ep.title = title;
    const img = /<img[^>]+src="([^"]+)"/i.exec(body);
    if (img) ep.still = decode(img[1]);
    const overview = textOf((/<span class="ep-o">([\s\S]*?)<\/span>/.exec(body) || [])[1]);
    if (overview) ep.overview = overview;
    const air = isoDate((/<span class="ep-s">([\s\S]*?)<\/span>/.exec(body) || [])[1]);
    if (air) ep.airDate = air;
    const runtime = /class="ep-d"[^>]*>\s*(\d{1,4})\s*min/i.exec(body);
    if (runtime) ep.runtimeMinutes = Number(runtime[1]);
    out.push(ep);
  }
  return out;
}

// ---------------------------------------------------------------- reproductor

// La página lleva el iframe del reproductor con el id de TMDB y el pass de ese título:
//   data-embed="<iframe data-pass="/api/player-pass?t=movie:1368337:XXXX"
//                       src="https://api-encrypted.moviemaster.lat/embed/movie/1368337?lang=LAT">"
function playInfo(html) {
  const m = /data-embed="([^"]*)"/.exec(String(html || ""));
  if (!m) return null;
  const embed = decode(m[1]);
  const src = /src="([^"]+)"/i.exec(embed);
  const pass = /data-pass="([^"]+)"/i.exec(embed);
  if (!src || !pass) return null;
  let parts;
  try {
    parts = new URL(decode(src[1])).pathname.split("/").filter(Boolean);
  } catch (e) {
    return null;
  }
  if (parts[0] !== "embed" || !parts[2]) return null;
  const type = parts[1] === "tv" ? "tv" : "movie";
  return {
    type: type,
    tmdb: parts[2],
    season: Number(parts[3]) || 1,
    episode: Number(parts[4]) || 1,
    passPath: decode(pass[1]),
  };
}

async function getPass(play, pageUrl) {
  const url = BASE + play.passPath;
  let status = 0;
  try {
    const r = await kino.fetch(url, { headers: { Accept: "application/json", Referer: pageUrl }, timeoutMs: 15000 });
    if (r.ok) {
      const j = r.json();
      if (j && j.pass) return String(j.pass);
      log("player-pass: la respuesta no trae pass");
    } else {
      status = r.status;
      log("player-pass respondió", r.status, "· se pide por la ventana oculta");
    }
  } catch (e) {
    log("player-pass falló:", (e && e.code) || (e && e.message) || "error");
  }
  const j = await browserJson(url, '"pass"', 12000);
  if (j && j.pass) {
    log("player-pass por la ventana oculta · ok");
    return String(j.pass);
  }
  throw kino.error("unavailable", "el pass respondió " + (status || "error"), {
    userMessage:
      "UltraPelisHD no entregó la clave del reproductor para este título. Vuelve a intentarlo en un momento; si sigue igual, prueba con otro título.",
  });
}

function queryOf(play) {
  return (
    "tmdb=" + play.tmdb + "&type=" + play.type + (play.type === "tv" ? "&season=" + play.season + "&episode=" + play.episode : "")
  );
}

async function listServers(play, pass, pageUrl) {
  const url = PAPI + "/servers?" + queryOf(play) + "&pass=" + encodeURIComponent(pass);
  let j = null;
  try {
    const r = await kino.fetch(url, { headers: UA_API, timeoutMs: 15000 });
    if (r.ok) j = r.json();
    else log("servidores respondió", r.status, "· se piden por la ventana oculta");
  } catch (e) {
    log("servidores falló:", (e && e.code) || (e && e.message) || "error");
  }
  if (!j || !j.servers) {
    const alto = await browserJson(url, '"servers"', 12000);
    if (alto && alto.servers) {
      log("servidores por la ventana oculta ·", alto.servers.length);
      j = alto;
    }
  }
  const list = (j && j.servers) || [];
  const out = [];
  const seen = {};
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (!s || !s.id || !s.k) continue;   // el video ya no viene aquí: se pide a /video por su id
    if (s.type && s.type !== "hls" && s.type !== "mp4") continue;
    if (seen[s.k]) continue;
    seen[s.k] = true;
    out.push({
      id: String(s.id),
      k: String(s.k),
      name: String(s.name || "Servidor"),
      lang: String(s.lang || "").toUpperCase(),
      type: s.type || "hls",
      site: String(s.site || ""),
      mode: String(s.mode || ""),
      detras: !!s.detras,
    });
  }
  return out;
}

function langOf(code) {
  return LANGS[String(code || "").toUpperCase()] || { flag: "🎬", name: String(code || "Original") };
}

function copyLabel(server) {
  const lang = langOf(server.lang);
  let label = lang.flag + " " + lang.name + " · " + server.name;
  if (label.length > 48) label = label.slice(0, 48);
  return label;
}

// El idioma preferido del ajuste va primero; el resto conserva el orden en que la API los entrega
// (que ya viene por lo que mejor reproduce).
function ordered(servers) {
  const pref = String(kino.config.get("lang") || "auto").toUpperCase();
  if (!pref || pref === "AUTO") return servers;
  const first = [];
  const rest = [];
  for (let i = 0; i < servers.length; i++) {
    if (servers[i].lang === pref) first.push(servers[i]);
    else rest.push(servers[i]);
  }
  return first.concat(rest);
}

// ── presupuesto, caché y manifiestos ─────────────────────────────────────────

const RESOLVE_MS = 18000;          // el contrato corta `resolve` a los 20 s: se deja margen
const CACHE_OK = 30 * 60000;       // media hora, revalidando antes de servir
const MAX_ALTERNATIVAS = 8;
const restante = (hasta) => Math.max(0, hasta - Date.now());

const esManifiesto = (url) => /\.(m3u8|mpd)(\?|$)/i.test(String(url || ""));

// Un enlace que contesta 4xx está muerto (estas URLs van firmadas y caducan en minutos): no se le
// entrega a Kino. Un 5xx o un fallo de red se perdonan, que el CDN puede estar teniendo un mal rato.
async function vivo(url, headers, hasta) {
  if (!url) return true;
  const ms = Math.max(1500, Math.min(5000, restante(hasta) - 1500));
  if (ms < 1500) return true;
  try {
    const r = await kino.fetch(url, { headers: headers || {}, timeoutMs: ms });
    return r.ok || Number(r.status) >= 500;
  } catch (e) {
    return true;
  }
}

function claveOk(path) {
  return "ok:" + path;
}

function leerOk(path) {
  try {
    const h = kino.storage.get(claveOk(path));
    if (h && h.url && h.at && Date.now() - h.at < CACHE_OK) return h;
  } catch (e) {}
  return null;
}

function guardarOk(path, valor) {
  try {
    kino.storage.set(claveOk(path), Object.assign({ at: Date.now() }, valor));
  } catch (e) {}
}

function borrarOk(path) {
  try {
    kino.storage.remove(claveOk(path));
  } catch (e) {}
}

function sinSesion() {
  return kino.error("unavailable", "el sitio pide cuenta", {
    userMessage:
      "UltraPelisHD ahora pide una cuenta gratis para reproducir. En Ajustes ▸ UltraPelisHD pulsa \u00abIniciar sesi\u00f3n\u00bb, crea la cuenta en la ventana que se abre y vuelve a intentarlo.",
  });
}

// ── la puerta de fuentes del reproductor ─────────────────────────────────────

// La ficha ya no lleva el iframe: lleva una puerta (`data-uph-watch`) que, si hay sesi\u00f3n, entrega las
// fuentes. Cada fuente es el HTML de un iframe con su `src` y su `data-pass`.
function puertaDe(html) {
  const m = /data-uph-watch="([^"]+)"/.exec(String(html || ""));
  return m ? decode(m[1]) : "";
}

function fuenteDe(html) {
  const plano = decode(String(html || ""));
  const tag = (/<iframe[^>]*>/i.exec(plano) || [plano])[0];
  const src = /src=["']([^"']+)/i.exec(tag);
  if (!src) return null;
  let parts;
  let url;
  try {
    url = new URL(decode(src[1]));
    parts = url.pathname.split("/").filter(Boolean);
  } catch (e) {
    return null;
  }
  if (parts[0] !== "embed" || !parts[2]) return null;
  const pass = /data-pass=["']([^"']+)/i.exec(tag);
  return {
    type: parts[1] === "tv" ? "tv" : "movie",
    tmdb: parts[2],
    season: Number(parts[3]) || 1,
    episode: Number(parts[4]) || 1,
    lang: String(url.searchParams.get("lang") || "").toUpperCase(),
    passPath: pass ? decode(pass[1]) : "",
  };
}

// Devuelve la lista de fuentes del título. Sin sesi\u00f3n el sitio contesta 401 y no hay nada que hacer:
// se avisa con el mensaje de la cuenta en vez de seguir pidiendo pases que van a fallar.
async function fuentesDe(pageUrl, hasta) {
  const html = await get(pageUrl);
  const puerta = puertaDe(html);
  if (!puerta) {
    const viejo = fuenteDe(html);              // por si el sitio vuelve al iframe de antes
    if (viejo) return [viejo];
    throw kino.error("not_found", "sin reproductor en " + pageUrl, {
      userMessage: "UltraPelisHD todavía no tiene este título disponible para ver.",
    });
  }

  const url = /^https?:\/\//.test(puerta) ? puerta : BASE + puerta;
  let r;
  try {
    r = await kino.fetch(url, {
      headers: Object.assign({}, UA_API, { Referer: pageUrl }),
      timeoutMs: Math.max(4000, Math.min(12000, restante(hasta))),
    });
  } catch (e) {
    throw kino.error("unavailable", "la puerta no contestó", {
      userMessage: "No se pudo comprobar tu sesión en UltraPelisHD. Revisa la conexión y vuelve a intentarlo.",
    });
  }
  if (r.status === 401 || r.status === 403) throw sinSesion();
  if (r.status === 404) {
    throw kino.error("not_found", "la puerta no conoce el título", {
      userMessage: "UltraPelisHD cambió las fuentes de este título. Vuelve a entrar en su ficha.",
    });
  }
  if (!r.ok) throw kino.error("unavailable", "la puerta respondió " + r.status);

  let j = null;
  try {
    j = r.json();
  } catch (e) {
    j = null;
  }
  const out = [];
  const fuentes = (j && j.sources) || {};
  const claves = Object.keys(fuentes);
  for (let i = 0; i < claves.length; i++) {
    const bruto = fuentes[claves[i]];
    const f = fuenteDe(bruto && (bruto.html || bruto.src) ? bruto.html || bruto.src : bruto);
    if (f) {
      f.clave = claves[i];
      out.push(f);
    }
  }
  if (!out.length) {
    log("la puerta no trajo fuentes legibles ·", claves.length, "claves");
    throw kino.error("not_found", "la puerta no trajo fuentes", {
      userMessage: "UltraPelisHD no tiene ninguna copia de este título ahora mismo.",
    });
  }
  // El idioma del ajuste primero: la fuente ya viene con su `?lang=`.
  const pref = String(kino.config.get("lang") || "").toUpperCase();
  if (pref && pref !== "AUTO") out.sort((a, b) => (b.lang === pref) - (a.lang === pref));
  log("puerta:", out.length, "fuentes", out.map((f) => f.lang || "?").join("/"));
  return out;
}

// Una copia lista para Kino: el endpoint /video del reproductor con la copia elegida. Dura lo que la
// sesión del sitio; si falla después, Kino vuelve a resolver.
function streamFor(play, server) {
  return {
    url: PAPI + "/video?" + queryOf(play) + "&noiframe=1&embed=" + encodeURIComponent(server.id),
    mime: HLS,
    expiresInSeconds: 540,
  };
}

// El orden que ya trae la API es el de "lo que mejor reproduce". Se adelantan las copias directas: las
// de `mode: proxy` y las que van por detrás de otro reproductor tardan más y fallan más.
function porCalidad(servers) {
  const peso = (s) => (s.mode === "proxy" ? 2 : 0) + (s.detras ? 1 : 0);
  return servers
    .map((s, i) => ({ s: s, i: i }))
    .sort((a, b) => peso(a.s) - peso(b.s) || a.i - b.i)
    .map((x) => x.s);
}

// Una copia ya armada: la forma que Kino lee, con la etiqueta de su idioma.
function copiaDe(path, play, server, servers) {
  const stream = streamFor(play, server);
  stream.label = copyLabel(server);
  const otras = servers.filter((s) => s.k !== server.k).slice(0, MAX_ALTERNATIVAS);
  if (otras.length) {
    stream.alternatives = otras.map((s) => ({ label: copyLabel(s), ref: path + "|" + s.k }));
  }
  return stream;
}

// Copia diferida (la que llega desde el menú Servidor): se resuelve con la sesión del momento, así que
// nunca lleva un pass caducado. El manifiesto se comprueba antes de entregarlo.
async function abrirCopia(raw) {
  const cut = raw.lastIndexOf("|");
  const path = raw.slice(0, cut).replace(/^\/+/, "");
  const key = raw.slice(cut + 1);
  if (!path || !key) throw kino.error("not_found");
  const hasta = Date.now() + RESOLVE_MS;
  const pageUrl = BASE + "/" + path;
  const fuentes = await fuentesDe(pageUrl, hasta);
  let play = null;
  let servers = [];
  for (let i = 0; i < fuentes.length && !servers.length; i++) {
    const f = fuentes[i];
    if (!f.passPath) continue;
    const pass = await getPass(f, pageUrl);
    servers = porCalidad(await listServers(f, pass, pageUrl));
    play = f;
  }
  let server = null;
  for (let i = 0; i < servers.length; i++) if (servers[i].k === key) server = servers[i];
  if (!server) {
    throw kino.error("not_found", "servidor " + key, {
      userMessage: "Ese servidor ya no está en UltraPelisHD; elige otra copia en el menú Servidor.",
    });
  }
  const stream = streamFor(play, server);
  if (!(await vivo(stream.url, {}, hasta))) {
    throw kino.error("not_found", "la copia no da manifiesto", {
      userMessage: "Esa copia no está disponible ahora. Prueba con otra.",
    });
  }
  stream.label = copyLabel(server);
  return stream;
}

// El camino con sesión del sitio: la ficha, la puerta, el pass y los servidores del reproductor.
// Se usa para series y capítulos (el sitio no publica copias indexables) y como respaldo cuando el
// índice no trae una copia DoodStream viva.
async function resolverSesion(ref) {
  const raw = String(ref == null ? "" : ref);
  if (raw.indexOf("|") >= 0) return abrirCopia(raw);

  const path = raw.replace(/^\/+/, "");
  if (!path) throw kino.error("not_found");
  const hasta = Date.now() + RESOLVE_MS;

  // 1) Enlace guardado: se sirve solo si su manifiesto sigue vivo; si no, se borra y se resuelve de nuevo.
  const guardado = leerOk(path);
  if (guardado) {
    if (await vivo(guardado.url, guardado.headers, hasta)) {
      log("resolve: enlace guardado de", path);
      return {
        url: guardado.url,
        mime: guardado.mime || HLS,
        ...(guardado.label ? { label: guardado.label } : {}),
        ...(Array.isArray(guardado.alternatives) && guardado.alternatives.length
          ? { alternatives: guardado.alternatives.filter((a) => a && typeof a.ref === "string").slice(0, MAX_ALTERNATIVAS) }
          : {}),
      };
    }
    borrarOk(path);
  }

  // 2) La ficha, la puerta y sus fuentes.
  const pageUrl = BASE + "/" + path;
  const fuentes = await fuentesDe(pageUrl, hasta);

  // 3) Pass y servidores con la primera fuente que responda.
  let play = null;
  let servers = [];
  for (let i = 0; i < fuentes.length; i++) {
    const f = fuentes[i];
    if (!f.passPath) continue;
    try {
      const pass = await getPass(f, pageUrl);
      const lista = porCalidad(await listServers(f, pass, pageUrl));
      if (lista.length) {
        play = f;
        servers = lista;
        break;
      }
    } catch (e) {
      log("fuente", f.lang || i + 1, "sin servidores:", (e && e.code) || (e && e.message) || "error");
      if (e && e.code === "unavailable" && /cuenta/.test(String(e.message || ""))) throw e;
    }
  }
  if (!servers.length) {
    throw kino.error("not_found", "sin servidores en " + path, {
      userMessage: "UltraPelisHD no tiene ningún servidor que reproduzca este título ahora mismo.",
    });
  }

  // 4) Se entrega la primera copia cuyo manifiesto esté vivo; si ninguna lo está, se avisa claro.
  for (let i = 0; i < servers.length; i++) {
    const stream = streamFor(play, servers[i]);
    if (!(await vivo(stream.url, {}, hasta))) {
      log("copia muerta:", servers[i].k);
      continue;
    }
    const salida = copiaDe(path, play, servers[i], servers);
    guardarOk(path, salida);
    log("resolve:", path, "->", salida.label, "en", RESOLVE_MS - restante(hasta), "ms");
    return salida;
  }
  throw kino.error("unavailable", "ninguna copia da manifiesto", {
    userMessage: "Ninguna copia de este título se puede reproducir ahora. Inténtalo más tarde.",
  });
}

// `prepare` deja el enlace listo antes de que Kino lo pida (al abrir la ficha), sin bloquear nada.
export async function prepare(ref) {
  const raw = String(ref == null ? "" : ref);
  if (!raw || raw.indexOf("|") >= 0) return;
  if (leerOk(raw)) return;
  try {
    await resolve(raw);
  } catch (e) {
    log("prepare:", (e && e.code) || (e && e.message) || "error");
  }
}

// ---------------------------------------------------------------- inicio, sección, categorías

async function homeSitio() {
  let html = "";
  try {
    html = await get(BASE + "/", 12000);
  } catch (e) {
    log("home: falló / ·", (e && e.code) || (e && e.message) || "error");
  }

  let rows = html ? rowsOf(html) : [];
  if (rows.length) saveRows("rows:/", rows);
  if (!rows.length) {
    log("home sin filas ·", html ? blockedNote(html) : "sin respuesta");
    if (!canUseHiddenBrowser()) log("esta versión de Kino no trae navegador oculto: no se puede pasar la verificación");
    // Respaldo: el Inicio se arma con los catálogos, que son páginas distintas del sitio.
    const pares = [
      ["movies", "Películas nuevas"],
      ["movies?sort=trending", "Tendencia esta semana"],
      ["series", "Series nuevas"],
      ["animes", "Anime"],
    ];
    const listas = await Promise.all(pares.map((p) => listRow(p[0], p[1])));
    rows = [];
    for (let i = 0; i < listas.length; i++) if (listas[i]) rows.push(listas[i]);
    if (rows.length) {
      log("home: armado con los catálogos ·", rows.length, "filas,", countItems(rows), "títulos");
      remember("home", "catálogos: " + rows.length + " filas · " + countItems(rows) + " títulos");
      return rows;
    }
    const saved = savedRows("rows:/");
    if (saved) {
      log("home: armado con el último Inicio guardado ·", saved.length, "filas,", countItems(saved), "títulos");
      remember("home", "guardado: " + saved.length + " filas · " + countItems(saved) + " títulos");
      return saved;
    }
    const feed = await feedItems();
    if (feed.length) {
      log("home: armado con el RSS ·", feed.length, "títulos");
      remember("home", "RSS: 1 fila · " + feed.length + " títulos");
      return [{ id: "row-recien-anadido", title: "Recién añadido", items: feed.slice(0, 30) }];
    }
    remember("home", "sin filas · " + (html ? blockedNote(html) : "sin respuesta"));
    throw kino.error("unavailable", "el inicio llegó sin filas", {
      userMessage:
        "UltraPelisHD devolvió una página sin catálogo (es su verificación de Cloudflare). Vuelve a entrar a Inicio con la app abierta: ahí Kino sí deja que el plugin abra su navegador oculto y pase la verificación. Si sigue igual, mira Ajustes ▸ UltraPelisHD ▸ Últimas lecturas y el Registro.",
    });
  }

  log("home:", rows.length, "filas,", countItems(rows), "títulos");
  remember("home", rows.length + " filas · " + countItems(rows) + " títulos");
  return rows;
}

// /feed.xml es el mismo catálogo en RSS: 30 títulos con su póster, su año y su ruta, sin pasar por
// la protección que el sitio pone a las páginas HTML. Es el último respaldo del Inicio y la Sección.
async function feedItems() {
  let xml = "";
  try {
    const r = await kino.fetch(BASE + "/feed.xml", { headers: UA_PAGE, timeoutMs: 12000 });
    xml = r.ok ? r.text() : "";
    log("GET /feed.xml ->", r.status, xml.length + "B");
  } catch (e) {
    log("feed.xml falló:", (e && e.code) || (e && e.message) || "error");
    return [];
  }

  const out = [];
  const seen = {};
  const blocks = String(xml).split(/<item>/i).slice(1);
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const link = textOf((/<link>([\s\S]*?)<\/link>/i.exec(b) || [])[1]);
    const path = relative(link.replace(/^https?:\/\/[^/]+/i, ""));
    const kind = kindOf(path);
    if (!kind || seen[path]) continue;
    seen[path] = true;
    const raw = textOf((/<title>([\s\S]*?)<\/title>/i.exec(b) || [])[1]);
    if (!raw) continue;
    const year = /\((\d{4})\)\s*$/.exec(raw);
    const item = { id: kinoId(path), ref: path, title: raw.replace(/\s*\(\d{4}\)\s*$/, ""), kind: kind };
    if (!item.title) continue;
    const poster = (/<media:thumbnail[^>]*url="([^"]+)"/i.exec(b) || [])[1];
    if (poster) item.poster = decode(poster);
    if (year) item.year = year[1];
    out.push(item);
  }
  log("feed:", out.length, "títulos");
  return out;
}

async function listRow(path, title, ref) {
  const key = "rows:" + path;
  try {
    const html = await get(BASE + "/" + path);
    const items = cards(html);
    log("fila", path, "->", items.length, "títulos");
    if (items.length) {
      const row = { id: "row-" + rowSlug(title), title: title, ref: ref || path, items: items.slice(0, 30) };
      saveRows(key, [row]);
      return row;
    }
    log("fila", path, "sin tarjetas ·", blockedNote(html));
  } catch (e) {
    log("fila", path, "falló:", (e && e.code) || (e && e.message) || "error");
  }
  const saved = savedRows(key);
  if (saved && saved[0]) {
    log("fila", path, "desde la caché ·", saved[0].items.length, "títulos");
    return saved[0];
  }
  return null;
}

async function sectionSitio(args) {
  const tab = args && args.tab;
  let chosen = TABS[0].id;
  for (let i = 0; i < TABS.length; i++) if (TABS[i].id === tab) chosen = tab;

  const rows = [];
  const add = (row) => {
    if (row) rows.push(row);
  };

  // Las peticiones de cada pestaña van en paralelo: el sitio puede tardar y Kino corta a los 20 s.
  let pares;
  if (chosen === "peliculas") {
    pares = [
      ["movies?sort=trending", "Tendencia esta semana"],
      ["movies", "Películas nuevas"],
      ["movies?sort=rating", "Mejor valoradas"],
    ];
  } else if (chosen === "series") {
    pares = [
      ["series", "Series nuevas"],
      ["series?sort=rating", "Series mejor valoradas"],
    ];
  } else if (chosen === "anime") {
    pares = [
      ["animes", "Anime"],
      ["animes?sort=rating", "Anime mejor valorado"],
    ];
  } else {
    pares = [
      ["doramas", "Doramas"],
      ["doramas?sort=rating", "Doramas mejor valorados"],
    ];
  }
  // Con la ventana oculta de por medio cada fila es una carga de WebView y van de una en una: se
  // piden las dos primeras para no pasarse del plazo de Kino.
  const pedidas = Date.now() < browserModeUntil ? pares.slice(0, 2) : pares;
  const listas = await Promise.all(pedidas.map((p) => listRow(p[0], p[1])));
  for (let i = 0; i < listas.length; i++) add(listas[i]);

  // Respaldo: si las páginas del catálogo llegaron vacías, el RSS deja al menos una fila con lo último.
  if (!rows.length) {
    const feed = await feedItems();
    const kind = chosen === "peliculas" ? "movie" : "series";
    const items = [];
    for (let i = 0; i < feed.length; i++) if (feed[i].kind === kind) items.push(feed[i]);
    if (items.length) {
      log("section", chosen, ": armada con el RSS ·", items.length, "títulos");
      add({ id: "row-recien-anadido", title: "Recién añadido", items: items.slice(0, 30) });
    }
  }

  log("section", chosen, "->", rows.length, "filas,", countItems(rows), "títulos");
  remember("section", chosen + ": " + rows.length + " filas · " + countItems(rows) + " títulos");
  if (!rows.length) {
    throw kino.error("unavailable", "la sección llegó vacía", {
      userMessage: "No se pudo cargar la sección de UltraPelisHD. Mira Ajustes ▸ UltraPelisHD ▸ Últimas lecturas y el Registro.",
    });
  }
  return { tabs: TABS, tab: chosen, rows: rows };
}

async function categoriesSitio() {
  let html = "";
  try {
    html = await get(BASE + "/genres");
  } catch (e) {
    html = "";
  }
  const out = [];
  const seen = {};
  const re = /<a class="gt" href="([^"]*\/genre\/[^"]+)">([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const ref = relative(decode(m[1]));
    if (seen[ref]) continue;
    seen[ref] = true;
    const body = m[2];
    const title = textOf((/<span[^>]*>([\s\S]*?)</.exec(body) || [])[1]) || textOf(body);
    const img = /<img[^>]+src="([^"]+)"/i.exec(body);
    if (!title) continue;
    const tile = { id: kinoId(ref), title: title.slice(0, 40), ref: ref };
    if (img) tile.art = decode(img[1]);
    out.push(tile);
    if (out.length >= 24) break;
  }
  if (out.length) return out;
  // Sin la página de géneros, los de siempre.
  return GENRES.map((g) => ({ id: kinoId("genre/" + g.id), title: g.title, ref: "genre/" + g.id }));
}

// ---------------------------------------------------------------- buscar y navegar

function suggested(json, hint) {
  const out = [];
  const list = (json && json.titles) || [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (!t || !t.url || !t.title) continue;
    const path = relative(String(t.url));
    if (!path) continue;
    const kind = t.type === "series" ? "series" : kindOf(path) || "movie";
    const item = { id: kinoId(path), ref: path, title: String(t.title), kind: kind };
    if (t.poster) item.poster = String(t.poster);
    if (t.year) item.year = String(t.year);
    const rating = Number(t.rating);
    if (isFinite(rating) && rating > 0) item.rating = Math.min(10, Math.round(rating * 10) / 10);
    out.push(item);
  }
  return out;
}

async function searchSitio(query) {
  const q = String((query && query.q) || "").trim();
  const cursor = query && query.cursor;
  if (cursor) {
    const url = /^https?:\/\//.test(cursor) ? cursor : BASE + "/" + String(cursor).replace(/^\/+/, "");
    const html = await get(url);
    const page = { items: cards(html) };
    const next = nextOf(html);
    if (next) page.next = next;
    return page;
  }
  if (!q) return [];

  // La página /search del sitio tarda 18-25 s con consultas populares y Kino corta a los 15 s, así
  // que se piden a la vez su buscador (JSON, liviano) y la página: gana el que conteste primero con
  // resultados. La página se usa además cuando el buscador no conoce la palabra.
  const key = q.toLowerCase();
  const hit = cacheGet("search:" + key);
  if (hit) {
    log("search:", q, "desde la caché ·", hit.length, "resultados");
    return hit;
  }

  const started = Date.now();
  const enc = encodeURIComponent(q);
  let answered = false;
  let pageOk = false;
  // Los dos caminos salen a la vez y cada uno con su propio presupuesto: el buscador del sitio
  // (JSON, pequeño) responde antes que la página de resultados, que con consultas populares tarda
  // más de lo que Kino espera.
  const quick = kino
    .fetch(BASE + "/api/suggest?q=" + enc, { headers: { Accept: "application/json" }, timeoutMs: 8000 })
    .then((r) => {
      answered = true;
      return r.ok ? r.json() : null;
    })
    .catch((e) => {
      log("search: el buscador falló:", (e && e.code) || "error");
      return null;
    });
  const full = get(BASE + "/search?q=" + enc, 8000)
    .then((html) => {
      pageOk = true;
      return cards(html);
    })
    .catch((e) => {
      log("search: la página falló:", (e && e.code) || "error");
      return null;
    });

  const sharp = suggested(await quick, q);
  let items = sharp;
  if (!items.length && answered) {
    const page = await full;
    if (page) items = page;
  } else {
    full.catch(() => {});
  }

  const took = Date.now() - started;
  log("search:", q, "->", items.length, "resultados en", took, "ms · buscador", sharp.length, "· página", pageOk ? "sí" : "no");
  remember("search", "«" + q + "»: " + items.length + " resultados en " + took + " ms");
  if (items.length) cachePut("search:" + key, items);
  return items;
}

async function browseSitio(ref, cursor) {
  const path = cursor || ref;
  if (!path) return { items: [] };
  const url = /^https?:\/\//.test(path) ? path : BASE + "/" + String(path).replace(/^\/+/, "");
  const html = await get(url);
  const page = { items: cards(html) };
  const next = nextOf(html);
  if (next) page.next = next;
  return page;
}

// ---------------------------------------------------------------- ficha de una película (apiVersion 8)

function isoRuntime(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(String(iso || ""));
  if (!m) return 0;
  const total = Number(m[1] || 0) * 1440 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
  return total > 0 ? Math.min(1000, total) : 0;
}

// La ficha de una película. Devuelve también los ids que conoce (tmdb del reproductor, imdb del
// JSON-LD) para que Kino complete la página con TMDB, y si a la página le falta sinopsis, géneros o
// duración se lo pregunta a kino.meta (Kino pone la llave, el plugin nunca ve una).
async function detailsSitio(ref) {
  const path = String(ref == null ? "" : ref).replace(/^\/+/, "");
  if (!path) return null;
  const html = await get(BASE + "/" + path);
  const ld = ldOf(html);
  const node = ld.Movie || ld.TVSeries || {};
  const info = {};
  if (node.name) info.title = textOf(node.name);
  if (node.description) info.overview = textOf(node.description);
  const images = node.image ? (Array.isArray(node.image) ? node.image : [node.image]) : [];
  if (images.length) info.poster = images[0];
  if (images.length > 1) info.backdrop = images[1];
  if (node.genre) {
    info.genres = (Array.isArray(node.genre) ? node.genre : [node.genre]).slice(0, 5).map((g) => String(g).slice(0, 30));
  }
  if (node.datePublished) info.year = String(node.datePublished).slice(0, 4);
  const rating = Number(node.aggregateRating && node.aggregateRating.ratingValue);
  if (isFinite(rating) && rating > 0) info.rating = Math.min(10, rating);
  const minutes = isoRuntime(node.duration);
  if (minutes) info.runtimeMinutes = minutes;

  const play = playInfo(html);
  const ids = {};
  if (play && /^\d+$/.test(play.tmdb)) ids.tmdb = Number(play.tmdb);
  const same = node.sameAs;
  const links = same ? (Array.isArray(same) ? same : [same]) : [];
  for (let i = 0; i < links.length; i++) {
    const imdb = /imdb\.com\/title\/(tt\d{5,10})/.exec(String(links[i]));
    if (imdb) ids.imdb = imdb[1];
  }
  if (ids.tmdb || ids.imdb) info.ids = ids;

  const faltan = !info.overview || !info.genres || !info.runtimeMinutes;
  if (faltan && ids.tmdb && typeof kino.meta === "function") {
    try {
      const m = await kino.meta({ type: "movie", ids: { tmdb: ids.tmdb }, lang: kino.lang });
      if (m) {
        if (!info.overview && m.overview) info.overview = String(m.overview).slice(0, 2000);
        if (!info.genres && m.genres) info.genres = m.genres.slice(0, 5);
        if (!info.runtimeMinutes && m.runtimeMinutes) info.runtimeMinutes = m.runtimeMinutes;
        if (!info.rating && m.ratings && m.ratings.length) {
          const v = Number(m.ratings[0] && m.ratings[0].value);
          if (isFinite(v) && v > 0) info.rating = Math.min(10, v);
        }
      }
    } catch (e) {
      // kino.meta es un extra: si falla, la ficha sigue con lo que dio la página.
    }
  }
  return Object.keys(info).length ? info : null;
}

async function episodesSitio(ref) {
  const path = String(ref == null ? "" : ref).replace(/^\/+/, "");
  if (!path) throw kino.error("not_found");
  const html = await get(BASE + "/" + path);
  const list = episodesOf(html);
  if (!list.length) {
    throw kino.error("not_found", "sin episodios en " + path, {
      userMessage: "UltraPelisHD todavía no tiene episodios de esta serie.",
    });
  }
  const out = { episodes: list };
  const info = seriesInfo(html);
  if (info.title || info.overview) out.series = info;
  const seasons = seasonsOf(html, path);
  if (seasons.length > 1) out.seasons = seasons;
  return out;
}

// ---------------------------------------------------------------- panel del reproductor (apiVersion 9)

function seriesRefOf(ref) {
  const s = String(ref || "");
  const ep = /^e:(\d+):\d+:\d+$/.exec(s);
  if (ep) return "s:" + ep[1];
  if (/^s:\d+$/.test(s)) return s;
  const m = /^(.*?)\/season\/\d+\/episode\/\d+$/.exec(s);
  return m ? m[1] : "";
}

// "🇲🇽 Latino · 7 servidores", agrupado como los entrega el sitio. Se guarda cinco minutos para que el
// panel abra rápido y para no repetir las tres peticiones cada vez que la persona lo abre.
function copiesText(counts) {
  const lines = [];
  for (let i = 0; i < counts.order.length; i++) {
    const code = counts.order[i];
    const n = counts.by[code];
    lines.push(langLine(code, n));
  }
  return lines.join("\n").slice(0, 1000);
}

function langLine(code, n) {
  const l = langOf(code);
  return l.flag + " " + l.name + " · " + n + (n === 1 ? " servidor" : " servidores");
}

async function copiesFor(ref, fresh) {
  const key = "cop:" + String(ref || "");
  const cached = kino.storage.get(key);
  if (!fresh && cached && cached.at && cached.text && Date.now() - cached.at < 300000) return cached.text;

  // Películas del índice: las copias se conocen sin abrir la puerta ni gastar la sesión.
  const raw = String(ref || "");
  if (/^[mse]:/.test(raw) && catReady()) {
    try {
      const item = await catItem(raw[0] === "e" ? "s:" + raw.split(":")[1] : raw);
      const codes = item && item.data && typeof item.data.c === "string" ? item.data.c.split(",").filter(Boolean) : [];
      if (codes.length) {
        const by = new Map();
        for (const c of codes) by.set(c[0], (by.get(c[0]) || 0) + 1);
        const lines = [...by].map(([letter, n]) => {
          const l = langOf(LETTERS[letter] || letter);
          return l.flag + " " + l.name + " · " + n + (n === 1 ? " copia" : " copias");
        });
        const text = lines.join("\n");
        if (text) {
          try { kino.storage.set(key, { at: Date.now(), text: text }); } catch (e) {}
          return text;
        }
      }
    } catch (e) {
      log("panel: no se pudo leer el índice:", (e && e.code) || "error");
    }
  }

  let path = raw.replace(/^\/+/, "");
  if (/^[mse]:/.test(raw)) {
    try {
      const item = await catItem(raw[0] === "e" ? "s:" + raw.split(":")[1] : raw);
      path = await sessionPathOf(raw, item);
    } catch (e) {}
  }
  if (!path) return "";
  const pageUrl = BASE + "/" + path;
  const fuentes = await fuentesDe(pageUrl, Date.now() + 8000);
  let play = null;
  let servers = [];
  for (let i = 0; i < fuentes.length && !servers.length; i++) {
    if (!fuentes[i].passPath) continue;
    const pass = await getPass(fuentes[i], pageUrl);
    servers = ordered(await listServers(fuentes[i], pass, pageUrl));
    play = fuentes[i];
  }
  if (!play) return "";
  const counts = { by: {}, order: [] };
  for (let i = 0; i < servers.length; i++) {
    const code = servers[i].lang || "";
    if (!counts.by[code]) {
      counts.by[code] = 0;
      counts.order.push(code);
    }
    counts.by[code]++;
  }
  const text = counts.order.length ? copiesText(counts) : "";
  if (text) kino.storage.set(key, { at: Date.now(), text: text });
  return text;
}

async function buildPanel(context, fresh) {
  const en = String(kino.lang || "es").indexOf("en") === 0;
  const elements = [];
  const playing = context.playing && context.playing.label ? context.playing.label : "";
  elements.push({ type: "status", text: playing || (en ? "Playing from UltraPelisHD" : "Reproduciendo desde UltraPelisHD") });

  let copies = "";
  try {
    copies = await copiesFor(context.ref, fresh);
  } catch (e) {
    copies = "";
  }
  elements.push({
    type: "section",
    title: en ? "Copies on UltraPelisHD" : "Copias en UltraPelisHD",
    text: copies || (en ? "Couldn't read the list right now." : "No se pudo leer la lista ahora mismo."),
  });

  const step = Math.max(5000, Math.round((context.seekStepMs || 10000) / 1000) * 1000);
  const seconds = String(Math.round(step / 1000));
  elements.push({
    type: "row",
    gap: "small",
    children: [
      { type: "button", key: "back", label: "−" + seconds + " s" },
      { type: "button", key: "fwd", label: "+" + seconds + " s" },
      { type: "button", key: "speed", label: en ? "Speed 1.25x" : "Velocidad 1,25x" },
    ],
  });

  const series = seriesRefOf(context.ref);
  if (series) elements.push({ type: "episodes", ref: series });

  elements.push({ type: "button", key: "refresh", label: en ? "Refresh links" : "Actualizar enlaces" });
  return {
    title: String(context.title || "UltraPelisHD").slice(0, 60),
    accent: "#54B9C5",
    refreshMs: 30000,
    elements: elements,
  };
}

export async function panel(context) {
  return buildPanel(context || {}, false);
}

export async function panelAction(event, context) {
  const key = event && event.key;
  const ctx = context || {};
  const step = Math.max(5000, Math.round((ctx.seekStepMs || 10000) / 1000) * 1000);
  const pos = Number(ctx.positionMs) || 0;
  if (key === "back") return { player: { seekToMs: Math.max(0, pos - step) } };
  if (key === "fwd") return { player: { seekToMs: pos + step } };
  if (key === "speed") return { player: { speed: 1.25 } };
  if (key === "refresh") {
    return { panel: await buildPanel(ctx, true), message: "Enlaces del reproductor actualizados." };
  }
  return null;
}

// Al terminar un capítulo, Kino ofrece el siguiente con cuenta regresiva en vez de saltar de golpe.
export async function playerEvent(event, context) {
  if (!event || event.type !== "ended") return null;
  if (!seriesRefOf(context && context.ref)) return null;
  return { player: { autoNext: { enabled: true, countdownS: 8 } } };
}

// ---------------------------------------------------------------- pantalla (apiVersion 20, como Xuper)
//
// El cascar\u00f3n es el de Xuper: un Scaffold con una barra que se funde con la de Kino (`mergeWithKinoBar`),
// cinco destinos abajo en el tel\u00e9fono y el mismo cat\u00e1logo dentro. En el televisor no hay barra inferior:
// los destinos van como TabBar en la cabecera.

const NAV = [
  { key: "inicio", icon: "home", es: "Inicio", en: "Home" },
  { key: "peliculas", icon: "movie", es: "Pel\xEDculas", en: "Movies" },
  { key: "series", icon: "tv", es: "Series", en: "Series" },
  { key: "anime", icon: "star", es: "Anime", en: "Anime" },
  { key: "ajustes", icon: "settings", es: "Ajustes", en: "Settings" },
];

const navKey = (v) => {
  const k = String(v == null ? "" : v);
  for (let i = 0; i < NAV.length; i++) if (NAV[i].key === k) return k;
  return "inicio";
};

const twin = (es, en) => ({ text: es, textEn: en });
const busyBar = () => ({ type: "LinearProgressIndicator", key: "busy", hidden: true });
const busyEvent = (event, arg) => ({ ui: [{ show: "busy" }], event: event, ...(arg !== undefined ? { arg: arg } : {}) });
const borde = { left: 12, right: 12 };

const navBar = (active) => ({
  type: "NavigationBar",
  value: active,
  onChanged: busyEvent("nav"),
  items: NAV.map((n) => ({ key: n.key, icon: n.icon, label: n.es, labelEn: n.en })),
});

const navTabs = (active) => ({
  type: "TabBar",
  key: "navTabs",
  divider: false,
  value: active,
  onChanged: busyEvent("nav"),
  tabs: NAV.map((n) => ({ value: n.key, label: n.es, labelEn: n.en })),
});

const marca = { type: "Text", key: "marca", text: "UltraPelisHD", textEn: "UltraPelisHD", style: "h4" };

const cerrarLeading = () => ({
  type: "IconButton",
  key: "cerrar",
  icon: "close",
  labelText: "Cerrar",
  labelTextEn: "Close",
  onPressed: { go: { close: true } },
});

function appBar(nav, device, actions) {
  if (device === "tv") {
    return {
      type: "AppBar",
      mergeWithKinoBar: true,
      dense: true,
      divider: false,
      leading: cerrarLeading(),
      title: { type: "Row", key: "tvTitle", gap: 16, crossAxisAlignment: "center", children: [marca, navTabs(nav)] },
      ...(actions.length ? { actions: actions } : {}),
    };
  }
  const titulo = nav === "inicio" ? marca : { type: "Text", key: "secTitle", text: NAV.find((n) => n.key === nav).es, textEn: NAV.find((n) => n.key === nav).en, style: "h4" };
  return {
    type: "AppBar",
    mergeWithKinoBar: true,
    dense: true,
    divider: false,
    leading: cerrarLeading(),
    title: titulo,
    ...(actions.length ? { actions: actions } : {}),
  };
}

const railNode = (row, i, device) => ({
  type: "titleRail",
  key: "rail-" + i,
  title: String(row.title || "").slice(0, 80),
  items: (Array.isArray(row.items) ? row.items : []).slice(0, 24),
  ...(row.ref ? { ref: row.ref } : {}),
  size: device === "tv" ? "small" : "medium",
  margin: borde,
});

const bannerError = (es, en) => ({
  type: "MaterialBanner",
  key: "error",
  role: "error",
  margin: borde,
  text: es,
  textEn: en,
  action: { label: "Reintentar", labelEn: "Retry", onTap: busyEvent("reload") },
});

// El h\u00e9roe de Xuper: un PageView con las portadas de la primera fila, con sus dos botones.
function heroNode(items) {
  const slides = items.slice(0, 5).filter((x) => x && x.title);
  if (!slides.length) return null;
  const uno = (x, i) => ({
    type: "heroCard",
    key: "hero-" + i,
    h: { compact: 200, expanded: 240 },
    title: x.title,
    ...(x.poster || x.backdrop ? { image: x.backdrop || x.poster } : {}),
    buttons: [
      { type: "ElevatedButton", key: "play-" + i, labelText: "Ver", labelTextEn: "Play", icon: "play", onPressed: { go: { play: { ref: x.ref, kind: x.kind || "movie", id: x.id, title: x.title } } } },
      { type: "TextButton", key: "info-" + i, labelText: "Ficha", labelTextEn: "Details", onPressed: { go: { title: { ref: x.ref, kind: x.kind || "movie", id: x.id, title: x.title } } } },
    ],
  });
  if (slides.length === 1) return uno(slides[0], 0);
  return { type: "PageView", key: "hero", autoPlayMs: 6000, children: slides.map(uno) };
}

async function inicioNodes(device) {
  let rows = [];
  try {
    rows = (await home()) || [];
  } catch (e) {
    return [bannerError("No se pudo cargar el catálogo. Revisa la conexión.", "Could not load. Check your connection.")];
  }
  const conItems = rows.filter((r) => r && Array.isArray(r.items) && r.items.length);
  if (!conItems.length) return [bannerError("El catálogo llegó vacío.", "The catalog came back empty.")];
  const hero = heroNode(conItems[0].items);
  const rails = conItems.slice(0, 10).map((r, i) => railNode(r, i, device));
  return [...(hero ? [hero] : []), ...rails];
}

async function listaNodes(nav, device) {
  const tabs = { peliculas: "peliculas", series: "series", anime: "anime" };
  let rows = [];
  try {
    const r = await section({ tab: tabs[nav] });
    rows = (r && r.rows) || [];
  } catch (e) {
    return [bannerError("No se pudo cargar esta sección.", "This section could not be loaded.")];
  }
  const conItems = rows.filter((r) => r && Array.isArray(r.items) && r.items.length);
  if (!conItems.length) {
    return [{ type: "EmptyState", key: "vacio", icon: "movie", title: "Sin t\xEDtulos", titleEn: "No titles", text: "No hay t\xEDtulos disponibles ahora.", textEn: "No titles right now." }];
  }
  return conItems.map((r, i) => railNode(r, i, device));
}

async function busquedaNodes(query) {
  let items = [];
  try {
    items = (await search({ q: query })) || [];
  } catch (e) {
    return [bannerError("No se pudo buscar. Revisa la conexión.", "The search failed. Check your connection.")];
  }
  const head = {
    type: "Row",
    key: "q-head",
    gap: 12,
    crossAxisAlignment: "center",
    margin: borde,
    children: [
      { type: "Text", key: "q-t", text: `Resultados para \u201c${query}\u201d`, textEn: `Results for \u201c${query}\u201d`, style: "h4", flex: 1, maxLines: 2 },
      { type: "TextButton", key: "q-clear", labelText: "Quitar", labelTextEn: "Clear", onPressed: busyEvent("clearSearch") },
    ],
  };
  if (!items.length) {
    return [head, { type: "EmptyState", key: "q-vacio", icon: "search", title: "Sin resultados", titleEn: "No results", text: `No hay t\xEDtulos para \u201c${query}\u201d.`, textEn: `Nothing for \u201c${query}\u201d.` }];
  }
  return [head, { type: "titleGrid", key: "q-grid", columns: { compact: 3, expanded: 5 }, items: items.slice(0, 60) }];
}

async function ajustesNodes(state) {
  const out = [];
  if (state && state.aviso) out.push({ type: "MaterialBanner", key: "aviso", role: "info", margin: borde, text: String(state.aviso), textEn: String(state.aviso) });
  out.push(indexCard());
  let estado = "Sin comprobaci\u00f3n todav\xEDa";
  try {
    const st = await settingsStatus();
    estado = String((st && st.estado) || estado);
  } catch (e) {}
  const idioma = String(kino.config.get("lang") || "auto");
  const nombres = { auto: "Autom\xE1tico", LAT: "Latino", ESP: "Castellano", SUB: "Subtitulado", ENG: "Ingl\xE9s" };
  out.push({
    type: "Card",
    key: "aj-card",
    margin: borde,
    padding: 16,
    gap: 12,
    children: [
      { type: "Text", key: "aj-t", text: "UltraPelisHD", style: "h4" },
      { type: "Text", key: "aj-estado", text: estado, textEn: estado, color: "muted" },
      {
        type: "Row",
        key: "aj-row-idioma",
        gap: 8,
        crossAxisAlignment: "center",
        children: [
          { type: "Icon", key: "aj-i-idioma", name: "language", size: 20, color: "primary" },
          { type: "Text", key: "aj-idioma", text: `Idioma preferido: ${nombres[idioma] || idioma}`, textEn: `Preferred language: ${nombres[idioma] || idioma}`, flex: 1 },
        ],
      },
      {
        type: "Text",
        key: "aj-cuenta",
        color: "muted",
        text: "El sitio ahora pide una cuenta gratis para reproducir. Inicia sesi\u00f3n una vez y el plugin usar\u00e1 tu sesi\u00f3n.",
        textEn: "The site now needs a free account to play. Sign in once and the plugin will use your session.",
      },
    ],
  });
  out.push({
    type: "Row",
    key: "aj-acciones",
    gap: 12,
    wrap: true,
    margin: borde,
    children: [
      { type: "TextButton", key: "aj-sesion", icon: "person", labelText: "Iniciar sesi\u00f3n", labelTextEn: "Sign in", onPressed: busyEvent("sesion") },
      { type: "TextButton", key: "aj-comprobar", icon: "refresh", labelText: "Comprobar el sitio", labelTextEn: "Check the site", onPressed: busyEvent("comprobar") },
      { type: "TextButton", key: "aj-limpiar", icon: "delete", labelText: "Borrar la cach\xE9", labelTextEn: "Clear cache", onPressed: busyEvent("limpiar") },
    ],
  });
  out.push({
    type: "Text",
    key: "aj-nota",
    color: "muted",
    style: "caption",
    margin: borde,
    text: "Los dem\xE1s ajustes est\xE1n en Ajustes \u25b8 Plugins \u25b8 UltraPelisHD.",
    textEn: "The other settings are in Settings \u25b8 Plugins \u25b8 UltraPelisHD.",
  });
  return out;
}

const searchSheet = (query) => ({
  type: "BottomSheet",
  key: "buscar",
  title: "Buscar",
  titleEn: "Search",
  children: [
    {
      type: "TextField",
      key: "sq",
      kind: "search",
      maxLength: 120,
      labelText: "Pel\xEDculas y series",
      labelTextEn: "Movies and series",
      trailingIcon: "search",
      trailingLabel: "Buscar",
      trailingLabelEn: "Search",
      onSubmitted: { event: "search" },
      onTrailingTap: { event: "search" },
    },
    ...(query ? [{ type: "TextButton", key: "sq-clear", labelText: "Quitar la b\xFAsqueda", labelTextEn: "Clear search", onPressed: busyEvent("clearSearch") }] : []),
  ],
});

// La ventana del sitio: la persona crea su cuenta o entra, y el plugin usa esa sesi\u00f3n después.
async function iniciarSesion() {
  if (!canUseHiddenBrowser()) {
    return { message: "Esta versi\u00f3n de Kino no deja abrir la ventana del sitio. Entra en ultrapelishd.com desde el navegador, crea tu cuenta y vuelve." };
  }
  try {
    await kino.browser.page(BASE + "/account/login", { timeoutMs: 180000, waitFor: "form" });
    remember("sesion", "ventana de acceso abierta");
    return { message: "Si ya iniciaste sesi\u00f3n, vuelve a intentar la reproducci\u00f3n." };
  } catch (e) {
    const code = (e && e.code) || (e && e.message) || "error";
    log("iniciar sesi\u00f3n:", code);
    return { message: "No se pudo abrir la ventana del sitio (" + code + "). Int\xE9ntalo desde Ajustes con la app abierta." };
  }
}

export async function screen(arg) {
  const state = (arg && arg.state) || {};
  const device = (arg && arg.device) || "phone";
  // Una importación en curso (o recién empezada) manda: su barra y su tick, sin tocar la red aquí.
  if (state.indexing || indexing()) return indexView(state, device);
  const nav = navKey(state.nav);
  const query = typeof state.query === "string" ? state.query.trim().slice(0, 120) : "";

  let nodes;
  if (query) nodes = await busquedaNodes(query);
  else if (nav === "ajustes") nodes = await ajustesNodes(state);
  else if (nav === "inicio") nodes = await inicioNodes(device);
  else nodes = await listaNodes(nav, device);
  if (!Array.isArray(nodes) || !nodes.length) nodes = [bannerError("No se pudo cargar el cat\u00e1logo.", "Could not load the catalog.")];

  const actions = [
    { type: "IconButton", key: "abrir-buscar", icon: "search", labelText: "Buscar", labelTextEn: "Search", onPressed: { ui: [{ open: "buscar" }] } },
  ];

  const out = {
    type: "Scaffold",
    key: "ultrapelis-screen",
    appBar: appBar(nav, device, actions),
    body: {
      type: "Column",
      key: "ultrapelis-page",
      flex: 1,
      children: [
        busyBar(),
        { type: "ListView", key: `ultrapelis-${nav}${query ? "-buscar" : ""}`, flex: 1, padding: { compact: { bottom: 16 }, expanded: { bottom: 24 } }, gap: 12, items: nodes },
        searchSheet(query),
      ],
    },
  };
  if (device !== "tv") out.bottomNavigationBar = navBar(nav);
  return out;
}

export async function screenEvent(ev) {
  const event = ev || {};
  const state = Object.assign({ nav: "inicio", query: "", aviso: "" }, event.state || {});
  state.nav = navKey(state.nav);
  const ui = [{ hide: "busy" }];
  const name = String(event.name || "");

  // Descarga e importación del índice: un trozo por evento, con su barra.
  if (name === "index" || name === "indexTick") {
    try {
      if (name === "index") {
        const r = await indexStart(false);
        if (r.upToDate) {
          state.indexing = false;
          state.aviso = "El índice ya está al día (" + r.version + ").";
          return { ui, state };
        }
      }
      const t = await indexTick();
      if (t.done) {
        state.indexing = false;
        state.aviso = "Índice listo (" + t.version + ").";
      } else if (t.failed) {
        state.indexing = false;
        state.aviso = "No se pudo descargar el catálogo. Revisa la conexión y reinténtalo.";
      } else {
        state.indexing = true;
        state.indexPart = t.part;
        state.indexShards = t.shards;
        state.indexSeen = t.seen;
        state.indexTotal = t.total || 0;
      }
    } catch (e) {
      log("index:", (e && e.code) || (e && e.message) || "error");
      state.indexing = false;
      state.aviso = (e && e.userMessage) || "No se pudo descargar el índice.";
    }
    return { ui, state };
  }

  if (name === "nav") {
    state.nav = navKey(event.value !== undefined ? event.value : event.arg);
    state.query = "";
    state.aviso = "";
  } else if (name === "search") {
    const dicho = event.value !== undefined
      ? event.value
      : event.inputs && event.inputs.sq !== undefined
        ? event.inputs.sq
        : event.arg;
    state.query = String(dicho == null ? "" : dicho).trim().slice(0, 120);
    return { ui: [{ hide: "busy" }, { close: "buscar" }], state: state };
  } else if (name === "clearSearch") {
    state.query = "";
  } else if (name === "sesion") {
    const r = await iniciarSesion();
    state.aviso = (r && r.message) || "";
  } else if (name === "comprobar" || name === "limpiar") {
    try {
      if (name === "limpiar") {
        let n = 0;
        const claves = kino.storage.keys ? kino.storage.keys() : [];
        for (let i = 0; i < claves.length; i++) {
          if (claves[i].indexOf("ok:") === 0 || claves[i].indexOf("cache:") === 0) {
            kino.storage.remove(claves[i]);
            n++;
          }
        }
        state.aviso = "Cach\xE9 borrada (" + n + " entradas).";
      } else {
        const r = await action("probar");
        state.aviso = (r && r.message) || "";
      }
    } catch (e) {
      state.aviso = "No se pudo completar la acci\u00f3n.";
    }
  }
  return { ui: ui, state: state };
}

// ---------------------------------------------------------------- estado y acciones de los ajustes

function agoText(at) {
  const when = Number(at) || 0;
  if (!when) return "";
  const minutes = Math.max(0, Math.round((Date.now() - when) / 60000));
  return minutes < 1 ? "hace un momento" : "hace " + minutes + " min";
}

export async function settingsStatus() {
  const check = kino.storage.get("check");
  const estado = check && Number(check.at)
    ? (check.ok ? "UltraPelisHD responde bien" : "No respondió la última vez") + " (" + agoText(check.at) + ")"
    : "Todavía no lo has probado.";

  const parts = [];
  const home = kino.storage.get("diag:home");
  const section = kino.storage.get("diag:section");
  const search = kino.storage.get("diag:search");
  const fetchError = kino.storage.get("diag:fetch");
  if (home && home.text && Number(home.at)) parts.push("Inicio: " + home.text + " (" + agoText(home.at) + ")");
  if (section && section.text && Number(section.at)) parts.push("Sección: " + section.text + " (" + agoText(section.at) + ")");
  if (search && search.text) parts.push("Buscar: " + search.text);
  if (fetchError && fetchError.text) parts.push("Último error: " + fetchError.text);
  return {
    estado: estado,
    indice: indexInfo().text,
    ultimo: (parts.join(" · ") || "Aún no hay lecturas registradas.").slice(0, 200),
  };
}

export async function action(key) {
  if (key === "indice") {
    try {
      const r = await indexStart(false);
      if (r.upToDate) return { message: "El índice ya está al día (" + r.version + ")." };
      const t = await indexTick();
      if (t && t.done) return { message: "Índice listo (" + t.version + ")." };
      return { message: "Descargando el catálogo… abre la pantalla del plugin para seguir el avance." };
    } catch (e) {
      return { message: (e && e.userMessage) || "No se pudo descargar el índice." };
    }
  }
  if (key !== "probar") return null;
  const started = Date.now();
  let status = 0;
  let page = "";
  let note = "";
  let apiOk = false;

  try {
    const r = await kino.fetch(BASE + "/", { headers: UA_PAGE, timeoutMs: 12000 });
    status = r.status;
    page = r.text();
    note = looksLikeCatalog(page) ? "con catálogo" : "SIN catálogo " + blockedNote(page);
  } catch (e) {
    note = "error " + String((e && e.code) || "de red");
  }

  try {
    const q = await kino.fetch(BASE + "/api/suggest?q=dune", {
      headers: { Accept: "application/json" },
      timeoutMs: 12000,
    });
    apiOk = q.ok;
  } catch (e) {
    apiOk = false;
  }

  const ok = status === 200 && looksLikeCatalog(page) && apiOk;
  kino.storage.set("check", { at: Date.now(), ok: ok });
  remember("fetch", ok ? "conexión correcta" : "inicio " + (status ? "HTTP " + status + ", " : "") + note);

  const head = status ? "Inicio: HTTP " + status + ", " + page.length + "B, " + note : note;
  const extra = looksLikeCatalog(page) ? "" : " · se pasa sola al abrir Inicio";
  return {
    message: (head + " · Buscador: " + (apiOk ? "bien" : "mal") + extra + " · " + (Date.now() - started) + " ms").slice(
      0,
      300,
    ),
  };
}
// ================================================================ índice de reproducción
//
// El sitio entrega las copias de sus películas detrás de una puerta que pide cuenta. Para que las
// películas se vean sin cuenta, el plugin trae un índice publicado en el release `catalog` de este
// repositorio: por película, su ruta en el sitio y los códigos de sus copias DoodStream. Se importa
// a kino.catalog (una fila por título), se refresca por deltas y un job de fondo deja preparada la
// actualización. Títulos, pósters, sinopsis y episodios salen de TMDB.
//
// Las series y sus capítulos no publican copia indexable: su reproducción sigue yendo por la sesión
// del sitio (ficha → puerta → pass → servidores), que es lo que hacía la 1.5.0.

const ASSET_BASE = "https://github.com/JuanDEVYT/UltraPelisHD_plugin/releases/download/catalog";
const CAT_REFRESH_MS = 6 * 3600 * 1000;
const JOB_STORE_CAP = 250000;
const UPSERT_BATCH = 500;
const CK = {
  ver: "catVersion", at: "catAt", target: "catTarget", shards: "catShards", part: "catPart",
  seen: "catSeen", total: "catTotal", recentM: "catRecentM", recentS: "catRecentS",
  pending: "catPending", hosts: "catHosts",
};

const sGet = (k) => { try { return kino.storage.get(k); } catch { return null; } };
const sSet = (k, v) => { try { kino.storage.set(k, v); } catch { /* storage lleno: se sigue sin eso */ } };
const sDel = (k) => { try { kino.storage.remove(k); } catch { /* nada que borrar */ } };
const parseList = (raw) => { try { return JSON.parse(raw || "[]"); } catch { return []; } };

/** El catálogo ya está importado (o hay algo usable en él). */
const catReady = () => !!sGet(CK.ver) || catRecentIds("movies").length > 0;
/** Una importación está en curso (se reanuda sola al abrir la pantalla). */
const indexing = () => !!sGet(CK.shards);

/** Líneas compactas del catálogo → filas de kino.catalog. Una película es `m:<tmdb>`, una serie `s:<tmdb>`. */
function linesToItems(movies, series) {
  const items = [];
  const recentMovies = [];
  const recentSeries = [];
  let rank = 1000000;
  for (const line of String(movies || "").split("\n")) {
    const [id, path, codes] = line.split("|");
    if (!/^\d+$/.test(id || "")) continue;
    const data = { p: String(path || "") };
    if (codes) data.c = codes;
    items.push({ id: "m:" + id, title: "", sort: rank--, data });
    recentMovies.push("m:" + id);
  }
  for (const line of String(series || "").split("\n")) {
    const [id, path] = line.split("|");
    if (!/^\d+$/.test(id || "")) continue;
    items.push({ id: "s:" + id, title: "", sort: rank--, data: { p: String(path || "") } });
    recentSeries.push("s:" + id);
  }
  return { items, recentMovies, recentSeries };
}

function appendRecent(key, ids) {
  if (!ids.length) return;
  sSet(key, JSON.stringify(parseList(sGet(key)).concat(ids)));
}

/** Importa un trozo entero (todas sus tandas de 500) y acumula los "recién agregados". */
async function importShard(shard) {
  const { items, recentMovies, recentSeries } = linesToItems(shard.movies, shard.series);
  for (let i = 0; i < items.length; i += UPSERT_BATCH) await kino.catalog.upsert(items.slice(i, i + UPSERT_BATCH));
  appendRecent(CK.recentM, recentMovies);
  appendRecent(CK.recentS, recentSeries);
  if (Array.isArray(shard.hosts) && shard.hosts.length) sSet(CK.hosts, JSON.stringify(shard.hosts));
  return items.length;
}

// ---- descarga del release ----

async function fetchJson(url) {
  try {
    const r = await kino.fetch(url, { timeoutMs: 15000 });
    if (!r || !r.ok) return null;
    return JSON.parse(await r.text());
  } catch { return null; }
}

/** El testigo pequeño con la versión publicada y sus trozos, o null (sin red / sin publicar). */
const fetchVersion = () => fetchJson(ASSET_BASE + "/catalog.version.json");
const fetchShard = (name) => fetchJson(ASSET_BASE + "/" + encodeURIComponent(name));
/** El delta desde `from`, o null cuando no existe (404) → se cae al catálogo completo. */
const fetchDelta = (from) => (from ? fetchJson(ASSET_BASE + "/delta/" + encodeURIComponent(from) + ".json") : null);

// ---- importación por tandas (reanudable) ----

/**
 * Empieza una importación completa: vacía kino.catalog y deja apuntados la versión y sus trozos.
 * Cada `indexTick` baja un trozo; así ninguna llamada se pasa del tiempo de Kino.
 */
async function indexStart(force) {
  const v = await fetchVersion();
  if (!v || typeof v.version !== "string") {
    throw kino.error("unavailable", "índice sin publicar", {
      userMessage: "Todavía no hay un índice publicado. Vuelve a intentarlo más tarde.",
    });
  }
  const local = sGet(CK.ver);
  if (!force && local === v.version) {
    let count = 0;
    try { count = await kino.catalog.count(); } catch { count = 0; }
    if (count > 0) return { upToDate: true, version: v.version };
  }
  const shards = (Array.isArray(v.shards) ? v.shards : []).map((x) => (typeof x === "string" ? x : x && x.name)).filter(Boolean);
  if (!shards.length) {
    throw kino.error("unavailable", "índice sin trozos", {
      userMessage: "El índice publicado está incompleto. Vuelve a intentarlo más tarde.",
    });
  }
  await kino.catalog.clear();
  sSet(CK.target, v.version);
  sSet(CK.shards, JSON.stringify(shards));
  sSet(CK.part, "0");
  sSet(CK.seen, "0");
  sSet(CK.total, String((Number(v.movies) || 0) + (Number(v.series) || 0)));
  sDel(CK.recentM);
  sDel(CK.recentS);
  sDel(CK.ver);
  log("índice:", "empieza la importación de", v.version, "·", shards.length, "trozo(s)");
  return { started: true, version: v.version, shards: shards.length };
}

function indexFinish() {
  const version = sGet(CK.target) || "";
  if (version) sSet(CK.ver, version);
  sSet(CK.at, String(Date.now()));
  sDel(CK.shards);
  sDel(CK.part);
  sDel(CK.seen);
  sDel(CK.total);
  sDel(CK.target);
  log("índice:", version, "importado");
  return { done: true, version };
}

/** Baja e importa el trozo pendiente. Devuelve el avance o {done}. */
async function indexTick() {
  const shards = parseList(sGet(CK.shards));
  const part = Number(sGet(CK.part)) || 0;
  if (!Array.isArray(shards) || !shards.length || part >= shards.length) return indexFinish();
  const shard = await fetchShard(shards[part]);
  if (!shard) return { failed: true, part, shards: shards.length };
  const n = await importShard(shard);
  const seen = (Number(sGet(CK.seen)) || 0) + n;
  sSet(CK.part, String(part + 1));
  sSet(CK.seen, String(seen));
  if (part + 1 >= shards.length) return indexFinish();
  return { part: part + 1, shards: shards.length, seen, total: Number(sGet(CK.total)) || 0 };
}

/** Lo que la pantalla necesita para dibujar el avance, sin tocar la red. */
function indexSnapshot() {
  const shards = parseList(sGet(CK.shards));
  return {
    indexing: shards.length > 0,
    indexPart: Number(sGet(CK.part)) || 0,
    indexShards: shards.length,
    indexSeen: Number(sGet(CK.seen)) || 0,
    indexTotal: Number(sGet(CK.total)) || 0,
  };
}

/** Aplica un delta publicado: quita lo que ya no está, añade lo nuevo y mueve los marcadores. */
async function applyDelta(delta) {
  const remove = Array.isArray(delta.remove) ? delta.remove : [];
  for (let i = 0; i < remove.length; i += 500) {
    try { await kino.catalog.remove(remove.slice(i, i + 500)); } catch { /* ids que no estaban */ }
  }
  const { items, recentMovies, recentSeries } = linesToItems(delta.addMovies || "", delta.addSeries || "");
  for (let i = 0; i < items.length; i += UPSERT_BATCH) await kino.catalog.upsert(items.slice(i, i + UPSERT_BATCH));
  const gone = new Set(remove);
  const merge = (key, news) => {
    const old = parseList(sGet(key));
    const have = new Set(old);
    sSet(key, JSON.stringify(news.filter((id) => !have.has(id)).concat(old.filter((id) => !gone.has(id)))));
  };
  merge(CK.recentM, recentMovies);
  merge(CK.recentS, recentSeries);
  if (delta.version) sSet(CK.ver, delta.version);
  sSet(CK.at, String(Date.now()));
  log("índice: delta aplicado ·", (delta.addMovies || "").split("\n").filter(Boolean).length, "películas,", (delta.addSeries || "").split("\n").filter(Boolean).length, "series");
}

/** Lo que el job dejó preparado: un delta o el aviso de que toca el catálogo completo. */
async function applyPending() {
  const raw = sGet(CK.pending);
  if (!raw) return false;
  sDel(CK.pending);
  let payload = null;
  try { payload = JSON.parse(raw); } catch { return false; }
  if (payload.kind === "delta" && payload.data) { await applyDelta(payload.data); return true; }
  if (payload.kind === "full") { await indexStart(true); return true; }
  return false;
}

/** Al abrir: si la copia local tiene más de seis horas, se pone al día (delta, o catálogo completo). */
async function ensureFresh() {
  if (!sGet(CK.ver) || indexing()) return;
  const at = Number(sGet(CK.at)) || 0;
  if (at && Date.now() - at < CAT_REFRESH_MS) return;
  const latest = await fetchVersion();
  if (!latest || typeof latest.version !== "string") return;
  if (latest.version === sGet(CK.ver)) { sSet(CK.at, String(Date.now())); return; }
  const delta = await fetchDelta(sGet(CK.ver));
  if (delta && delta.version === latest.version) { await applyDelta(delta); return; }
  await indexStart(true);
}

/**
 * Job de fondo (cada 6 h): deja en kino.storage el delta pendiente, o el aviso de catálogo completo.
 * kino.catalog no se puede tocar desde un job: la importación la hace la pantalla al abrirse.
 */
export async function job() {
  const latest = await fetchVersion();
  if (!latest || typeof latest.version !== "string") return;
  const current = sGet(CK.ver);
  if (!current || current === latest.version) return;
  const delta = await fetchDelta(current);
  if (delta && delta.version === latest.version) {
    const json = JSON.stringify({ kind: "delta", data: delta });
    if (json.length <= JOB_STORE_CAP) { sSet(CK.pending, json); return; }
  }
  sSet(CK.pending, JSON.stringify({ kind: "full", version: latest.version }));
}

// ---- lecturas del catálogo ----

async function catGet(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 500) out.push(...(await kino.catalog.get(ids.slice(i, i + 500))));
  return out;
}

async function catItem(ref) {
  const [it] = await catGet([String(ref)]);
  return it || null;
}

async function catHas(ids) {
  return new Set((await catGet(ids)).map((it) => it.id));
}

function catRecentIds(kind) {
  const raw = sGet(kind === "series" ? CK.recentS : CK.recentM);
  try { return raw ? JSON.parse(raw) : []; } catch { return []; }
}

const hostsList = () => parseList(sGet(CK.hosts));

// ================================================================ TMDB (títulos, pósters, fichas)

const IMG = "https://image.tmdb.org/t/p/";
const img = (size, p) => (p ? IMG + size + p : undefined);
const tmdbLang = () => (String(kino.lang || kino.language || "es").slice(0, 2).toLowerCase() === "en" ? "en-US" : "es-MX");
const yearOf = (d) => (typeof d === "string" && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : undefined);
const DAY = 24 * 3600 * 1000;

async function tmdb(path, params = {}) {
  try {
    return await kino.tmdb(path, { language: tmdbLang(), ...params });
  } catch (e) {
    if (e && e.code === "not_found") {
      throw kino.error("not_found", "tmdb 404 " + path, { userMessage: "No encontramos ese título." });
    }
    if (e && e.userMessage) throw e;
    throw kino.error("unavailable", "tmdb " + path + " " + (e && e.code), {
      userMessage: "No se pudo consultar el catálogo. Revisa la conexión e inténtalo de nuevo.",
    });
  }
}

function tGet(key) {
  try {
    const hit = kino.storage.get("t:" + key);
    if (hit && hit.at && hit.value) return hit.value;
  } catch { /* sin caché */ }
  return null;
}
function tSet(key, value, ttlMs) {
  try { kino.storage.set("t:" + key, { at: Date.now(), value }, { ttlMs }); } catch { /* lleno */ }
}

/** Solo lo que una tarjeta necesita; `tv` marca serie. */
const slim = (m, tv) => ({
  id: m.id,
  tv: tv ? 1 : 0,
  title: (tv ? m.name || m.original_name : m.title || m.original_title) || "",
  poster_path: m.poster_path,
  backdrop_path: m.backdrop_path,
  date: tv ? m.first_air_date : m.release_date,
  vote_average: m.vote_average,
});

function card(m, ref) {
  const tv = !!m.tv;
  return {
    id: (tv ? "s" : "m") + m.id,
    ref: ref || (tv ? "s:" : "m:") + m.id,
    title: m.title,
    kind: tv ? "series" : "movie",
    year: yearOf(m.date),
    poster: img("w342", m.poster_path),
    backdrop: img("w780", m.backdrop_path),
    rating: m.vote_average ? Math.round(m.vote_average * 10) / 10 : undefined,
    ids: { tmdb: m.id },
  };
}

async function movieFor(id) {
  const key = "mv:" + tmdbLang() + ":" + id;
  const hit = tGet(key);
  if (hit) return hit;
  let m = null;
  try { m = await tmdb("/movie/" + id); } catch { return null; }
  if (!m) return null;
  const out = slim(m, false);
  tSet(key, out, 14 * DAY);
  return out;
}

async function showFor(id) {
  const key = "tv:" + tmdbLang() + ":" + id;
  const hit = tGet(key);
  if (hit) return hit;
  let m = null;
  try { m = await tmdb("/tv/" + id); } catch { return null; }
  const out = slim(m, true);
  tSet(key, out, 14 * DAY);
  return out;
}

/** Una página de una lista de TMDB reducida a lo que está en el índice (cacheada 6 h). */
async function listPage(path, params, page, tv) {
  const key = "pg:" + tmdbLang() + ":" + path + ":" + JSON.stringify(params) + ":" + page;
  const hit = tGet(key);
  if (hit) return hit;
  const data = await tmdb(path, { ...params, page });
  const results = (data.results || []).filter((m) => m.poster_path);
  const present = await catHas(results.map((m) => (tv ? "s:" : "m:") + m.id));
  const out = {
    total: Math.min(data.total_pages || 1, 500),
    hits: results.filter((m) => present.has((tv ? "s:" : "m:") + m.id)).map((m) => slim(m, tv)),
  };
  tSet(key, out, DAY / 4);
  return out;
}

const PAGE = 20;
const MAX_TMDB_PAGES = 6;
const HOME_RECENT = 6;

const LISTS = {
  trending: { path: "/trending/movie/week", tv: false, es: "Películas en tendencia", en: "Trending movies" },
  trendingTv: { path: "/trending/tv/week", tv: true, es: "Series en tendencia", en: "Trending series" },
  popular: { path: "/movie/popular", tv: false, es: "Películas populares", en: "Popular movies" },
  popularTv: { path: "/tv/popular", tv: true, es: "Series populares", en: "Popular series" },
  now: { path: "/movie/now_playing", tv: false, es: "Estrenos", en: "New releases" },
  top: { path: "/movie/top_rated", tv: false, es: "Películas mejor valoradas", en: "Top rated movies" },
  topTv: { path: "/tv/top_rated", tv: true, es: "Series mejor valoradas", en: "Top rated series" },
};

const ANIME = { with_genres: 16, with_original_language: "ja", sort_by: "popularity.desc" };
const ANIME_LISTS = {
  animeAiring: { path: "/discover/tv", params: () => ({ ...ANIME, "air_date.gte": isoDay(Date.now() - 7 * 86400000), "air_date.lte": isoDay(Date.now()), "vote_count.gte": 10 }), tv: true, es: "Anime en emisión", en: "Airing anime" },
  anime: { path: "/discover/tv", params: () => ({ ...ANIME, "vote_count.gte": 50 }), tv: true, es: "Anime popular", en: "Popular anime" },
  animeMovies: { path: "/discover/movie", params: () => ({ ...ANIME, "vote_count.gte": 50 }), tv: false, es: "Películas de anime", en: "Anime movies" },
};
const DORAMAS = {
  doramas: { path: "/discover/tv", params: () => ({ with_original_language: "ko", sort_by: "popularity.desc", "vote_count.gte": 30 }), tv: true, es: "Doramas populares", en: "Popular K-dramas" },
  doramasTop: { path: "/discover/tv", params: () => ({ with_original_language: "ko", sort_by: "vote_average.desc", "vote_count.gte": 80 }), tv: true, es: "Doramas mejor valorados", en: "Top rated K-dramas" },
};
const titleOfList = (def) => (String(kino.lang || "es").slice(0, 2).toLowerCase() === "en" ? def.en : def.es);
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Camina páginas de TMDB desde [startPage] quedándose con los títulos del índice, hasta [PAGE]. */
async function filtered(path, params, startPage, tv, maxPages = MAX_TMDB_PAGES) {
  const items = [];
  let page = startPage;
  let total = 1;
  for (let n = 0; n < maxPages && items.length < PAGE; n++, page++) {
    const data = await listPage(path, params, page, tv);
    total = data.total;
    for (const m of data.hits) items.push(card(m));
    if (page >= total) return { items, next: undefined };
  }
  return { items, next: String(page) };
}

/** Chips de idioma de una película del índice (Latino/Subtitulado; Castellano es lo común). */
function badgesOf(codes) {
  const set = new Set(String(codes || "").split(",").filter(Boolean).map((c) => c[0]));
  const b = [];
  if (set.has("L")) b.push("Latino");
  if (set.has("S")) b.push("Sub");
  return b;
}

/** Prefijos del índice → tarjetas con póster de TMDB y su chip de idioma. */
async function idsToItems(ids, tv) {
  const found = await Promise.all(ids.map((id) => (tv ? showFor : movieFor)(id.slice(2))));
  const codes = new Map();
  try {
    const rows = await catGet(ids);
    for (const it of rows) if (it && it.data && typeof it.data.c === "string") codes.set(it.id, it.data.c);
  } catch { /* sin chips */ }
  const items = [];
  found.forEach((m, i) => {
    if (!m || !m.poster_path) return;
    const c = card(m, ids[i]);
    const b = codes.has(ids[i]) ? badgesOf(codes.get(ids[i])) : [];
    if (b.length) c.badges = b;
    items.push(c);
  });
  return items;
}

/** Los recién agregados en el orden del índice (más nuevos primero). */
async function recent(cursor, size, tv) {
  const ids = catRecentIds(tv ? "series" : "movies");
  const from = Math.max(0, parseInt(cursor || "0", 10) || 0);
  const items = await idsToItems(ids.slice(from, from + size), tv);
  return { items, next: from + size < ids.length ? String(from + size) : undefined };
}

/** Una fila de lista de TMDB con lo que hay en el índice, para el Inicio y las secciones. */
async function rowOf(def, startPage = 1, maxPages = 1) {
  const r = await filtered(def.path, typeof def.params === "function" ? def.params() : {}, startPage, !!def.tv, maxPages);
  return { title: titleOfList(def), items: r.items, next: r.next };
}

// ================================================================ puertas de reproducción

/** El motor compartido (xuper-plugin/kino-plugin-kino-resolver) resuelve el embed de DoodStream. */
async function viaResolver(embedUrl) {
  let res;
  try {
    res = await kino.plugins.call("resolver", "resolve", { url: embedUrl, referer: BASE + "/" });
  } catch (e) {
    if (e && e.code === "provider_missing") {
      const err = kino.error("unavailable", "falta el motor de reproducción", {
        userMessage: "Instala el motor de reproducción (gratis) desde el menú del plugin para ver sin cuenta, o inicia sesión en Ajustes.",
      });
      try { err.resolverMissing = true; } catch { /* sellado */ }
      throw err;
    }
    throw kino.error("unavailable", "motor: " + ((e && e.code) || "falló") + " " + embedUrl);
  }
  const s = (res && Array.isArray(res.streams) ? res.streams : []).find((x) => x && x.url);
  if (!s) throw kino.error("unavailable", "sin flujo: " + embedUrl);
  const headers = {};
  if (s.referer) headers.Referer = s.referer;
  if (Array.isArray(s.headers)) {
    for (const h of s.headers) if (h && h.name) headers[h.name] = String(h.value);
  } else if (s.headers && typeof s.headers === "object") Object.assign(headers, s.headers);
  return { url: s.url, mime: s.kind === "hls" ? HLS : "video/mp4", headers, expiresInSeconds: 3600 };
}

const LETTERS = { L: "LAT", E: "ESP", S: "SUB", I: "ENG", O: "" };
const labelOfSlot = (slot) => {
  const l = langOf(LETTERS[slot[0]] || slot[0]);
  return l.flag + " " + l.name + " · DoodStream";
};

/** Una copia del índice: `L0e/abc123` = idioma, índice de host, camino en el host. */
async function playSlot(slot) {
  const host = hostsList()[parseInt(String(slot).slice(1, 2), 16)];
  const rest = String(slot).slice(2);
  if (!host || !rest) throw kino.error("invalid_request", "copia inválida: " + slot);
  return viaResolver("https://" + host + "/" + rest);
}

// Copias que ya fallaron en este aparato: no se reintentan durante una semana.
const DEAD_MS = 7 * 24 * 3600 * 1000;
let deadSet = null;
function deadSlots() {
  if (deadSet) return deadSet;
  deadSet = new Set(parseList(sGet("deadSlots")));
  return deadSet;
}
function markDeadSlot(slot) {
  const set = deadSlots();
  if (set.has(slot)) return;
  set.add(slot);
  try { kino.storage.set("deadSlots", JSON.stringify([...set].slice(-4000)), { ttlMs: DEAD_MS }); } catch { /* lleno */ }
}

/** El idioma preferido primero; luego Latino, Castellano, Subtitulado, Inglés. */
function rankCodes(codes) {
  const pref = String(kino.config.get("lang") || "auto").toUpperCase();
  const want = { LAT: "L", ESP: "E", SUB: "S", ENG: "I" }[pref] || "";
  const at = (c) => ("LESI".indexOf(c[0]) >= 0 ? "LESI".indexOf(c[0]) : 4);
  return [...codes].sort((a, b) => (a[0] === want ? 0 : 10) + at(a) - ((b[0] === want ? 0 : 10) + at(b)));
}

/** La ruta del sitio de un ref del índice: la ficha tal cual, o el capítulo por su temporada y número. */
async function sessionPathOf(ref, item) {
  const base = String((item && item.data && item.data.p) || "").replace(/^\/+/, "");
  if (!base || ref[0] !== "e") return base;
  const [, season, episode] = String(ref).split(":");
  const s = Number(season) || 1;
  const e = Number(episode) || 1;
  try {
    const html = await get(BASE + "/" + base);
    const list = episodesOf(html);
    const hit = list.find((x) => x.season === s && x.number === e) || list.filter((x) => x.season === s)[e - 1];
    if (hit && hit.ref) return hit.ref;
  } catch (err) {
    log("capítulo:", "no se pudo leer la lista del sitio:", (err && err.code) || (err && err.message) || "error");
  }
  return base + "/season/" + s + "/episode/" + e;
}

// ================================================================ resolve

/**
 * Reproduce un ref del índice: primero las copias DoodStream indexadas (sin cuenta); si no hay o
 * ninguna carga, el camino con sesión del sitio (series, capítulos y respaldo).
 */
export async function resolve(ref) {
  const raw = String(ref == null ? "" : ref);
  if (!raw) throw kino.error("not_found");

  // Una copia concreta del menú Servidor (`c:<slot>`).
  const lazy = /^c:([A-Za-z0-9]{6,80})$/.exec(raw);
  if (lazy) {
    try { return await playSlot(lazy[1]); } catch (e) {
      if (e && e.resolverMissing) throw e;
      markDeadSlot(lazy[1]);
      throw kino.error("unavailable", "la copia no cargó", { userMessage: "Esa copia ya no está disponible. Elige otra en el menú Servidor." });
    }
  }

  // Refs viejos (ruta del sitio o "ruta|servidor"): directo por la sesión.
  if (raw.indexOf("|") >= 0 || !/^[mse]:/.test(raw)) return resolverSesion(raw);

  const seriesId = raw[0] === "e" ? "s:" + String(raw).split(":")[1] : raw;
  let item = null;
  try { item = await catItem(seriesId); } catch { item = null; }
  if (!item) {
    throw kino.error("not_found", "no está en el índice: " + raw, {
      userMessage: "Este título no está en el índice del plugin. Actualízalo en Ajustes ▸ UltraPelisHD.",
    });
  }

  const codes = raw[0] === "m" && item.data && typeof item.data.c === "string" ? item.data.c.split(",").filter(Boolean) : [];
  if (codes.length) {
    const hasta = Date.now() + RESOLVE_MS;
    const guardado = leerOk(raw);
    if (guardado && (await vivo(guardado.url, guardado.headers, hasta))) return guardado;
    if (guardado) borrarOk(raw);
    const list = rankCodes(codes.filter((c) => !deadSlots().has(c)));
    for (let i = 0; i < Math.min(list.length, 3); i++) {
      const slot = list[i];
      try {
        const stream = await playSlot(slot);
        const rest = list.filter((c) => c !== slot);
        const out = {
          ...stream,
          label: labelOfSlot(slot),
          ...(rest.length ? { alternatives: rest.slice(0, MAX_ALTERNATIVAS).map((c) => ({ label: labelOfSlot(c), ref: "c:" + c })) } : {}),
        };
        guardarOk(raw, out);
        log("resolve:", raw, "->", out.label);
        return out;
      } catch (e) {
        if (e && e.resolverMissing) break; // sin motor: se intenta la sesión, que no lo necesita
        markDeadSlot(slot);
        log("copia muerta:", slot, (e && e.code) || (e && e.message) || "error");
      }
    }
  }

  // Sesión del sitio: la ficha (o el capítulo) y su puerta.
  const path = await sessionPathOf(raw, item);
  if (!path) throw kino.error("not_found", "sin ruta en el sitio: " + raw);
  return resolverSesion(path);
}

// ================================================================ filas del catálogo

export async function home() {
  if (!catReady()) return homeSitio();
  if (indexing()) return [];
  try { await applyPending(); await ensureFresh(); } catch (e) { log("home: refresco falló:", (e && e.code) || (e && e.message) || "error"); }
  if (indexing()) return [];
  const defs = [
    ["recent", () => recent(null, HOME_RECENT, false)],
    ["recentTv", () => recent(null, HOME_RECENT, true)],
    ...Object.keys(ANIME_LISTS).map((id) => [id, () => rowOf(ANIME_LISTS[id])]),
    ...["trending", "trendingTv", "popular", "popularTv"].map((id) => [id, () => rowOf(LISTS[id])]),
  ];
  const settled = await Promise.allSettled(defs.map(([, fn]) => fn()));
  const rows = [];
  settled.forEach((r, i) => {
    if (r.status !== "fulfilled" || !r.value || !r.value.items.length) return;
    const id = defs[i][0];
    const tv = id === "recentTv" || !!(LISTS[id] && LISTS[id].tv) || !!(ANIME_LISTS[id] && ANIME_LISTS[id].tv);
    const title = id === "recent" ? "Películas recién agregadas" : id === "recentTv" ? "Series recién agregadas" : titleOfList(ANIME_LISTS[id] || LISTS[id]);
    rows.push({
      id: "row-" + rowSlug(id),
      title,
      ref: "browse:" + id,
      items: r.value.items,
      genre: id.startsWith("anime") ? "anime" : tv ? "series" : "peliculas",
    });
  });
  if (!rows.length) return homeSitio();
  log("home (índice):", rows.length, "filas,", countItems(rows), "títulos");
  return rows;
}

export async function section(args) {
  if (!catReady()) return sectionSitio(args);
  const tab = args && args.tab;
  const chosen = TABS.some((t) => t.id === tab) ? tab : TABS[0].id;
  let defs;
  if (chosen === "peliculas") defs = [["recent", () => recent(null, PAGE, false)], ["trending", () => rowOf(LISTS.trending, 1, 2)], ["popular", () => rowOf(LISTS.popular, 1, 2)], ["top", () => rowOf(LISTS.top)], ["now", () => rowOf(LISTS.now)]];
  else if (chosen === "series") defs = [["recentTv", () => recent(null, PAGE, true)], ["trendingTv", () => rowOf(LISTS.trendingTv, 1, 2)], ["popularTv", () => rowOf(LISTS.popularTv, 1, 2)], ["topTv", () => rowOf(LISTS.topTv)]];
  else if (chosen === "anime") defs = Object.keys(ANIME_LISTS).map((id) => [id, () => rowOf(ANIME_LISTS[id], 1, 2)]);
  else defs = Object.keys(DORAMAS).map((id) => [id, () => rowOf(DORAMAS[id], 1, 2)]);
  const settled = await Promise.allSettled(defs.map(([, fn]) => fn()));
  const rows = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value && r.value.items.length) {
      const def = ANIME_LISTS[defs[i][0]] || DORAMAS[defs[i][0]] || LISTS[defs[i][0]];
      rows.push({ id: "row-" + rowSlug(defs[i][0]), title: r.value.title || (def && titleOfList(def)) || defs[i][0], ref: "browse:" + defs[i][0], items: r.value.items });
    }
  });
  if (!rows.length) return sectionSitio(args);
  log("section (índice)", chosen, "->", rows.length, "filas,", countItems(rows), "títulos");
  return { tabs: TABS, tab: chosen, rows };
}

export async function categories() {
  if (!catReady()) return categoriesSitio();
  try {
    const [movies, tv] = await Promise.all([tmdb("/genre/movie/list"), tmdb("/genre/tv/list")]);
    const out = [];
    const seen = new Set();
    for (const g of [...((movies && movies.genres) || []), ...((tv && tv.genres) || [])]) {
      if (!g || !g.id || seen.has(g.name)) continue;
      seen.add(g.name);
      out.push({ id: "g" + g.id, title: String(g.name).slice(0, 40), ref: "browse:genre:" + g.id });
    }
    if (out.length) return out.slice(0, 24);
  } catch (e) {
    log("categories:", (e && e.code) || "error");
  }
  return categoriesSitio();
}

export async function browse(ref, cursor) {
  const raw = String(ref || "");
  if (!catReady() || !/^browse:/.test(raw)) return browseSitio(ref, cursor);
  const parts = raw.split(":");
  const page = Math.max(1, parseInt(cursor || "1", 10) || 1);
  if (parts[1] === "recent") return recent(cursor, PAGE, false);
  if (parts[1] === "recentTv") return recent(cursor, PAGE, true);
  if (parts[1] === "genre" && /^\d+$/.test(parts[2] || "")) {
    return filtered("/discover/movie", { with_genres: parts[2], sort_by: "popularity.desc", "vote_count.gte": 20 }, page, false);
  }
  const def = LISTS[parts[1]] || ANIME_LISTS[parts[1]] || DORAMAS[parts[1]];
  if (!def) return browseSitio(ref, cursor);
  return filtered(def.path, typeof def.params === "function" ? def.params() : {}, page, !!def.tv);
}

export async function search(query) {
  if (!catReady()) return searchSitio(query);
  const q = String((typeof query === "string" ? query : (query && query.q) || "")).trim();
  if (!q) return [];
  try {
    const asks = [
      ...[1, 2, 3].map((page) => [false, tmdb("/search/movie", { query: q, include_adult: false, page })]),
      ...[1, 2].map((page) => [true, tmdb("/search/tv", { query: q, include_adult: false, page })]),
    ];
    const pages = await Promise.allSettled(asks.map(([, p]) => p));
    const cand = [];
    pages.forEach((r, i) => {
      if (r.status !== "fulfilled") return;
      const tv = asks[i][0];
      for (const m of r.value.results || []) if (m.poster_path) cand.push({ m, tv, id: (tv ? "s:" : "m:") + m.id });
    });
    const present = await catHas(cand.map((c) => c.id));
    const items = [];
    const seen = new Set();
    for (const c of cand) {
      if (!present.has(c.id) || seen.has(c.id)) continue;
      seen.add(c.id);
      items.push(card(slim(c.m, c.tv)));
    }
    if (items.length) return items;
    if (pages.every((p) => p.status === "rejected")) return searchSitio(query);
    return [];
  } catch (e) {
    log("search (índice) falló:", (e && e.code) || "error");
    return searchSitio(query);
  }
}

const parseMovieRef = (ref) => (/^m:(\d+)$/.exec(String(ref || "")) || [])[1] || null;
const parseShowRef = (ref) => (/^s:(\d+)$/.exec(String(ref || "")) || [])[1] || null;

export async function details(ref) {
  const sid = parseShowRef(ref);
  if (sid && catReady()) {
    try {
      const d = await tmdb("/tv/" + sid, { append_to_response: "external_ids" });
      const imdb = d.external_ids && d.external_ids.imdb_id;
      return {
        title: d.name,
        poster: img("w500", d.poster_path),
        backdrop: img("w1280", d.backdrop_path),
        overview: d.overview || undefined,
        genres: (d.genres || []).map((g) => g.name).slice(0, 5),
        year: yearOf(d.first_air_date),
        rating: d.vote_average ? Math.round(d.vote_average * 10) / 10 : undefined,
        ids: { tmdb: d.id, ...(/^tt\d{5,10}$/.test(imdb || "") ? { imdb } : {}) },
      };
    } catch (e) {
      log("details (serie):", (e && e.code) || "error");
    }
  }
  const mid = parseMovieRef(ref);
  if (mid && catReady()) {
    try {
      const d = await tmdb("/movie/" + mid);
      const imdb = d.imdb_id;
      return {
        title: d.title,
        poster: img("w500", d.poster_path),
        backdrop: img("w1280", d.backdrop_path),
        overview: d.overview || undefined,
        genres: (d.genres || []).map((g) => g.name).slice(0, 5),
        year: yearOf(d.release_date),
        rating: d.vote_average ? Math.round(d.vote_average * 10) / 10 : undefined,
        runtimeMinutes: d.runtime > 0 ? d.runtime : undefined,
        ids: { tmdb: d.id, ...(/^tt\d{5,10}$/.test(imdb || "") ? { imdb } : {}) },
      };
    } catch (e) {
      log("details (película):", (e && e.code) || "error");
    }
  }
  return detailsSitio(ref);
}

/** Los capítulos de una serie: los de TMDB (nombres, fotos, sinopsis). Se reproducen con la sesión. */
export async function episodes(ref) {
  const sid = parseShowRef(ref);
  if (!sid || !catReady()) return episodesSitio(ref);
  let show = null;
  try {
    show = await tmdb("/tv/" + sid);
  } catch (e) {
    log("episodes:", (e && e.code) || "error");
    return episodesSitio(ref);
  }
  const seasons = ((show && show.seasons) || []).map((s) => s.season_number).filter((n) => n > 0).sort((a, b) => a - b);
  const info = new Map();
  try {
    const groups = [];
    for (let i = 0; i < seasons.length; i += 20) groups.push(seasons.slice(i, i + 20));
    const blocks = await Promise.allSettled(
      groups.map((g, i) => tmdb("/tv/" + sid, { append_to_response: g.map((s) => "season/" + s).join(",") })),
    );
    for (const r of blocks) {
      if (r.status !== "fulfilled") continue;
      for (const s of seasons) {
        const sd = r.value["season/" + s];
        for (const ep of (sd && sd.episodes) || []) info.set(s + "." + ep.episode_number, ep);
      }
    }
  } catch { /* sin fotos ni nombres: los capítulos siguen numerados */ }

  const out = [];
  for (const s of seasons) {
    const sd = (show.seasons || []).find((x) => x.season_number === s);
    const count = (sd && sd.episode_count) || 0;
    for (let e = 1; e <= count; e++) {
      const ep = info.get(s + "." + e);
      out.push({
        season: s,
        number: e,
        ref: "e:" + sid + ":" + s + ":" + e,
        title: (ep && ep.name) || "Episodio " + e,
        still: ep ? img("w300", ep.still_path) : undefined,
        overview: (ep && ep.overview) || undefined,
        airDate: ep && /^\d{4}-\d{2}-\d{2}$/.test(ep.air_date || "") ? ep.air_date : undefined,
        runtimeMinutes: ep && ep.runtime > 0 && ep.runtime <= 1000 ? ep.runtime : undefined,
      });
    }
  }
  if (!out.length) return episodesSitio(ref);
  const imdb = show.external_ids && show.external_ids.imdb_id;
  return {
    series: {
      title: show.name,
      poster: img("w500", show.poster_path),
      backdrop: img("w1280", show.backdrop_path),
      overview: show.overview || undefined,
      genres: (show.genres || []).map((g) => g.name).slice(0, 5),
      year: yearOf(show.first_air_date),
      rating: show.vote_average ? Math.round(show.vote_average * 10) / 10 : undefined,
      ids: { tmdb: show.id, ...(/^tt\d{5,10}$/.test(imdb || "") ? { imdb } : {}) },
    },
    episodes: out,
  };
}

// ================================================================ estado del índice

function agoShort(at) {
  const minutes = Math.max(0, Math.round((Date.now() - Number(at || 0)) / 60000));
  if (!Number(at)) return "";
  if (minutes < 60) return "hace " + Math.max(1, minutes) + " min";
  const hours = Math.round(minutes / 60);
  return hours < 48 ? "hace " + hours + " h" : "hace " + Math.round(hours / 24) + " días";
}

/** Una línea con el estado del índice para Ajustes y para la tarjeta de la pantalla. */
function indexInfo() {
  const version = sGet(CK.ver);
  if (indexing()) {
    const snap = indexSnapshot();
    return {
      ready: false,
      indexing: true,
      text: "Importando catálogo… " + snap.indexPart + " / " + (snap.indexShards || "?"),
      textEn: "Importing the catalog… " + snap.indexPart + " / " + (snap.indexShards || "?"),
    };
  }
  if (!version) {
    return { ready: false, indexing: false, text: "Catálogo sin descargar", textEn: "Catalog not downloaded" };
  }
  const movies = catRecentIds("movies").length;
  const series = catRecentIds("series").length;
  const when = agoShort(Number(sGet(CK.at)));
  return {
    ready: true,
    indexing: false,
    version,
    text: movies + " películas y " + series + " series" + (when ? " · " + when : ""),
    textEn: movies + " movies and " + series + " series" + (when ? " · " + when : ""),
  };
}

/** La tarjeta del índice en Ajustes, con su botón. */
function indexCard() {
  const info = indexInfo();
  const children = [
    { type: "Row", key: "ind-t", gap: 8, crossAxisAlignment: "center", children: [
      { type: "Icon", key: "ind-i", name: "sync", size: 20, color: "primary" },
      { type: "Text", key: "ind-l", text: "Índice de películas", textEn: "Movie index", style: "h4", flex: 1 },
    ] },
    { type: "Text", key: "ind-s", color: "muted", text: info.text, textEn: info.textEn },
    { type: "Text", key: "ind-n", color: "muted", style: "caption",
      text: "Con el índice, las películas se ven sin cuenta. Las series usan tu sesión del sitio.",
      textEn: "With the index, movies play without an account. Series use your site session." },
  ];
  if (info.indexing) {
    children.push({ type: "LinearProgressIndicator", key: "ind-p", value: info.indexing ? Math.min(1, (indexSnapshot().indexPart || 0) / Math.max(1, indexSnapshot().indexShards)) : 0 });
  } else {
    children.push({
      type: "TextButton", key: "ind-b", icon: "download",
      labelText: info.ready ? "Actualizar catálogo" : "Descargar catálogo",
      labelTextEn: info.ready ? "Refresh catalog" : "Download catalog",
      onPressed: "index",
    });
  }
  return { type: "Card", key: "ind-card", margin: borde, padding: 16, gap: 12, children };
}

/** La vista de la importación: barra, avance y un tick que baja el siguiente trozo. */
function indexView(state, device) {
  const snap = Object.assign(indexSnapshot(), state || {});
  const children = [
    { type: "Text", key: "indv-t", text: "Catálogo de UltraPelisHD", textEn: "UltraPelisHD catalog", style: "h1" },
    { type: "Text", key: "indv-p", color: "muted",
      text: "Una sola descarga: de ahí en adelante se actualiza sola por deltas, sin reinstalar el plugin.",
      textEn: "Downloaded once; from then on it refreshes itself in the background." },
  ];
  if (snap.indexing) {
    children.push({
      type: "LinearProgressIndicator", key: "indv-bar",
      value: Math.min(1, (snap.indexPart || 0) / Math.max(1, snap.indexShards || 1)),
      labelText: "Importando… " + (snap.indexPart || 0) + " / " + (snap.indexShards || "?"),
      labelTextEn: "Importing… " + (snap.indexPart || 0) + " / " + (snap.indexShards || "?"),
    });
    if (snap.indexTotal) {
      children.push({ type: "Text", key: "indv-c", color: "muted", text: snap.indexSeen + " de " + snap.indexTotal + " títulos", textEn: snap.indexSeen + " of " + snap.indexTotal + " titles" });
    }
  } else {
    children.push({ type: "ElevatedButton", key: "indv-b", labelText: "Descargar catálogo", labelTextEn: "Download catalog", onPressed: "index" });
  }
  const tree = {
    type: "Scaffold",
    key: "index-view",
    appBar: appBar("inicio", device, []),
    body: { type: "Column", key: "indv-body", mainAxisAlignment: "center", crossAxisAlignment: "center", padding: 24, gap: 12, children },
  };
  return snap.indexing ? { ...tree, every: { ms: 1500, event: "indexTick" } } : tree;
}
