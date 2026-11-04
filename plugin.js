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
    if (!s || !s.id || !s.k || !s.video) continue;
    if (s.type && s.type !== "hls" && s.type !== "mp4") continue;
    if (seen[s.k]) continue;
    seen[s.k] = true;
    out.push({
      id: String(s.id),
      k: String(s.k),
      name: String(s.name || "Servidor"),
      lang: String(s.lang || "").toUpperCase(),
      type: s.type || "hls",
      video: String(s.video),
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

// Una copia lista para Kino: la dirección del manifiesto de ese servidor con el pass del título.
// El pass dura diez minutos, así que si la reproducción falla después Kino vuelve a resolver.
function streamFor(server, pass) {
  return {
    url: server.video + "&pass=" + encodeURIComponent(pass),
    mime: HLS,
    expiresInSeconds: 540,
  };
}

export async function resolve(ref) {
  const raw = String(ref == null ? "" : ref);
  if (raw.indexOf("|") >= 0) return resolveCopy(raw);

  const path = raw.replace(/^\/+/, "");
  if (!path) throw kino.error("not_found");
  const pageUrl = BASE + "/" + path;
  const html = await get(pageUrl);
  const play = playInfo(html);
  if (!play) {
    throw kino.error("not_found", "sin reproductor en " + path, {
      userMessage: "UltraPelisHD todavía no tiene este título disponible para ver.",
    });
  }
  const pass = await getPass(play, pageUrl);
  const servers = ordered(await listServers(play, pass, pageUrl));
  if (!servers.length) {
    throw kino.error("not_found", "sin servidores en " + path, {
      userMessage: "UltraPelisHD no tiene ningún servidor disponible para este título ahora mismo.",
    });
  }

  // La primera copia se entrega ya; las demás son copias perezosas: Kino solo las resuelve si la
  // persona cambia de servidor o si la que suena falla.
  const stream = streamFor(servers[0], pass);
  stream.label = copyLabel(servers[0]);
  const rest = servers.slice(1);
  if (rest.length) {
    stream.alternatives = rest.slice(0, 8).map((s) => ({
      label: copyLabel(s),
      ref: path + "|" + s.k,
    }));
  }
  return stream;
}

async function resolveCopy(raw) {
  const cut = raw.lastIndexOf("|");
  const path = raw.slice(0, cut).replace(/^\/+/, "");
  const key = raw.slice(cut + 1);
  if (!path || !key) throw kino.error("not_found");
  const pageUrl = BASE + "/" + path;
  const html = await get(pageUrl);
  const play = playInfo(html);
  if (!play) throw kino.error("not_found", "sin reproductor en " + path);
  const pass = await getPass(play, pageUrl);
  const servers = await listServers(play, pass, pageUrl);
  let server = null;
  for (let i = 0; i < servers.length; i++) if (servers[i].k === key) server = servers[i];
  if (!server) {
    throw kino.error("not_found", "servidor " + key, {
      userMessage: "Ese servidor ya no está en UltraPelisHD; elige otra copia en el menú Servidor.",
    });
  }
  const stream = streamFor(server, pass);
  stream.label = copyLabel(server);
  return stream;
}

// ---------------------------------------------------------------- inicio, sección, categorías

export async function home() {
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

export async function section(args) {
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

export async function categories() {
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

export async function search(query) {
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

export async function browse(ref, cursor) {
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
export async function details(ref) {
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

export async function episodes(ref) {
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
  const m = /^(.*?)\/season\/\d+\/episode\/\d+$/.exec(String(ref || ""));
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
  const path = String(ref || "").replace(/^\/+/, "");
  if (!path) return "";
  const pageUrl = BASE + "/" + path;
  const html = await get(pageUrl);
  const play = playInfo(html);
  if (!play) return "";
  const pass = await getPass(play, pageUrl);
  const servers = ordered(await listServers(play, pass, pageUrl));
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
    ultimo: (parts.join(" · ") || "Aún no hay lecturas registradas.").slice(0, 200),
  };
}

export async function action(key) {
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
