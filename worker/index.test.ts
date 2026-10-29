import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import worker, { reserveLogin, SESSION_MS, MAX_SYNC_BYTES, BODY_DEADLINE_MS, sessionFor, type Env, type D1Stmt, type D1Result } from './index';
import { heavyStats } from './fixtures/heavy-stats.mjs';
import { hashPassword, verifyPassword, constantEqual, ITERATIONS } from './password.mjs';

const email = 'test@example.invalid';
let db: DatabaseSync, env: Env, secret: string;
function statement(sql: string, args: unknown[] = []): D1Stmt {
  return {
    bind: (...next) => statement(sql, next),
    all: async <T>() => ({ results: db.prepare(sql).all(...args as never[]) as T[] }),
    run: async () => db.prepare(sql).run(...args as never[]),
  };
}
beforeEach(async () => {
  db = new DatabaseSync(':memory:');
  for (const file of readdirSync('deploy/migrations').filter(f => f.endsWith('.sql')).sort()) db.exec(readFileSync('deploy/migrations/' + file, 'utf8'));
  env = { ALLOWED_EMAILS: email, TEAM_DOMAIN: 'test.cloudflareaccess.com', POLICY_AUD: 'test-aud',
    ASSETS: { fetch: async () => new Response('<form>reset</form>') },
    DB: { prepare: statement, batch: async stmts => {
      db.exec('BEGIN');
      try { const rows: D1Result<unknown>[] = []; for (const stmt of stmts) rows.push(await stmt.all()); db.exec('COMMIT'); return rows; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    } },
  };
  secret = crypto.randomUUID();
  const hash = await hashPassword(secret);
  db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?)').run(email, hash.pw_hash, hash.salt, hash.iterations, Date.now());
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); db.close(); });
const req = (path: string, method = 'GET', body?: unknown, headers: Record<string,string> = {}) => new Request('https://example.invalid' + path, { method, headers: { 'X-Custom-Pomodoro': '1', 'CF-Connecting-IP': '192.0.2.1', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const login = (headers = {}) => worker.fetch(req('/api/auth/login', 'POST', { email, password: secret }, headers), env);

it('hashes 16-byte salts with a 32-byte PBKDF2 result and compares without early character exits', async () => {
  const row = await hashPassword(secret);
  expect(row.salt).toHaveLength(32); expect(row.pw_hash).toHaveLength(64); expect(row.iterations).toBe(ITERATIONS);
  expect(await verifyPassword(secret, row)).toBe(true);
  expect(await verifyPassword(crypto.randomUUID(), row)).toBe(false);
  expect(constantEqual('ab', 'ac')).toBe(false); expect(constantEqual('a', 'aa')).toBe(false);
});
it('sets a secure cookie, stores only token hashes, slides expiry, and revokes logout', async () => {
  const response = await login();
  expect(response.status).toBe(200);
  const cookie = response.headers.get('Set-Cookie')!;
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api', 'Max-Age=5184000']) expect(cookie).toContain(flag);
  expect(await response.json()).not.toHaveProperty('token');
  const raw = cookie.split(';')[0];
  const stored = db.prepare('SELECT * FROM sessions').get()!;
  expect(raw).not.toContain(stored.token_hash);
  const now = Date.now() + 1000;
  const session = await sessionFor(req('/api/me', 'GET', undefined, { Cookie: raw }), env, now);
  expect(session?.email).toBe(email);
  expect(db.prepare('SELECT expires_at FROM sessions').get()?.expires_at).toBe(now + SESSION_MS);
  expect((await worker.fetch(req('/api/auth/logout', 'POST', undefined, { Cookie: raw }), env)).status).toBe(200);
  expect(await sessionFor(req('/api/me', 'GET', undefined, { Cookie: raw }), env)).toBe(null);
});
it('accepts desktop bearer sessions, scopes sync to email, rejects expired tokens', async () => {
  const response = await login({ 'X-Client': 'desktop' });
  expect(response.headers.get('Set-Cookie')).toBe(null);
  const { token } = await response.json() as { token: string };
  const headers = { Authorization: 'Bearer ' + token };
  expect((await worker.fetch(req('/api/me', 'GET', undefined, headers), env)).status).toBe(200);
  db.prepare('INSERT INTO kv VALUES (?, ?, ?, ?)').run('other@example.invalid', 'notes', '"private"', 1);
  expect((await worker.fetch(req('/api/sync', 'PUT', { entries: [{ key: 'notes', value: 'mine', updatedAt: Date.now() }] }, headers), env)).status).toBe(200);
  const data = await (await worker.fetch(req('/api/sync', 'GET', undefined, headers), env)).json() as { entries: unknown[] };
  expect(data.entries).toHaveLength(1);
  db.exec('UPDATE sessions SET expires_at = 0');
  expect((await worker.fetch(req('/api/me', 'GET', undefined, headers), env)).status).toBe(401);
});
it('uses identical unknown/wrong errors and caps both account and IP at five failures', async () => {
  const failure = (account: string, ip = '192.0.2.1') => worker.fetch(req('/api/auth/login', 'POST', { email: account, password: crypto.randomUUID() }, { 'CF-Connecting-IP': ip }), env);
  const wrong = await failure(email);
  const unknown = await failure('unknown@example.invalid');
  expect(await wrong.json()).toEqual(await unknown.json());
  for (let i = 0; i < 3; i++) expect((await failure('unknown' + i + '@example.invalid')).status).toBe(401);
  const limited = await failure(email);
  expect(limited.status).toBe(429); expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
  db.exec('DELETE FROM login_attempts');
  for (let i = 0; i < 5; i++) expect((await failure(email, '192.0.2.' + i)).status).toBe(401);
  expect((await failure(email, '192.0.2.99')).status).toBe(429);
  db.exec('UPDATE login_attempts SET window_start = 0');
  expect((await login()).status).toBe(200);
});
it('reserves attempts before hashing, preventing overlapping requests from passing the cap', async () => {
  const results = [];
  for (let i = 0; i < 10; i++) results.push(await reserveLogin(env, email, '192.0.2.1'));
  expect(results.filter(row => !row.retry)).toHaveLength(5);
});
it('has no signup route, requires the CSRF header, and fails closed without the allowlist', async () => {
  expect((await worker.fetch(req('/api/auth/signup', 'POST', {}), env)).status).toBe(404);
  expect((await worker.fetch(new Request('https://example.invalid/api/auth/login', { method: 'POST' }), env)).status).toBe(403);
  env.ALLOWED_EMAILS = '';
  expect((await login()).status).toBe(401);
});

describe('reset requires Access and an allowed email', () => {
  let mint: (patch?: Record<string, unknown>) => Promise<string>;
  async function accessToken(account: string, patch = {}) {
    const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ keys: [{ ...jwk, kid: 'test' }] })));
    const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    // Unique kid makes each fixture independent of the isolate cache.
    const kid = crypto.randomUUID();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ keys: [{ ...jwk, kid }] })));
    const head = encode({ alg: 'RS256', kid });
    mint = async (extra = {}) => {
      const body = encode({ aud: env.POLICY_AUD, iss: 'https://' + env.TEAM_DOMAIN, exp: Math.floor(Date.now()/1000) + 300, email: account, ...patch, ...extra });
      const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(head + '.' + body));
      return head + '.' + body + '.' + Buffer.from(sig).toString('base64url');
    };
    return mint();
  }
  it('denies a session cookie without an Access JWT, verifies JWT, resets hash and revokes every session', async () => {
    const signed = await login({ 'X-Client': 'desktop' });
    const { token } = await signed.json() as { token: string };
    expect((await worker.fetch(req('/account/reset/', 'GET', undefined, { Authorization: 'Bearer ' + token }), env)).status).toBe(401);
    const jwt = await accessToken(email);
    const headers = { 'Cf-Access-Jwt-Assertion': jwt };
    const assetFetch = vi.spyOn(env.ASSETS, 'fetch');
    const page = await worker.fetch(req('/account/reset/', 'GET', undefined, headers), env);
    expect(page.status).toBe(200); expect(page.headers.get('Content-Security-Policy')).not.toContain('unsafe-inline');
    expect(await page.text()).toContain('Set a new password');
    expect(page.headers.get('Location')).toBeNull();
    expect(assetFetch).not.toHaveBeenCalled(); // No internal fetch can redirect.
    // Reviewer's attack: start uploading with the stolen token, reset while its
    // final bytes are withheld, then complete the upload after every session dies.
    const delayed = delayedPUT({ Authorization: 'Bearer ' + token });
    const prepare = vi.spyOn(env.DB, 'prepare');
    const pending = worker.fetch(delayed.request, env);
    await Promise.resolve();
    expect(prepare).not.toHaveBeenCalled();
    const replacement = crypto.randomUUID();
    expect((await worker.fetch(req('/account/reset/', 'POST', { password: replacement, confirm: 'mismatch' }, headers), env)).status).toBe(400);
    expect((await worker.fetch(req('/account/reset/', 'POST', { password: replacement, confirm: replacement }, headers), env)).status).toBe(200);
    expect(db.prepare('SELECT * FROM sessions').all()).toHaveLength(0);
    delayed.finish();
    expect((await pending).status).toBe(401);
    expect(db.prepare('SELECT * FROM kv').all()).toHaveLength(0);
    expect((await login()).status).toBe(401);
    secret = replacement; expect((await login()).status).toBe(200);
    env.ALLOWED_EMAILS = 'another@example.invalid';
    expect((await worker.fetch(req('/account/reset/', 'GET', undefined, headers), env)).status).toBe(403);
    expect((await worker.fetch(req('/account/reset/', 'GET', undefined, { 'Cf-Access-Jwt-Assertion': jwt + 'bad' }), env)).status).toBe(401);
    env.ALLOWED_EMAILS = email;
    for (const patch of [{ aud: 'wrong' }, { iss: 'https://wrong.invalid' }, { exp: 0 }, { exp: undefined }, { nbf: Math.floor(Date.now()/1000)+600 }, { email: 'other@example.invalid' }]) {
      expect((await worker.fetch(req('/account/reset/', 'GET', undefined, { 'Cf-Access-Jwt-Assertion': await mint(patch) }), env)).status).toBe(patch.email ? 403 : 401);
    }
    vi.unstubAllGlobals();
  });
});

