import { preserveTaskAllowances, validTaskAllowances } from "../src/lib/taskAllowance";
import { isIntentDocument } from "../src/lib/intent";
// Local-first dashboard assets and account-scoped D1 sync.
import { resetHTML } from "./reset-page";
import { hashPassword, verifyPassword, hex, ITERATIONS } from "./password.mjs";

export interface D1Result<T> { results: T[] }
export interface D1Stmt { bind(...v: unknown[]): D1Stmt; all<T>(): Promise<D1Result<T>>; run(): Promise<unknown> }
export interface D1 { prepare(sql: string): D1Stmt; batch(stmts: D1Stmt[]): Promise<D1Result<unknown>[]> }
export interface Env {
  DB: D1;
  ASSETS: { fetch(req: Request): Promise<Response> };
  TEAM_DOMAIN: string;
  POLICY_AUD: string;
  ALLOWED_EMAILS: string;
}
const SYNC_KEYS = new Set(["settings", "tasks", "focusPick", "stats", "notes", "mixer", "radio", "parked", "intent"]);
const MAX_VALUE_BYTES = 1_900_000; // Below D1's 2 MB row limit.
export const MAX_SYNC_BYTES = 2 * 1024 * 1024;
export const BODY_DEADLINE_MS = 10_000;
export const SESSION_MS = 60 * 86400_000;
const WINDOW_MS = 15 * 60_000;
const cookie = (token: string, age = SESSION_MS / 1000) => `cp_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=${age}`;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
const allowed = (email: string, env: Env) => (env.ALLOWED_EMAILS ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean).includes(email);
const digest = async (value: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
async function first<T>(env: Env, sql: string, ...args: unknown[]): Promise<T | undefined> {
  return (await env.DB.prepare(sql).bind(...args).all<T>()).results[0];
}
class BodyError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
// Never wait for a producer's cancel promise: an uncooperative stream must not
// delay either the size rejection or the absolute body-ingestion deadline.
async function readBody(req: Request, limit: number): Promise<string> {
  const cancel = () => { void req.body?.cancel().catch(() => undefined); };
  const length = req.headers.get("Content-Length");
  if (length !== null && Number(length) > limit) {
    cancel();
    throw new BodyError(413, "Too large.");
  }
  const reader = req.body?.getReader();
  if (!reader) return "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { reject(new BodyError(408, "Body read timed out.")); abort(); }, BODY_DEADLINE_MS);
    });
    const read = async () => {
      // Coalesce into a bounded byte buffer, so tiny attacker-controlled chunks
      // cannot create millions of retained strings/array slots within the cap.
      let bytes = new Uint8Array(Math.min(limit, 8192)), size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const nextSize = size + value.byteLength;
        if (nextSize > limit) { abort(); throw new BodyError(413, "Too large."); }
        if (nextSize > bytes.length) {
          const grown = new Uint8Array(Math.min(limit, Math.max(nextSize, bytes.length * 2)));
          grown.set(bytes.subarray(0, size)); bytes = grown;
        }
        bytes.set(value, size); size = nextSize;
      }
      return new TextDecoder().decode(bytes.subarray(0, size));
    };
    return await Promise.race([read(), deadline]);
  } finally { clearTimeout(timer); reader.releaseLock(); }
}
async function smallJSON(req: Request): Promise<Record<string, unknown>> {
  const body: unknown = JSON.parse(await readBody(req, 8192));
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("body");
  return body as Record<string, unknown>;
}

// ---------- Access JWT verification (RS256, JWKS cached per isolate) ----------
let jwks: { at: number; keys: Map<string, CryptoKey> } | null = null;

function b64url(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
}

