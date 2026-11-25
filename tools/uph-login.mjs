#!/usr/bin/env node
//
// Inicia sesión en UltraPelisHD desde la terminal y guarda SOLO las cookies de la sesión.
//
//   node tools/uph-login.mjs              pide correo y contraseña (la contraseña no se muestra)
//   node tools/uph-login.mjs probe        comprueba la sesión guardada contra la puerta de un título
//   node tools/uph-login.mjs probe 57     idem contra el título interno 57
//
// La contraseña se teclea en la terminal, no se escribe en ningún archivo ni se imprime. Lo único
// que queda en disco es `.uph-session.json` (cookies + User-Agent, modo 600), que está en
// .gitignore y solo sirve para que `tools/uph-index.mjs` pueda leer la puerta de fuentes.
//
// El archivo se puede borrar en cualquier momento; la sesión del sitio caduca sola.

import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const SESSION = join(REPO, ".uph-session.json");
const SAMPLE = join(REPO, ".uph-gate-sample.json");
const BASE = "https://ultrapelishd.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ---------------------------------------------------------------- cookies

const jar = new Map();
function cookieHeader() {
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}
function eatCookies(res) {
  const lines = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  for (const line of lines) {
    const pair = String(line).split(";")[0];
    const i = pair.indexOf("=");
    if (i <= 0) continue;
    const name = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    if (!name) continue;
    // Una cookie vacía con Max-Age=0 es un borrado: se respeta.
    if (/max-age=0/i.test(String(line))) jar.delete(name);
    else jar.set(name, value);
  }
}

function loadSession() {
  if (!existsSync(SESSION)) return null;
  try {
    const o = JSON.parse(readFileSync(SESSION, "utf8"));
    if (!o || !o.cookies || !Object.keys(o.cookies).length) return null;
    for (const [k, v] of Object.entries(o.cookies)) jar.set(k, v);
    return o;
  } catch {
    return null;
  }
}

function saveSession() {
  const out = { at: new Date().toISOString(), ua: UA, cookies: Object.fromEntries(jar) };
  writeFileSync(SESSION, JSON.stringify(out, null, 2) + "\n", { mode: 0o600 });
  chmodSync(SESSION, 0o600);
}

// ---------------------------------------------------------------- http

/** Una petición con la jarra de cookies y las redirecciones seguidas a mano (cada salto deja cookies). */
async function http(method, url, { headers = {}, body = null, hops = 8 } = {}) {
  let target = url;
  let verb = method;
  let payload = body;
  for (let n = 0; n < hops; n++) {
    const all = Object.assign({ "User-Agent": UA, Accept: "text/html,application/json;q=0.9,*/*;q=0.8", "Accept-Language": "es-MX,es;q=0.9" }, headers);
    const cookies = cookieHeader();
    if (cookies) all.Cookie = cookies;
    const res = await fetch(target, { method: verb, headers: all, body: payload, redirect: "manual" });
    eatCookies(res);
    const status = res.status;
    if ([301, 302, 303, 307, 308].includes(status)) {
      const next = res.headers.get("location");
      if (!next) return { status, url: target, body: await res.text(), res };
      target = new URL(next, target).href;
      if (status !== 307 && status !== 308) {
        verb = "GET";
        payload = null;
      }
      continue;
    }
    return { status, url: target, body: await res.text(), res };
  }
  throw new Error("demasiadas redirecciones");
}

// ---------------------------------------------------------------- terminal

function ask(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    let value = "";
    const onData = (chunk) => {
      value += chunk.toString("utf8");
      if (value.includes("\n") || value.includes("\r")) {
        process.stdin.off("data", onData);
        process.stdin.pause();
        resolve(value.split(/[\r\n]/)[0]);
      }
    };
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
    process.stdin.resume();
  });
}