it('never accepts Access alone for data routes, and renews the web cookie alongside server expiry', async () => {
  expect((await worker.fetch(req('/api/me', 'GET', undefined, { 'Cf-Access-Jwt-Assertion': 'obsolete-access-session' }), env)).status).toBe(401);
  const result = await login();
  const cookie = result.headers.get('Set-Cookie')!.split(';')[0];
  const response = await worker.fetch(req('/api/me', 'GET', undefined, { Cookie: cookie }), env);
  expect(response.status).toBe(200);
  expect(response.headers.get('Set-Cookie')).toContain('Max-Age=5184000');
  const nonCSRF = new Request('https://example.invalid/api/sync', { method: 'PUT', headers: { Cookie: cookie }, body: '{}' });
  expect((await worker.fetch(nonCSRF, env)).status).toBe(403);
});


function delayedPUT(headers: Record<string, string>) {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; c.enqueue(new TextEncoder().encode('{"entries":[')); } });
  return {
    request: new Request('https://example.invalid/api/sync', { method: 'PUT', headers: { 'X-Custom-Pomodoro': '1', ...headers }, body: stream, duplex: 'half' } as RequestInit),
    finish() { controller.enqueue(new TextEncoder().encode(JSON.stringify({ key: 'notes', value: 'attacker overwrite', updatedAt: Date.now() }) + ']}')); controller.close(); },
  };
}
it('blocked login uses only PK lookups and never cleans up or writes', async () => {
  for (let i = 0; i < 5; i++) await reserveLogin(env, email, '192.0.2.1');
  db.prepare('INSERT INTO login_attempts VALUES (?, ?, ?)').run('expired', 5, 0);
  const prepare = vi.spyOn(env.DB, 'prepare');
  const batch = vi.spyOn(env.DB, 'batch');
  expect((await login()).status).toBe(429);
  expect(batch).not.toHaveBeenCalled();
  expect(prepare).toHaveBeenCalledTimes(1);
  for (const [sql] of prepare.mock.calls) {
    expect(sql).toMatch(/^SELECT .*WHERE key IN/);
    const plan = db.prepare('EXPLAIN QUERY PLAN ' + sql).all('a', 'b', 0);
    expect(plan.map(r => r.detail).join(' ')).toMatch(/SEARCH login_attempts USING INDEX sqlite_autoindex_login_attempts_1/);
  }
  expect(db.prepare("SELECT count(*) AS n FROM login_attempts WHERE key = 'expired'").get()?.n).toBe(1);
});
it('only successful login removes expiry rows, at most 50 each via indexes', async () => {
  for (let i = 0; i < 120; i++) {
    db.prepare('INSERT INTO login_attempts VALUES (?, 1, 0)').run('expired-' + i);
    db.prepare('INSERT INTO sessions VALUES (?, ?, 0, 0, 0, ?)').run('expired-' + i, email, 'test');
  }
  expect((await worker.fetch(req('/api/auth/login', 'POST', { email, password: 'wrong' }), env)).status).toBe(401);
  expect(db.prepare('SELECT count(*) AS n FROM login_attempts WHERE window_start = 0').get()?.n).toBe(120);
  const prepare = vi.spyOn(env.DB, 'prepare');
  expect((await login()).status).toBe(200);
  expect(db.prepare('SELECT count(*) AS n FROM login_attempts WHERE window_start = 0').get()?.n).toBe(70);
  expect(db.prepare('SELECT count(*) AS n FROM sessions WHERE expires_at = 0').get()?.n).toBe(70);
  const deletes = prepare.mock.calls.map(([sql]) => sql).filter(sql => sql.startsWith('DELETE'));
  expect(deletes).toHaveLength(2);
  for (const sql of deletes) {
    expect(sql).toContain('LIMIT 50');
    const plan = db.prepare('EXPLAIN QUERY PLAN ' + sql).all(Date.now()).map(r => r.detail).join(' ');
    expect(plan).toContain(sql.includes('login_attempts') ? 'USING INDEX login_attempts_expiry' : 'USING INDEX sessions_expiry');
    expect(plan).not.toMatch(/SCAN (login_attempts|sessions)/);
  }
});
it('logout during a delayed upload prevents any sync write', async () => {
  const { token } = await (await login({ 'X-Client': 'desktop' })).json() as { token: string };
  const headers = { Authorization: 'Bearer ' + token };
  const delayed = delayedPUT(headers);
  const pending = worker.fetch(delayed.request, env);
  expect((await worker.fetch(req('/api/auth/logout', 'POST', undefined, headers), env)).status).toBe(200);
  delayed.finish();
  expect((await pending).status).toBe(401);
  expect(db.prepare('SELECT * FROM kv').all()).toHaveLength(0);
});
it.each(['logout', 'expiry'])('guards every upsert if %s occurs between the post-body lookup and write batch', async reason => {
  const { token } = await (await login({ 'X-Client': 'desktop' })).json() as { token: string };
  db.prepare('INSERT INTO kv VALUES (?, ?, ?, ?)').run(email, 'notes', '"original"', 1);
  const batch = env.DB.batch;
  const spy = vi.spyOn(env.DB, 'batch').mockImplementation(async stmts => {
    if (reason === 'logout') db.exec('DELETE FROM sessions');
    else db.exec('UPDATE sessions SET expires_at = 0');
    return batch(stmts);
  });
  const response = await worker.fetch(req('/api/sync', 'PUT', { entries: [
    { key: 'notes', value: 'overwritten', updatedAt: Date.now() },
    { key: 'tasks', value: [], updatedAt: Date.now() },
  ] }, { Authorization: 'Bearer ' + token }), env);
  expect(response.status).toBe(401);
  expect(spy).toHaveBeenCalledTimes(1);
  expect(db.prepare('SELECT key, value FROM kv').all()).toEqual([{ key: 'notes', value: '"original"' }]);
});
it('validates body and value byte bounds, including early declared length rejection', async () => {
  const prepare = vi.spyOn(env.DB, 'prepare');
  let canceled = false;
  const body = new ReadableStream({ cancel() { canceled = true; } });
  const response = await worker.fetch(new Request('https://example.invalid/api/sync', { method: 'PUT', headers: { 'X-Custom-Pomodoro': '1', 'Content-Length': String(MAX_SYNC_BYTES + 1) }, body, duplex: 'half' } as RequestInit), env);
  expect(response.status).toBe(413); expect(canceled).toBe(true); expect(prepare).not.toHaveBeenCalled();
});
it.each([undefined, '1'])('cancels a chunked upload immediately on overflow (declared length %s)', async length => {
  let canceled = false;
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(MAX_SYNC_BYTES)); c.enqueue(new Uint8Array(1)); }, cancel() { canceled = true; return new Promise(() => {}); } });
  const prepare = vi.spyOn(env.DB, 'prepare');
  const response = await worker.fetch(new Request('https://example.invalid/api/sync', { method: 'PUT', headers: { 'X-Custom-Pomodoro': '1', ...(length ? { 'Content-Length': length } : {}) }, body: stream, duplex: 'half' } as RequestInit), env);
  expect(response.status).toBe(413); expect(canceled).toBe(true); expect(prepare).not.toHaveBeenCalled();
});
it('uses an absolute ten-second deadline even if the body trickles, and cancels without waiting', async () => {
  vi.useFakeTimers();
  let canceled = false;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; c.enqueue(new TextEncoder().encode('{')); }, cancel() { canceled = true; return new Promise(() => {}); } });
  const prepare = vi.spyOn(env.DB, 'prepare');
  const pending = worker.fetch(new Request('https://example.invalid/api/sync', { method: 'PUT', headers: { 'X-Custom-Pomodoro': '1' }, body: stream, duplex: 'half' } as RequestInit), env);
  await vi.advanceTimersByTimeAsync(BODY_DEADLINE_MS - 1);
  controller!.enqueue(new TextEncoder().encode(' '));
  await vi.advanceTimersByTimeAsync(1);
  expect((await pending).status).toBe(408); expect(canceled).toBe(true); expect(prepare).not.toHaveBeenCalled();
});
it('keeps reset HTML exclusively behind the Access route, regardless of SPA fallback', async () => {
  const assets = vi.spyOn(env.ASSETS, 'fetch').mockResolvedValue(new Response('<html>SPA fallback</html>'));
  for (const path of ['/reset', '/reset.html', '/reset/']) expect((await worker.fetch(req(path), env)).status).toBe(404);
  for (const path of ['/account/reset', '/account/reset/']) expect((await worker.fetch(req(path), env)).status).toBe(401);
  expect(assets).not.toHaveBeenCalled();
  expect(existsSync('public/reset.html')).toBe(false);
  const config = readFileSync('deploy/wrangler.jsonc', 'utf8');
  for (const path of ['/reset', '/reset/*', '/reset.html']) expect(config).toContain('"' + path + '"');
});