async function keysFor(team: string): Promise<Map<string, CryptoKey>> {
  if (jwks && Date.now() - jwks.at < 10 * 60_000) return jwks.keys;
  const r = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error("certs");
  const body = (await r.json()) as { keys: (JsonWebKey & { kid: string })[] };
  const keys = new Map<string, CryptoKey>();
  for (const k of body.keys) {
    keys.set(k.kid, await crypto.subtle.importKey("jwk", k, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
  }
  jwks = { at: Date.now(), keys };
  return keys;
}

async function verifiedEmail(req: Request, env: Env): Promise<string | null> {
  const token = req.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64url(parts[0]))) as { alg: string; kid: string };
    const payload = JSON.parse(new TextDecoder().decode(b64url(parts[1]))) as { aud: string | string[]; exp: number; nbf?: number; iss: string; email?: string };
    if (header.alg !== "RS256") return null;
    const key = (await keysFor(env.TEAM_DOMAIN)).get(header.kid);
    if (!key) return null;
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    const now = Math.floor(Date.now() / 1000);
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!ok || !Number.isFinite(payload.exp) || !aud.includes(env.POLICY_AUD) || payload.exp <= now || (payload.nbf && payload.nbf > now + 60)) return null;
    if (payload.iss !== `https://${env.TEAM_DOMAIN}`) return null;
    return typeof payload.email === "string" ? payload.email.toLowerCase() : null;
  } catch {
    return null;
  }
}


