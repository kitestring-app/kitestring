const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createCloud, registerCloud, validRequest } = require('../cloud.cjs');
const { randomBytes } = require('node:crypto');
const ORIGIN = 'https://kitestring.custom-pomodoro.workers.dev';

test('pins routes and verbs, rejecting absolute URLs, query strings, and invalid bodies', () => {
  assert.equal(validRequest('GET', '/api/me'), true);
  assert.equal(validRequest('GET', '/api/sync'), true);
  assert.equal(validRequest('PUT', '/api/sync', { entries: [] }), true);
  for (const route of ['https://evil.invalid/api/me', '//evil.invalid', '/api/me?x=1', '/api/auth/login', '/api/sync/../me', '/account/reset/']) assert.equal(validRequest('GET', route), false);
  assert.equal(validRequest('GET', '/api/me', {}), false);
  assert.equal(validRequest('DELETE', '/api/sync'), false);
  assert.equal(validRequest('PUT', '/api/sync', { entries: new Array(9).fill({}) }), true); // one per synced key
  assert.equal(validRequest('PUT', '/api/sync', { entries: new Array(10) }), false);
});
test('encrypts tokens, restores them only in main, never returns them, revokes on logout', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cloud-test-'));
  const token = randomBytes(32).toString('hex');
  const calls = [], encryption = [];
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: value => { encryption.push('encrypt'); return Buffer.from('encrypted:' + Buffer.from(value).toString('base64')); },
    decryptString: value => { encryption.push('decrypt'); return Buffer.from(value.toString().slice(10), 'base64').toString(); },
  };
  const send = async (url, init) => {
    calls.push({ url, init });
    return Response.json(url.endsWith('/login') ? { ok: true, email: 'test@example.invalid', token } : { ok: true, email: 'test@example.invalid' });
  };
  try {
    const cloud = createCloud({ origin: ORIGIN, userData: dir, safeStorage, fetch: send });
    const result = await cloud.signIn('test@example.invalid', randomBytes(20).toString('hex'));
    assert.equal(JSON.stringify(result).includes(token), false);
    assert.equal((await readFile(path.join(dir, 'cloud-session.enc'), 'utf8')).includes(token), false);
    const restored = createCloud({ origin: ORIGIN, userData: dir, safeStorage, fetch: send });
    assert.equal((await restored.status()).status, 200);
    assert.deepEqual(encryption, ['encrypt', 'decrypt']);
    assert.equal(calls[1].init.headers.Authorization, 'Bearer ' + token);
    assert.equal(calls.every(c => new URL(c.url).origin === ORIGIN), true);
    assert.equal(calls.every(c => c.init.redirect === 'error'), true);
    await restored.signOut();
    await assert.rejects(readFile(path.join(dir, 'cloud-session.enc')));
    assert.equal((await restored.status()).status, 401);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('fails closed with locked Keychain, limits login attempts locally, and validates IPC senders', async () => {
  const options = { origin: ORIGIN, userData: '/unused', safeStorage: { isEncryptionAvailable: () => false }, fetch: async () => Response.json({ ok: false }, { status: 401 }) };
  const locked = createCloud(options);
  assert.equal((await locked.signIn('test@example.invalid', randomBytes(20).toString('hex'))).status, 503);
  let calls = 0;
  const cloud = createCloud({ ...options, safeStorage: { isEncryptionAvailable: () => true }, fetch: async () => { calls++; return Response.json({ ok: false }, { status: 401 }); } });
  for (let i = 0; i < 5; i++) assert.equal((await cloud.signIn('test@example.invalid', randomBytes(20).toString('hex'))).status, 401);
  assert.equal((await cloud.signIn('test@example.invalid', randomBytes(20).toString('hex'))).status, 429);
  assert.equal(calls, 5);
  assert.equal((await cloud.request('GET', 'https://evil.invalid')).status, 400);
  const handlers = new Map();
  registerCloud({ handle: (name, handler) => handlers.set(name, handler) }, event => event.trusted === true, cloud, () => true);
  for (const [name, handler] of handlers) assert.deepEqual(await handler({ trusted: false }), name.endsWith('-reset') ? false : { status: 403, data: { ok: false } });
  assert.equal(await handlers.get('desktop:cloud-reset')({ trusted: true }), true);
  assert.match(require('node:fs').readFileSync(path.join(__dirname, '../main.cjs'), 'utf8'), /const CLOUD_ORIGIN = 'https:\/\/kitestring\.custom-pomodoro\.workers\.dev'/);
});

test('upload limits match the web app and the Worker (regression: 7-entry cap broke 8-key sync)', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { MAX_ENTRIES, MAX_BYTES } = require('../cloud.cjs');
  const syncSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'lib', 'sync.ts'), 'utf8');
  const keys = syncSrc.match(/SYNC_KEYS = \[([^\]]+)\]/)[1].split(',').filter((k) => k.trim());
  assert.equal(MAX_ENTRIES, keys.length, 'desktop entry cap must equal the number of synced keys');
  const worker = fs.readFileSync(path.join(__dirname, '..', '..', 'worker', 'index.ts'), 'utf8');
  assert.match(worker, /MAX_SYNC_BYTES = 2 \* 1024 \* 1024/);
  assert.equal(MAX_BYTES, 2 * 1024 * 1024);
});