it('syncs a measured heavy year of stats and enforces both total and per-value limits', async () => {
  const stats = heavyStats();
  expect(stats.chunks).toHaveLength(8760);
  expect(stats.tasksDone).toHaveLength(2920);
  expect(new TextEncoder().encode(JSON.stringify(stats)).length).toBe(1_369_506);
  const { token } = await (await login({ 'X-Client': 'desktop' })).json() as { token: string };
  const headers = { Authorization: 'Bearer ' + token };
  const data = { entries: [{ key: 'stats', value: stats, updatedAt: Date.now() }] };
  expect(new TextEncoder().encode(JSON.stringify(data)).length).toBeLessThan(MAX_SYNC_BYTES);
  expect((await worker.fetch(req('/api/sync', 'PUT', data, headers), env)).status).toBe(200);
  expect(JSON.parse(String(db.prepare("SELECT value FROM kv WHERE key = 'stats'").get()?.value))).toEqual(stats);
  const tooLarge = { entries: [{ key: 'notes', value: '😀'.repeat(475000), updatedAt: Date.now() }] };
  expect((await worker.fetch(req('/api/sync', 'PUT', tooLarge, headers), env)).status).toBe(413);
  const combined = { entries: ['notes', 'tasks'].map(key => ({ key, value: 'x'.repeat(1100000), updatedAt: Date.now() })) };
  expect((await worker.fetch(req('/api/sync', 'PUT', combined, headers), env)).status).toBe(413);
});
it('decodes UTF-8 across chunk boundaries and renews the cookie in the same sync write batch', async () => {
  const signed = await login();
  const headers = { Cookie: signed.headers.get('Set-Cookie')!.split(';')[0], 'X-Custom-Pomodoro': '1' };
  const bytes = new TextEncoder().encode(JSON.stringify({ entries: [{ key: 'notes', value: '😀', updatedAt: Date.now() }] }));
  const split = bytes.indexOf(0xf0) + 1;
  const stream = new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, split)); c.enqueue(bytes.slice(split)); c.close(); } });
  const batch = vi.spyOn(env.DB, 'batch');
  const response = await worker.fetch(new Request('https://example.invalid/api/sync', { method: 'PUT', headers, body: stream, duplex: 'half' } as RequestInit), env);
  expect(response.status).toBe(200); expect(response.headers.get('Set-Cookie')).toContain('Max-Age=5184000');
  expect(batch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(db.prepare("SELECT value FROM kv WHERE key = 'notes'").get()?.value))).toBe('😀');
});