// Reserve a slot before hashing, atomically across both keys. Successful logins
// release their slots; failures remain. Concurrent requests cannot bypass the cap.
export async function reserveLogin(env: Env, email: string, ip: string, now = Date.now()) {
  const keys = ["email:" + await digest(email), "ip:" + await digest(ip)];
  const gate = `SELECT 1 FROM login_attempts WHERE key IN (?, ?) AND count >= 5 AND window_start > ?`;
  // Hot blocked path: primary-key probes only, no mutation or expiry scan.
  const blocked = await env.DB.prepare("SELECT window_start FROM login_attempts WHERE key IN (?, ?) AND count >= 5 AND window_start > ?")
    .bind(...keys, now - WINDOW_MS).all<{ window_start: number }>();
  const retry = (rows: { window_start: number }[]) => Math.max(1, ...rows.map(row => Math.ceil((row.window_start + WINDOW_MS - now) / 1000)));
  if (blocked.results.length) return { keys, retry: retry(blocked.results) };
  const result = await env.DB.batch([
    ...keys.map(key => env.DB.prepare(`INSERT INTO login_attempts (key, count, window_start) SELECT ?, 0, ? WHERE NOT EXISTS (${gate})
      ON CONFLICT(key) DO UPDATE SET count = 0, window_start = excluded.window_start WHERE login_attempts.window_start <= ?`).bind(key, now, ...keys, now - WINDOW_MS, now - WINDOW_MS)),
    env.DB.prepare(`UPDATE login_attempts SET count = count + 1 WHERE key IN (?, ?) AND NOT EXISTS (${gate}) RETURNING key`).bind(...keys, ...keys, now - WINDOW_MS),
  ]);
  if (result[2].results.length !== 2) {
    const rows = (await env.DB.prepare("SELECT window_start FROM login_attempts WHERE key IN (?, ?) AND count >= 5").bind(...keys).all<{ window_start: number }>()).results;
    return { keys, retry: retry(rows) };
  }
  return { keys, retry: 0 };
}
export async function sessionFor(req: Request, env: Env, now = Date.now(), renew = true) {
  const bearer = req.headers.get("Authorization")?.match(/^Bearer ([a-f0-9]{64})$/i)?.[1];
  const token = bearer ?? req.headers.get("Cookie")?.match(/(?:^|;\s*)cp_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (!token) return null;
  const token_hash = await digest(token);
  const row = await first<{ email: string }>(env, "SELECT email FROM sessions WHERE token_hash = ? AND expires_at > ?", token_hash, now);
  if (!row || !allowed(row.email, env)) return null;
  if (renew) await env.DB.prepare("UPDATE sessions SET expires_at = ?, last_seen = ? WHERE token_hash = ? AND expires_at > ?").bind(now + SESSION_MS, now, token_hash, now).run();
  return { email: row.email, token, token_hash };
}
async function login(req: Request, env: Env) {
  let body;
  try { body = await smallJSON(req); } catch (error) { if (error instanceof BodyError) throw error; return json({ ok: false, error: "Enter your email and password." }, 400); }
  if (typeof body.email !== "string" || body.email.length > 254 || typeof body.password !== "string" || body.password.length > 1024) return json({ ok: false, error: "Enter your email and password." }, 400);
  const email = body.email.trim().toLowerCase();
  const slot = await reserveLogin(env, email, req.headers.get("CF-Connecting-IP") ?? "unknown");
  if (slot.retry) return json({ ok: false, error: "Too many sign-in attempts. Try again later." }, 429, { "Retry-After": String(slot.retry) });
  const user = await first<{ pw_hash: string; salt: string; iterations: number }>(env, "SELECT pw_hash, salt, iterations FROM users WHERE email = ?", email);
  // Unknown accounts do the same work and return the same error.
  const valid = await verifyPassword(body.password, user ?? { pw_hash: "0".repeat(64), salt: "0".repeat(32), iterations: ITERATIONS });
  if (!valid || !user || !allowed(email, env)) return json({ ok: false, error: "Email or password is incorrect." }, 401);
  const token = hex(crypto.getRandomValues(new Uint8Array(32))), now = Date.now();
  const result = await env.DB.batch([
    env.DB.prepare(`INSERT INTO sessions (token_hash, email, created_at, expires_at, last_seen, device_label)
      SELECT ?, email, ?, ?, ?, ? FROM users WHERE email = ? AND pw_hash = ? RETURNING token_hash`)
      .bind(await digest(token), now, now + SESSION_MS, now, req.headers.get("X-Client") === "desktop" ? "Mac app" : "Web", email, user.pw_hash),
    ...slot.keys.map(key => env.DB.prepare("UPDATE login_attempts SET count = MAX(0, count - 1) WHERE key = ?").bind(key)),
  ]);
  if (!result[0].results.length) return json({ ok: false, error: "Email or password is incorrect." }, 401);
  // Only successful logins do maintenance. Both subqueries use expiry indexes;
  // the PK deletes touch at most 50 rows each, regardless of table size.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE expires_at <= ? ORDER BY expires_at LIMIT 50)").bind(now),
    env.DB.prepare("DELETE FROM login_attempts WHERE key IN (SELECT key FROM login_attempts WHERE window_start <= ? ORDER BY window_start LIMIT 50)").bind(now - WINDOW_MS),
  ]);
  return req.headers.get("X-Client") === "desktop" ? json({ ok: true, email, token }) : json({ ok: true, email }, 200, { "Set-Cookie": cookie(token) });
}
async function reset(req: Request, env: Env) {
  const email = await verifiedEmail(req, env);
  if (!email) return json({ ok: false, error: "Verify your email with Cloudflare Access first." }, 401);
  if (!allowed(email, env)) return json({ ok: false }, 403);
  const path = new URL(req.url).pathname;
  if (path === "/account/reset") return new Response(null, { status: 308, headers: { Location: "/account/reset/", "Cache-Control": "no-store" } });
  if (path !== "/account/reset/") return json({ ok: false }, 404);
  if (req.method === "GET") {
    // Worker-owned HTML has no public asset alias and no internal asset fetch
    // that could follow an HTML canonicalization redirect outside Access.
    return new Response(resetHTML, { headers: {
      "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    } });
  }
  if (req.method !== "POST") return json({ ok: false }, 405);
  if (req.headers.get("X-Custom-Pomodoro") !== "1") return json({ ok: false }, 403);
  let body;
  try { body = await smallJSON(req); } catch (error) { if (error instanceof BodyError) throw error; return json({ ok: false, error: "Enter and confirm your new password." }, 400); }
  if (typeof body.password !== "string" || body.password.length < 12 || body.password.length > 1024 || body.confirm !== body.password) return json({ ok: false, error: "Use 12–1024 characters and make both passwords match." }, 400);
  const row = await hashPassword(body.password);
  await env.DB.batch([
    env.DB.prepare("INSERT OR REPLACE INTO users (email, pw_hash, salt, iterations, updated_at) VALUES (?, ?, ?, ?, ?)").bind(email, row.pw_hash, row.salt, row.iterations, Date.now()),
    env.DB.prepare("DELETE FROM sessions WHERE email = ?").bind(email),
  ]);
  return json({ ok: true });
}
async function syncPut(req: Request, env: Env): Promise<Response> {
  // Finish bounded ingestion and validation before looking up authorization.
  const raw = await readBody(req, MAX_SYNC_BYTES);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ ok: false, error: "Bad JSON." }, 400); }
  if (!body || !Array.isArray(body.entries) || body.entries.length > SYNC_KEYS.size) return json({ ok: false, error: "Invalid entries." }, 400);
  const entries: { key: string; value: string; updatedAt: number }[] = [];
  for (const e of body.entries) {
    if (!SYNC_KEYS.has(e?.key) || !Number.isSafeInteger(e.updatedAt) || e.updatedAt < 0 || e.updatedAt > Date.now() + 60_000 || e.value === undefined) return json({ ok: false, error: "Invalid entry." }, 400);
    if (e.key === "intent" && !isIntentDocument(e.value)) return json({ ok: false, error: "Invalid next action." }, 400);
    if (e.key === "tasks" && !validTaskAllowances(e.value, true)) return json({ ok: false, error: "Invalid transition allowance." }, 400);
    // Observing a parent clears its allowance even on a first legacy insert.
    const value = JSON.stringify(e.key === "tasks" && Array.isArray(e.value)
      ? preserveTaskAllowances(e.value, []) : e.value);
    if (new TextEncoder().encode(value).byteLength > MAX_VALUE_BYTES) return json({ ok: false, error: "Entry is too large to sync." }, 413);
    entries.push({ key: e.key, value, updatedAt: e.updatedAt });
  }
  const session = await sessionFor(req, env, Date.now(), false);
  if (!session) return json({ ok: false, error: "Sign in to sync." }, 401);
  const now = Date.now();
  const live = "SELECT 1 FROM sessions WHERE token_hash = ? AND email = ? AND expires_at > ?";
  const args = [session.token_hash, session.email, now];
  // D1 batch is one transaction. A reset/logout ordered first removes the row:
  // every write is then a no-op, including an upsert of an existing kv value.
  const result = await env.DB.batch([
    env.DB.prepare("SELECT email FROM sessions WHERE token_hash = ? AND email = ? AND expires_at > ?").bind(...args),
    ...entries.map(e => env.DB.prepare(`INSERT INTO kv (email, key, value, updated_at)
      SELECT ?, ?, ?, ? WHERE EXISTS (${live})
      ON CONFLICT(email, key) DO UPDATE SET value = CASE
        -- Sort old/new rows once by id. Repeated JSON document lookups are quadratic.
        WHEN excluded.key = 'tasks' AND json_type(excluded.value) = 'array'
          AND NOT EXISTS (SELECT 1 FROM json_each(excluded.value) WHERE type != 'object') THEN (
          WITH incoming AS MATERIALIZED (
            SELECT CAST(key AS INTEGER) ord, value, json_extract(value, '$.id') id, json_extract(value, '$.parentId') parentId,
              json_type(value, '$.transitionAllowanceMin') kind, json_extract(value, '$.transitionAllowanceMin') allowance FROM json_each(excluded.value)),
          entries AS (
            SELECT 0 source, CAST(key AS INTEGER) ord, value, json_extract(value, '$.id') id,
              json_type(value, '$.transitionAllowanceMin') kind, json_extract(value, '$.transitionAllowanceMin') allowance
            FROM json_each(CASE WHEN json_type(kv.value) = 'array' THEN kv.value ELSE '[]' END) WHERE type = 'object'
            UNION ALL SELECT 1, ord, value, id, kind, allowance FROM incoming
            UNION ALL SELECT 2, ord, NULL, parentId, NULL, NULL FROM incoming WHERE parentId IS NOT NULL),
          merged AS (
            SELECT *, first_value(source) OVER task savedSource, first_value(kind) OVER task savedKind,
              first_value(allowance) OVER task savedAllowance, max(source = 2) OVER (PARTITION BY id) isParent
            FROM entries WINDOW task AS (PARTITION BY id ORDER BY source, ord DESC ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING))
          SELECT json_group_array(json(CASE
            WHEN isParent THEN json_set(value, '$.transitionAllowanceMin', NULL)
            WHEN savedSource = 0 AND (kind IS NULL OR ? = 0) AND
              (savedKind = 'null' OR savedKind = 'integer' AND savedAllowance BETWEEN 0 AND 240)
            THEN json_set(value, '$.transitionAllowanceMin', savedAllowance) ELSE value END))
          FROM (SELECT * FROM merged WHERE source = 1 ORDER BY ord))
        WHEN excluded.key = 'intent'
          AND json_extract(excluded.value, '$.action') = json_extract(kv.value, '$.action')
          AND json_type(excluded.value, '$.sufficientFinish') IS NULL
          AND json_type(kv.value, '$.sufficientFinish') = 'text'
        THEN json_set(excluded.value, '$.sufficientFinish', json_extract(kv.value, '$.sufficientFinish'))
        ELSE excluded.value END, updated_at = excluded.updated_at WHERE excluded.updated_at > kv.updated_at`)
      .bind(session.email, e.key, e.value, e.updatedAt, ...args, body.taskAllowanceVersion === 1 ? 1 : 0)),
    env.DB.prepare("UPDATE sessions SET expires_at = ?, last_seen = ? WHERE token_hash = ? AND email = ? AND expires_at > ?").bind(now + SESSION_MS, now, ...args),
  ]);
  if (!result[0].results.length) return json({ ok: false, error: "Sign in to sync." }, 401);
  return json({ ok: true, saved: entries.length }, 200, req.headers.has("Authorization") ? {} : { "Set-Cookie": cookie(session.token) });
}
async function api(req: Request, env: Env, path: string): Promise<Response> {
  if (req.method !== "GET" && req.headers.get("X-Custom-Pomodoro") !== "1") return json({ ok: false }, 403);
  if (path === "/api/auth/login" && req.method === "POST") return login(req, env);
  if (!["/api/me", "/api/sync", "/api/auth/logout"].includes(path)) return json({ ok: false }, 404);
  if (path === "/api/sync" && req.method === "PUT") return syncPut(req, env);
  const session = await sessionFor(req, env);
  if (!session) return json({ ok: false, error: "Sign in to sync." }, 401);
  let response: Response;
  const email = session.email;
  if (path === "/api/auth/logout" && req.method === "POST") {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(session.token_hash).run();
    return json({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
  }
  if (path === "/api/me" && req.method === "GET") response = json({ ok: true, email });
  else if (path === "/api/sync" && req.method === "GET") {
    const { results } = await env.DB.prepare("SELECT key, value, updated_at FROM kv WHERE email = ?").bind(email).all<{ key: string; value: string; updated_at: number }>();
    response = json({ ok: true, entries: results.map(r => ({ key: r.key, value: JSON.parse(r.value), updatedAt: r.updated_at })) });
  } else response = json({ ok: false }, 405);
  if (!req.headers.has("Authorization")) response.headers.set("Set-Cookie", cookie(session.token));
  return response;
}
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const path = new URL(req.url).pathname;
    try {
      if (path === "/reset" || path === "/reset.html" || path.startsWith("/reset/")) return json({ ok: false }, 404);
      if (path.startsWith("/api/")) return await api(req, env, path);
      if (path === "/account/reset" || path.startsWith("/account/reset/")) return await reset(req, env);
      return env.ASSETS.fetch(req);
    } catch (error) {
      if (error instanceof BodyError) return json({ ok: false, error: error.message }, error.status);
      return json({ ok: false, error: "Something went wrong. Try again." }, 500);
    }
  },
};