test('C2: cue and reward round-trip unchanged through the native cloud transport', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cloud-intent-test-'));
  const value = { action: 'Open the draft', why: 'Share the outline', cue: 'After lunch, open the draft', reward: 'Tea outside', rev: 3, updatedAt: Date.now() };
  const token = randomBytes(32).toString('hex');
  let saved;
  const send = async (url, init) => {
    if (url.endsWith('/login')) return Response.json({ ok: true, token });
    if (init.method === 'PUT') saved = JSON.parse(init.body);
    return Response.json(init.method === 'GET' ? saved : { ok: true });
  };
  try {
    const cloud = createCloud({ origin: ORIGIN, userData: dir, safeStorage: {
      isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString(),
    }, fetch: send });
    await cloud.signIn('test@example.invalid', randomBytes(20).toString('hex'));
    assert.equal((await cloud.request('PUT', '/api/sync', { entries: [{ key: 'intent', value, updatedAt: value.updatedAt }] })).status, 200);
    const result = await cloud.request('GET', '/api/sync');
    assert.deepEqual(result.data.entries[0].value, value);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

for (const failure of ['offline', 404, 503]) test(`uses the fixed legacy service on new-origin failure: ${failure}`, async () => {
  const urls = [];
  const fallbackOrigin = 'https://custom-pomodoro.custom-pomodoro.workers.dev';
  const token = randomBytes(32).toString('hex');
  const cloud = createCloud({ origin: ORIGIN, fallbackOrigin, userData: '/unused', safeStorage: { isEncryptionAvailable: () => true }, fetch: async (url) => {
    urls.push(url);
    if (url.startsWith(ORIGIN)) {
      if (failure === 'offline') throw new Error('offline');
      return new Response('', { status: failure });
    }
    // An auth refusal avoids writing a credential in this transport-only test.
    return Response.json({ ok: false }, { status: 401 });
  } });
  assert.equal((await cloud.signIn('test@example.invalid', token)).status, 401);
  assert.deepEqual(urls, [ORIGIN + '/api/auth/login', fallbackOrigin + '/api/auth/login']);
});
for (const status of [401, 403, 429]) for (const json of [true, false]) test(`new service auth response ${status}, JSON: ${json}, never retries elsewhere`, async () => {
  const urls = [];
  const cloud = createCloud({ origin: ORIGIN, fallbackOrigin: 'https://custom-pomodoro.custom-pomodoro.workers.dev', userData: '/unused', safeStorage: { isEncryptionAvailable: () => true }, fetch: async url => {
    urls.push(url); return json ? Response.json({ ok: false }, { status }) : new Response('Unavailable', { status });
  } });
  assert.equal((await cloud.signIn('test@example.invalid', randomBytes(20).toString('hex'))).status, status);
  assert.deepEqual(urls, [ORIGIN + '/api/auth/login']);
});

test('task estimates and old tasks pass unchanged through the native cloud bridge', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cloud-estimates-test-'));
  const token = randomBytes(32).toString('hex');
  const entries = [{ key: 'tasks', updatedAt: 1, value: [
    { id: 'new', title: 'Draft', etaMin: 20, done: false, createdAt: 1 },
    { id: 'old', title: 'Read', done: false, createdAt: 1 },
  ] }];
  let saved;
  try {
    const cloud = createCloud({ origin: ORIGIN, userData: dir, safeStorage: {
      isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString(),
    }, fetch: async (url, init) => {
      if (url.endsWith('/login')) return Response.json({ ok: true, token });
      if (init.method === 'PUT') saved = JSON.parse(init.body);
      return Response.json(init.method === 'GET' ? saved : { ok: true });
    } });
    await cloud.signIn('test@example.invalid', randomBytes(20).toString('hex'));
    assert.equal((await cloud.request('PUT', '/api/sync', { entries })).status, 200);
    assert.deepEqual((await cloud.request('GET', '/api/sync')).data.entries, entries);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('away breaks and unknown fields round-trip unchanged through native cloud sync', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cloud-away-test-'));
  const token = randomBytes(32).toString('hex');
  const entries = [{ key: 'stats', updatedAt: 1, value: { chunks: [{ id: 'away', kind: 'break', segment: 'short', start: 1, ms: 3 * 86400000, completed: false, away: true, futureField: { kept: true } }], tasksDone: [] } }];
  let saved;
  try {
    const cloud = createCloud({ origin: ORIGIN, userData: dir, safeStorage: {
      isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString(),
    }, fetch: async (url, init) => {
      if (url.endsWith('/login')) return Response.json({ ok: true, token });
      if (init.method === 'PUT') saved = JSON.parse(init.body);
      return Response.json(init.method === 'GET' ? saved : { ok: true });
    } });
    await cloud.signIn('test@example.invalid', randomBytes(20).toString('hex'));
    assert.equal((await cloud.request('PUT', '/api/sync', { entries })).status, 200);
    assert.deepEqual((await cloud.request('GET', '/api/sync')).data.entries, entries);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