it('syncs the parking lot through the allowed key list', async () => {
  const response = await login({ 'X-Client': 'desktop' });
  const { token } = await response.json() as { token: string };
  const headers = { Authorization: 'Bearer ' + token };
  const value = [{ id: 'thought', text: 'Read later', at: Date.now(), segment: 'focus', status: 'open' }];
  expect((await worker.fetch(req('/api/sync', 'PUT', { entries: [{ key: 'parked', value, updatedAt: Date.now() }] }, headers), env)).status).toBe(200);
  const result = await (await worker.fetch(req('/api/sync', 'GET', undefined, headers), env)).json() as { entries: { key: string; value: unknown }[] };
  expect(result.entries.find(entry => entry.key === 'parked')?.value).toEqual(value);
});

it('C2: accepts nine keys, preserves intent through old eight-key uploads and resolves equal stamps without stripping fields', async () => {
  const response = await login({ 'X-Client': 'desktop' });
  const { token } = await response.json() as { token: string };
  const headers = { Authorization: 'Bearer ' + token };
  const at = Date.now();
  const intent = { action: 'Open the draft', why: 'Send the outline', cue: 'When I sit down after lunch, I will open the draft', reward: 'Tea outside', rev: 4, updatedAt: at };
  const oldKeys = ['settings', 'tasks', 'focusPick', 'stats', 'notes', 'mixer', 'radio', 'parked'];
  const oldEntries = oldKeys.map(key => ({ key, value: key === 'notes' ? 'old notes' : {}, updatedAt: at }));
  expect((await worker.fetch(req('/api/sync', 'PUT', { entries: [...oldEntries, { key: 'intent', value: intent, updatedAt: at }] }, headers), env)).status).toBe(200);
  expect((await worker.fetch(req('/api/sync', 'PUT', { entries: oldEntries.map(e => ({ ...e, updatedAt: at + 1 })) }, headers), env)).status).toBe(200);
  expect((await worker.fetch(req('/api/sync', 'PUT', { entries: [{ key: 'intent', value: { ...intent, why: 'equal stamp edit' }, updatedAt: at }] }, headers), env)).status).toBe(200);
  const saved = await (await worker.fetch(req('/api/sync', 'GET', undefined, headers), env)).json() as { entries: { key: string; value: unknown }[] };
  expect(saved.entries).toHaveLength(9);
  expect(saved.entries.find(e => e.key === 'intent')?.value).toEqual(intent);
});
it.each([null, {}, { action: 'a', why: 'b', rev: 0, updatedAt: 0, taskId: 'unknown' },
  { action: ['invalid'], why: '', rev: 0, updatedAt: 0 }, { action: '', why: '', rev: -1, updatedAt: 0 }])('C2: rejects malformed intent %j before any writes', async value => {
  const response = await login({ 'X-Client': 'desktop' });
  const { token } = await response.json() as { token: string };
  const reply = await worker.fetch(req('/api/sync', 'PUT', { entries: [{ key: 'notes', value: 'unchanged', updatedAt: Date.now() }, { key: 'intent', value, updatedAt: Date.now() }] }, { Authorization: 'Bearer ' + token }), env);
  expect(reply.status).toBe(400);
  expect(db.prepare('SELECT * FROM kv').all()).toHaveLength(0);
});