/** Igual que ask(), pero sin devolver los caracteres a la pantalla (contraseña). */
function askHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(!!wasRaw);
      stdin.pause();
    };
    const onData = (chunk) => {
      for (const ch of String(chunk)) {
        if (ch === "\r" || ch === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          cleanup();
          process.stdout.write("\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (ch >= " ") value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

// ---------------------------------------------------------------- páginas del sitio

function moviePaths(html) {
  const out = [];
  const re = /href="(\/movie\/[^"#?]+)"/g;
  let m;
  while ((m = re.exec(String(html || "")))) {
    const p = m[1].replace(/^\//, "");
    if (!out.includes(p)) out.push(p);
    if (out.length >= 12) break;
  }
  return out;
}

function gateOf(html) {
  const m = /data-uph-watch="([^"]+)"/.exec(String(html || ""));
  return m ? m[1].replace(/&amp;/g, "&") : "";
}

/** El idioma de cada `data-embed` según el panel de servidores en el que aparece. */
const LANG_LETTER = { latino: "L", castellano: "E", subtitulado: "S", ingles: "I", inglés: "I", original: "O" };
function langMap(html) {
  const map = {};
  const text = String(html || "");
  const re = /<details[^>]*class="dd dd-s"[^>]*id="lp-([a-z]+)"[^>]*>([\s\S]*?)<\/details>/gi;
  let m;
  while ((m = re.exec(text))) {
    const letter = LANG_LETTER[m[1]] || "";
    const inner = m[2];
    const b = /data-embed="([^"]+)"/g;
    let k;
    while ((k = b.exec(inner))) if (letter) map[k[1]] = letter;
  }
  return map;
}

function iframeSrc(html) {
  const raw = String(html || "");
  const tag = (/<iframe[^>]*>/i.exec(raw) || [raw])[0];
  const m = /src=["']([^"']+)/i.exec(tag);
  return m ? m[1].replace(/&amp;/g, "&") : "";
}

// ---------------------------------------------------------------- login

async function login() {
  console.log("UltraPelisHD · inicio de sesión\n");
  const page = await http("GET", BASE + "/account/login");
  const token = /name="_token" value="([^"]+)"/.exec(page.body);
  if (page.status !== 200 || !token) {
    console.error("No se pudo abrir la página de acceso (HTTP " + page.status + ").");
    process.exit(1);
  }
  const email = (await ask("Correo: ")).trim();
  if (!email) {
    console.error("Falta el correo.");
    process.exit(1);
  }
  const password = await askHidden("Contraseña (no se muestra): ");
  if (!password) {
    console.error("Falta la contraseña.");
    process.exit(1);
  }
  console.log("\nEntrando…");
  const body = new URLSearchParams({ _token: token[1], email, password }).toString();
  const res = await http("POST", BASE + "/account/login", {
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: BASE, Referer: BASE + "/account/login" },
    body,
  });
  password.length = 0;

  const failed = /name="_token"[^>]*value="[^"]+"[\s\S]{0,400}name="password"/.test(res.body) && /mm-f/.test(res.body);
  saveSession();
  console.log("Cookies guardadas en " + SESSION.replace(REPO + "/", "") + " (modo 600).");
  if (failed) {
    console.error("El sitio volvió a mostrar el formulario: el correo o la contraseña no son válidos.");
    process.exit(2);
  }

  const ok = await probe();
  if (!ok) {
    console.error("La sesión se guardó, pero la puerta del reproductor no la aceptó. Revisa la cuenta o vuelve a intentarlo.");
    process.exit(3);
  }
}

// ---------------------------------------------------------------- sonda de la puerta

async function probe(arg) {
  if (!loadSession()) {
    console.error("No hay sesión guardada. Ejecuta primero: node tools/uph-login.mjs");
    process.exit(1);
  }
  let gate = "";
  let where = "";
  if (arg && /^\d+$/.test(arg)) {
    gate = BASE + "/api/uph-member-watch/movie/" + arg;
    where = "movie " + arg;
  } else {
    let path = arg || "";
    if (!path) {
      const list = await http("GET", BASE + "/movies");
      path = moviePaths(list.body)[0] || "";
      if (!path) {
        console.error("No se encontró ninguna película en /movies.");
        process.exit(1);
      }
    }
    const page = await http("GET", BASE + "/" + path.replace(/^\//, ""));
    gate = gateOf(page.body);
    where = path;
    if (!gate) {
      console.error("La ficha " + path + " no trae puerta de reproducción.");
      process.exit(1);
    }
  }
  const url = /^https?:\/\//.test(gate) ? gate : BASE + gate;
  const r = await http("GET", url, { headers: { Accept: "application/json", Referer: BASE + "/" } });
  console.log("\nPuerta " + where + ": HTTP " + r.status);
  if (r.status === 401 || r.status === 403) {
    console.log("Sin sesión válida (login_required / pass_required).");
    return false;
  }
  let data = null;
  try {
    data = JSON.parse(r.body);
  } catch {
    console.log("La respuesta no es JSON: " + r.body.slice(0, 120));
    return false;
  }
  const sources = (data && data.sources) || {};
  const keys = Object.keys(sources);
  console.log("ok=" + !!(data && data.ok) + " · " + keys.length + " fuentes");
  for (const key of keys) {
    const s = sources[key] || {};
    const src = iframeSrc(s.html);
    let host = "";
    try {
      host = new URL(src).host;
    } catch {
      host = String(s.host || "");
    }
    console.log("  " + key.padEnd(26) + " → " + (host || "?").padEnd(34) + " " + src.slice(0, 110));
  }
  writeFileSync(SAMPLE, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  console.log("\nMuestra completa en " + SAMPLE.replace(REPO + "/", "") + " (ignorada por git).");
  return !!(data && data.ok);
}

// ---------------------------------------------------------------- principal

const args = process.argv.slice(2);
const main = async () => {
  if (args[0] === "probe") await probe(args[1]);
  else await login();
};
main().catch((e) => {
  console.error("Error: " + ((e && e.message) || e));
  process.exit(1);
});
