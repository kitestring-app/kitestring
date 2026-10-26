// Kitestring companion: serves the built app on 127.0.0.1 and rings native macOS alarms,
// so the end-of-session alert still fires (notification + loud sound) when Chrome is closed.
// Node built-ins only. Run by the LaunchAgent com.prax.custom-pomodoro.
//
// API (same-origin only, JSON, custom header required so other websites can't call it):
//   GET    /api/health            -> { ok, version, alarm }
//   POST   /api/alarm  { at, kind, volume, speak, alertSound }   (replaces any pending alarm)
//   DELETE /api/alarm
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import alertFiles from "../desktop/alert-files.cjs";
const { alertFile, validAlertSound } = alertFiles;

const VERSION = 1;
const PORT = Number(process.argv[2] ?? 4747);
const HOST = "127.0.0.1";
const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = await realpath(resolve(project, "dist"));
const stateDir = join(homedir(), "Library/Application Support/CustomPomodoro");
const stateFile = join(stateDir, "alarm.json");
mkdirSync(stateDir, { recursive: true });

const TEXT = {
  "focus-done": { title: "Focus session done", body: "Nice work. Take your break: stand up, look far away, drink water.", spoken: "Focus session done. Time for a break." },
  "break-over": { title: "Break's over", body: "Back to it. Your next focus session is ready.", spoken: "Break is over. Time to focus." },
};
const ALLOWED_ORIGINS = new Set([`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".wav": "audio/wav", ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg", ".webp": "image/webp", ".json": "application/json", ".md": "text/markdown; charset=utf-8",
};
const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------- alarm ----------
let alarm = null; // { at, kind, volume, speak, alertSound }
let timer = null;
let speechVersion = 0;
let speaking = null;
let sounding = null;
function stopSound() { cancelSpeech(); sounding?.kill(); sounding = null; }

function cancelSpeech() {
  speechVersion++;
  speaking?.kill();
  speaking = null;
}

function save() {
  try { writeFileSync(stateFile, JSON.stringify(alarm)); } catch (e) { log("save failed", e.message); }
}

function ring(a) {
  stopSound();
  const version = speechVersion;
  const { title, body } = TEXT[a.kind];
  // native notification (click opens the dashboard); no shell, fixed arguments
  execFile("/opt/homebrew/bin/terminal-notifier", ["-title", "Kitestring", "-subtitle", title, "-message", body, "-group", "custom-pomodoro", "-open", `http://localhost:${PORT}/`, "-ignoreDnD"], (err) => {
    if (err) execFile("/usr/bin/osascript", ["-e", `display notification ${JSON.stringify(body)} with title "Kitestring" subtitle ${JSON.stringify(title)}`], () => {});
  });
  const file = alertFile(a.alertSound, a.kind);
  const vol = String(Math.min(1, Math.max(0, a.volume)));
  const speak = () => {
    if (!a.speak || version !== speechVersion) return;
    const child = execFile("/usr/bin/say", [TEXT[a.kind].spoken], () => {
      if (speaking === child) speaking = null;
    });
    speaking = child;
  };
  if (!file || a.volume === 0) speak();
  else sounding = execFile("/usr/bin/afplay", ["-v", vol, join(root, "alerts", file)], () => {
    if (version !== speechVersion) return;
    sounding = null; speak();
  });
  log("rang", a.kind);
}

function schedule(a) {
  if (timer) clearTimeout(timer);
  timer = null;
  alarm = a;
  save();
  if (!a) return;
  const wait = a.at - Date.now();
  if (wait < -60_000) { alarm = null; save(); return; } // stale (Mac was asleep for a long time)
  const fire = () => {
    // setTimeout can't sleep more than ~24.8 days and drifts during system sleep: re-check against the wall clock
    const left = a.at - Date.now();
    if (left > 1000) { timer = setTimeout(fire, Math.min(left, 60_000)); return; }
    alarm = null; timer = null; save();
    ring(a);
  };
  timer = setTimeout(fire, Math.max(0, Math.min(wait, 60_000)));
}

try {
  const saved = JSON.parse(readFileSync(stateFile, "utf8"));
  if (saved && valid(saved)) schedule(saved);
} catch { /* no saved alarm */ }

function valid(a) {
  return a && typeof a === "object" && Number.isFinite(a.at) && a.at > Date.now() - 60_000 && a.at < Date.now() + 24 * 3600_000
    && (a.kind === "focus-done" || a.kind === "break-over") && Number.isFinite(a.volume) && a.volume >= 0 && a.volume <= 1
    && typeof a.speak === "boolean" && validAlertSound(a.alertSound);
}

// ---------- http ----------
const SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

function json(res, code, body) {
  res.writeHead(code, { ...SECURITY, "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 4096) throw new Error("too large");
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
  if (url.pathname.startsWith("/api/")) {
    // only our own page may call the API: Host must be local, Origin (when sent) must be ours, custom header required
    const host = req.headers.host ?? "";
    const origin = req.headers.origin;
    if (!/^(localhost|127\.0\.0\.1):\d+$/.test(host) || (origin && !ALLOWED_ORIGINS.has(origin))) return json(res, 403, { ok: false });
    if (req.method !== "GET" && req.headers["x-custom-pomodoro"] !== "1") return json(res, 403, { ok: false });
    if (url.pathname === "/api/health" && req.method === "GET") return json(res, 200, { ok: true, version: VERSION, alarm });
    if (url.pathname === "/api/alarm" && req.method === "POST") {
      try {
        const a = await readBody(req);
        if (!valid(a)) return json(res, 400, { ok: false });
        schedule({ at: a.at, kind: a.kind, volume: a.volume, speak: a.speak, alertSound: a.alertSound ?? "signature" });
        return json(res, 200, { ok: true });
      } catch {
        return json(res, 400, { ok: false });
      }
    }
    if (url.pathname === "/api/alarm" && req.method === "DELETE") {
      stopSound();
      schedule(null);
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/api/speech" && req.method === "DELETE") {
      cancelSpeech();
      return json(res, 200, { ok: true });
    }
    if (url.pathname === "/api/test" && req.method === "POST") {
      const a = await readBody(req).catch(() => null);
      const test = { at: Date.now(), kind: a?.kind, volume: a?.volume, alertSound: a?.alertSound, speak: false };
      if (!valid(test)) return json(res, 400, { ok: false });
      ring(test);
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { ok: false });
  }

  // static files from dist (SPA fallback to index.html)
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, SECURITY).end(); return; }
  let file = resolve(root, "." + decodeURIComponent(url.pathname));
  if (!file.startsWith(root + sep) && file !== root) { res.writeHead(403, SECURITY).end(); return; }
  try {
    if (!existsSync(file) || !extname(file)) file = join(root, "index.html");
    const real = await realpath(file);
    if (!real.startsWith(root + sep)) { res.writeHead(403, SECURITY).end(); return; }
    const body = await readFile(real);
    res.writeHead(200, {
      ...SECURITY,
      "Content-Type": TYPES[extname(real)] ?? "application/octet-stream",
      "Cache-Control": real.includes(`${sep}assets${sep}`) ? "public, max-age=31536000, immutable" : "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    res.writeHead(404, SECURITY).end();
  }
});

server.listen(PORT, HOST, () => log(`companion on http://${HOST}:${PORT} serving ${root}`));