it('preserves task guesses verbatim beside older tasks through the worker validator', async () => {
  const { token } = await (await login({ 'X-Client': 'desktop' })).json() as { token: string };
  const headers = { Authorization: 'Bearer ' + token };
  const value = [{ id: 'new', title: 'Draft', done: false, createdAt: Date.now(), etaMin: 20 },
    { id: 'old', title: 'Read', done: false, createdAt: Date.now() }];
  expect((await worker.fetch(req('/api/sync', 'PUT', { entries: [{ key: 'tasks', value, updatedAt: Date.now() }] }, headers), env)).status).toBe(200);
  const saved = await (await worker.fetch(req('/api/sync', 'GET', undefined, headers), env)).json() as { entries: { value: unknown }[] };
  expect(saved.entries[0].value).toEqual(value);
});

it('round-trips away stats and unknown chunk fields without accepting a synced presence store', async () => {
  const response = await login({ 'X-Client': 'desktop' }); const { token } = await response.json() as { token: string };
  const headers = { Authorization: 'Bearer ' + token };
  const value = { chunks: [{ id: 'away', kind: 'break', segment: 'short', start: Date.now(), ms: 3 * 86_400_000, completed: false, away: true, futureField: { kept: true } }], tasksDone: [] };
  expect((await worker.fetch(req('/api/sync', 'PUT', { entries: [{ key: 'stats', value, updatedAt: Date.now() }] }, headers), env)).status).toBe(200);
  const data = await (await worker.fetch(req('/api/sync', 'GET', undefined, headers), env)).json() as { entries: { value: unknown }[] };
  expect(data.entries[0].value).toEqual(value);
  expect((await worker.fetch(req('/api/sync', 'PUT', { entries: [{ key: 'clockPresence', value: {}, updatedAt: Date.now() }] }, headers), env)).status).toBe(400);
});

it('N1: legacy intent writes preserve enough only for the same action, while explicit clear and replacement remove it', async () => {
  const { token } = await (await login({ 'X-Client': 'desktop' })).json() as { token: string };
  const headers = { Authorization: 'Bearer ' + token }; const at = Date.now();
  const original = { action: 'Draft', why: '', sufficientFinish: 'Three rough paragraphs', rev: 1, updatedAt: at };
  const put = (value: object, stamp: number) => worker.fetch(req('/api/sync', 'PUT', { entries: [{ key: 'intent', value, updatedAt: stamp }] }, headers), env);
  const get = async () => JSON.parse(String(db.prepare("SELECT value FROM kv WHERE key = 'intent'").get()?.value));
  expect((await put(original, at)).status).toBe(200);
  const legacy = { action: 'Draft', why: 'Share', rev: 2, updatedAt: at + 1 };
  expect((await put(legacy, at + 1)).status).toBe(200);
  expect(await get()).toEqual({ ...legacy, sufficientFinish: original.sufficientFinish });
  expect((await put({ ...legacy, sufficientFinish: '', rev: 3 }, at + 2)).status).toBe(200);
  expect((await get()).sufficientFinish).toBe('');
  await put(original, at + 3);
  await put({ ...legacy, action: 'Read' }, at + 4);
  expect(await get()).not.toHaveProperty('sufficientFinish');
});

it('N2: preserves omitted leaf allowances atomically across old writers, null clears, equal stamps and new parents', async () => {
  const { token } = await (await login({ 'X-Client': 'desktop' })).json() as { token: string };
  const headers = { Authorization: 'Bearer ' + token }, at = Date.now();
  const task = (id: string, patch = {}) => ({ id, title: id, done: false, createdAt: at, ...patch });
  const put = (value: unknown, stamp: number, upgraded = true) => worker.fetch(req('/api/sync', 'PUT', { entries: [{ key: 'tasks', value, updatedAt: stamp }], ...(upgraded ? { taskAllowanceVersion: 1 } : {}) }, headers), env);
  const get = () => JSON.parse(String(db.prepare("SELECT value FROM kv WHERE key = 'tasks'").get()?.value));
  expect((await put([task('a', { transitionAllowanceMin: 10 }), task('b', { transitionAllowanceMin: 0 })], at)).status).toBe(200);
  expect((await put([task('a'), task('b')], at + 1, false)).status).toBe(200);
  expect(get().map((t: any) => t.transitionAllowanceMin)).toEqual([10, 0]);
  expect((await put([task('a', { transitionAllowanceMin: 240 })], at + 1)).status).toBe(200);
  expect(get()).toHaveLength(2);
  expect((await put([task('a', { transitionAllowanceMin: null })], at + 2)).status).toBe(200);
  expect(get()).toEqual([task('a', { transitionAllowanceMin: null })]);
  expect((await put([task('a', { transitionAllowanceMin: 10 })], at + 3)).status).toBe(200);
  expect((await put([task('a'), task('child', { parentId: 'a' })], at + 4)).status).toBe(200);
  expect(get()).toEqual([task('a', { transitionAllowanceMin: null }), task('child', { parentId: 'a' })]);
  for (const value of [-1, 241, 1.5, '10']) expect((await put([task('a', { transitionAllowanceMin: value })], at + 5)).status).toBe(400);
});

it('N2 S1: parent promotion keeps a clear tombstone after its last child is deleted', async () => {
  const { token } = await (await login({ 'X-Client': 'desktop' })).json() as { token: string };
  const at = Date.now(), headers = { Authorization: 'Bearer ' + token };
  const task = { id: 'a', title: 'Draft', done: false, createdAt: at };
  const put = (value: unknown, delta: number) => worker.fetch(req('/api/sync', 'PUT', { entries: [{ key: 'tasks', value, updatedAt: at + delta }] }, headers), env);
  await put([{ ...task, transitionAllowanceMin: 10 }], 0);
  await put([task, { ...task, id: 'child', parentId: 'a' }], 1);
  await put([task], 2);
  const saved = JSON.parse(String(db.prepare("SELECT value FROM kv WHERE key = 'tasks'").get()?.value));
  expect(saved).toEqual([{ ...task, transitionAllowanceMin: null }]);
});
it('N2 S2: a supported large sync list retains every allowance within a bounded query', async () => {
  const { token } = await (await login({ 'X-Client': 'desktop' })).json() as { token: string };
  const at = Date.now(), headers = { Authorization: 'Bearer ' + token };
  const previous = Array.from({ length: 10000 }, (_, i) => ({ id: String(i), title: 'Draft', transitionAllowanceMin: i % 241 }));
  db.prepare('INSERT INTO kv VALUES (?, ?, ?, ?)').run(email, 'tasks', JSON.stringify(previous), at);
  const value = previous.map(({ transitionAllowanceMin: _ignored, ...task }) => task);
  const start = performance.now();
  expect((await worker.fetch(req('/api/sync', 'PUT', { entries: [{ key: 'tasks', value, updatedAt: at + 1 }] }, headers), env)).status).toBe(200);
  expect(performance.now() - start).toBeLessThan(5000);
  expect(JSON.parse(String(db.prepare("SELECT value FROM kv WHERE key = 'tasks'").get()?.value))).toEqual(previous);
});
it('N2 S1: first-insert legacy parents carry a clear even when this server has no prior allowance', async () => {
  const { token } = await (await login({ 'X-Client': 'desktop' })).json() as { token: string };
  const at = Date.now(), headers = { Authorization: 'Bearer ' + token };
  const task = { id: 'a', title: 'Draft', done: false, createdAt: at };
  const put = (value: unknown, delta: number) => worker.fetch(req('/api/sync', 'PUT', { entries: [{ key: 'tasks', value, updatedAt: at + delta }] }, headers), env);
  await put([task, { ...task, id: 'child', parentId: 'a' }], 0);
  let saved = JSON.parse(String(db.prepare("SELECT value FROM kv WHERE key = 'tasks'").get()?.value));
  expect(saved[0].transitionAllowanceMin).toBeNull();
  await put([task], 1);
  saved = JSON.parse(String(db.prepare("SELECT value FROM kv WHERE key = 'tasks'").get()?.value));
  expect(saved).toEqual([{ ...task, transitionAllowanceMin: null }]);
});
it('N2 S1: an old client retaining the unknown allowance can promote a task without blocking its sync batch', async () => {
  const { token } = await (await login({ 'X-Client': 'desktop' })).json() as { token: string };
  const at = Date.now(), headers = { Authorization: 'Bearer ' + token };
  const parent = { id: 'a', title: 'Draft', done: false, createdAt: at, transitionAllowanceMin: 10 };
  const reply = await worker.fetch(req('/api/sync', 'PUT', { entries: [
    { key: 'tasks', value: [parent, { id: 'child', title: 'One paragraph', done: false, createdAt: at, parentId: 'a' }], updatedAt: at },
    { key: 'notes', value: 'Keep this batch', updatedAt: at },
  ] }, headers), env);
  expect(reply.status).toBe(200);
  const rows = db.prepare('SELECT key, value FROM kv').all();
  expect(rows).toHaveLength(2);
  expect(JSON.parse(String(rows.find(row => row.key === 'tasks')?.value))[0].transitionAllowanceMin).toBeNull();
});
it('N2 security: cap-compliant 40000-task merges retain every value without repeated document searches', async () => {
  const { token } = await (await login({ 'X-Client': 'desktop' })).json() as { token: string };
  const at = Date.now(), headers = { Authorization: 'Bearer ' + token };
  const previous = Array.from({ length: 40000 }, (_, i) => ({ id: 't' + i, transitionAllowanceMin: i % 241 }));
  expect(new TextEncoder().encode(JSON.stringify(previous)).byteLength).toBeLessThan(1_900_000);
  db.prepare('INSERT INTO kv VALUES (?, ?, ?, ?)').run(email, 'tasks', JSON.stringify(previous), at);
  const value = previous.map(({ transitionAllowanceMin: _ignored, ...task }) => task);
  const start = performance.now();
  expect((await worker.fetch(req('/api/sync', 'PUT', { entries: [{ key: 'tasks', value, updatedAt: at + 1 }] }, headers), env)).status).toBe(200);
  expect(performance.now() - start).toBeLessThan(5000);
  expect(JSON.parse(String(db.prepare("SELECT value FROM kv WHERE key = 'tasks'").get()?.value))).toEqual(previous);
});
it('N2 S3: incoming repeated ids cannot supply an allowance when no old row matches', async () => {
  const { token } = await (await login({ 'X-Client': 'desktop' })).json() as { token: string };
  const at = Date.now(), headers = { Authorization: 'Bearer ' + token };
  db.prepare('INSERT INTO kv VALUES (?, ?, ?, ?)').run(email, 'tasks', '[]', at);
  const value = [{ id: 'a' }, { id: 'a', transitionAllowanceMin: 240 }];
  expect((await worker.fetch(req('/api/sync', 'PUT', { entries: [{ key: 'tasks', value, updatedAt: at + 1 }] }, headers), env)).status).toBe(200);
  expect(JSON.parse(String(db.prepare("SELECT value FROM kv WHERE key = 'tasks'").get()?.value))).toEqual(value);
});
it('N2 legacy retained fields stay cleared after promotion/deletion; an upgraded writer can deliberately replace them', async () => {
  const { token } = await (await login({ 'X-Client': 'desktop' })).json() as { token: string };
  const at = Date.now(), headers = { Authorization: 'Bearer ' + token };
  const retained = { id: 'a', title: 'Draft', done: false, createdAt: at, transitionAllowanceMin: 10 };
  const put = (value: unknown, delta: number, upgraded = false) => worker.fetch(req('/api/sync', 'PUT', {
    entries: [{ key: 'tasks', value, updatedAt: at + delta }], ...(upgraded ? { taskAllowanceVersion: 1 } : {}),
  }, headers), env);
  const get = () => JSON.parse(String(db.prepare("SELECT value FROM kv WHERE key = 'tasks'").get()?.value));
  await put([retained], 0, true);
  await put([retained, { id: 'child', parentId: 'a' }], 1);
  expect(get()[0].transitionAllowanceMin).toBeNull();
  await put([{ ...retained, title: 'Renamed without touching allowance' }], 2);
  expect(get()).toEqual([{ ...retained, title: 'Renamed without touching allowance', transitionAllowanceMin: null }]);
  await put([{ ...retained, transitionAllowanceMin: 15 }], 3, true);
  expect(get()[0].transitionAllowanceMin).toBe(15);
});
