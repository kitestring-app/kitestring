// This fixture runs only a throwaway Wrangler/D1 project. No remote operations.
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { passwordSQL } from './set-password.mjs';
import { request as httpRequest } from 'node:http';
import { heavyStats } from '../worker/fixtures/heavy-stats.mjs';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const scratch = await mkdtemp(join(tmpdir(), 'cp-auth-local-'));
const cli = process.env.CP_WRANGLER ? [process.execPath, process.env.CP_WRANGLER] : ['npx', '--yes', 'wrangler@4.152.0'];
const config = join(scratch, 'wrangler.json');
const state = join(scratch, 'state');
const email = 'local-test@example.invalid';
const password = crypto.randomUUID();
const replacement = crypto.randomUUID();
const port = process.env.CP_TEST_PORT || '18747';
const base = 'http://127.0.0.1:' + port;
const env = { ...process.env, WRANGLER_LOG_PATH: join(scratch, 'wrangler.log'), WRANGLER_SEND_METRICS: 'false' };
let server;
// Read all-thread native process CPU, including crypto and local D1 work. This
// measures the whole local workerd, not just V8 samples or request wall time.
function workerdPids() {
  const ps = spawnSync('ps', ['-axo', 'pid=,ppid=,comm='], { encoding: 'utf8' });
  if (ps.status !== 0) throw new Error('Cannot enumerate local workerd processes');
  const rows = ps.stdout.trim().split('\n').map(line => {
    const [, pid, parent, name] = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    return { pid: Number(pid), parent: Number(parent), name };
  });
  const descendants = new Set([server.pid]);
  for (let changed = true; changed;) {
    changed = false;
    for (const row of rows) if (descendants.has(row.parent) && !descendants.has(row.pid)) { descendants.add(row.pid); changed = true; }
  }
  const pids = rows.filter(row => descendants.has(row.pid) && /(?:^|\/)workerd$/.test(row.name)).map(row => row.pid);
  assert.ok(pids.length, 'No test-owned workerd process found');
  return pids;
}
function cpuMilliseconds(pids) {
  if (process.platform !== 'darwin') throw new Error('Native CPU sampler currently supports macOS only');
  // proc_pid_rusage v2 starts with uuid[16], then user_time and system_time
  // (Mach absolute ticks on this host). Buffer is larger than rusage_info_v2; no extra dependency.
  const code = `import ctypes, sys
lib = ctypes.CDLL('/usr/lib/libproc.dylib')
lib.proc_pid_rusage.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
class Timebase(ctypes.Structure):
    _fields_ = [('numer', ctypes.c_uint32), ('denom', ctypes.c_uint32)]
base = Timebase()
assert ctypes.CDLL('/usr/lib/libSystem.B.dylib').mach_timebase_info(ctypes.byref(base)) == 0
total = 0
for pid in sys.argv[1:]:
    buf = ctypes.create_string_buffer(1024)
    if lib.proc_pid_rusage(int(pid), 2, ctypes.byref(buf)) != 0: raise RuntimeError('proc_pid_rusage failed')
    total += ctypes.c_uint64.from_buffer(buf, 16).value + ctypes.c_uint64.from_buffer(buf, 24).value
print(total * base.numer / base.denom / 1e6)
`;
  const result = spawnSync('python3', ['-c', code, ...pids.map(String)], { encoding: 'utf8', timeout: 5000 });
  if (result.status !== 0) throw new Error('Native CPU sampling failed: ' + result.stderr);
  return Number(result.stdout);
}
async function measureCPU(label, run, pids, samples = 40) {
  for (let i = 0; i < 5; i++) await run();
  const times = [];
  for (let i = 0; i < samples; i++) {
    const before = cpuMilliseconds(pids);
    await run();
    times.push(cpuMilliseconds(pids) - before);
  }
  times.sort((a, b) => a - b);
  const at = q => Number(times[Math.ceil(times.length * q) - 1].toFixed(3));
  console.log(JSON.stringify({ measurement: label, runtime: 'local workerd process CPU (all threads, including D1 simulator)', samples, medianMs: at(0.5), p95Ms: at(0.95), maxMs: at(1) }));
}
function delayedUpload(token) {
  const request = httpRequest(base + '/api/sync', { method: 'PUT', headers: { 'X-Custom-Pomodoro': '1', Authorization: 'Bearer ' + token } });
  const response = new Promise((resolve, reject) => { request.on('response', async res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); request.on('error', reject); });
  request.write('{"entries":[');
  return { finish() { request.end(JSON.stringify({ key: 'notes', value: 'delayed attacker write', updatedAt: Date.now() }) + ']}'); return response; } };
}
function command(args) {
  const result = spawnSync(cli[0], [...cli.slice(1), ...args], { cwd: root, env, encoding: 'utf8', timeout: 60_000 });
  if (result.status !== 0) throw new Error('Local Wrangler command failed: ' + (result.stderr || result.error?.message || 'unknown error'));
}
try {
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
  // Fixture-only JWKS transport. The real Access verifier still checks signature,
  // issuer, audience, expiration, and allowed email. This entry is never deployed.
  await writeFile(join(scratch, 'entry.ts'), `const send = globalThis.fetch;\nglobalThis.fetch = (input, init) => String(input) === 'https://fixture.invalid/cdn-cgi/access/certs' ? Promise.resolve(Response.json({keys: [${JSON.stringify({ ...jwk, kid: 'fixture' })}]})) : send(input, init);\nexport { default } from ${JSON.stringify(join(root, 'worker/index.ts'))};\n`);
  const deployed = JSON.parse((await readFile(join(root, 'deploy/wrangler.jsonc'), 'utf8')).replace(/^\s*\/\/.*$/gm, ''));
  await writeFile(config, JSON.stringify({ name: 'cp-auth-local-test', main: './entry.ts', compatibility_date: deployed.compatibility_date, assets: { ...deployed.assets, directory: join(root, 'dist') }, vars: { ALLOWED_EMAILS: email, TEAM_DOMAIN: 'fixture.invalid', POLICY_AUD: 'fixture' }, d1_databases: [{ binding: 'DB', database_name: 'cp-auth-local-test', database_id: '00000000-0000-0000-0000-000000000018', migrations_dir: join(root, 'deploy/migrations') }] }));
  command(['d1', 'migrations', 'apply', 'cp-auth-local-test', '--local', '--config', config, '--persist-to', state]);
  const sql = join(scratch, 'user.sql');
  // Exercise exactly the provisioning CLI, passing only a generated test password.
  const provision = spawnSync(process.execPath, [join(root, 'scripts/set-password.mjs'), email], { input: password, encoding: 'utf8', env: { ...env, CP_PASSWORD: password } });
  assert.equal(provision.status, 0);
  assert.match(provision.stdout, /^INSERT OR REPLACE INTO users .*;\n$/);
  assert.equal(provision.stdout.includes(password), false);
  // Also verify the public helper remains compatible with the CLI output shape.
  assert.match(await passwordSQL(email, replacement), /^INSERT OR REPLACE INTO users /);
  await writeFile(sql, provision.stdout, { mode: 0o600 });
  command(['d1', 'execute', 'cp-auth-local-test', '--local', '--config', config, '--persist-to', state, '--file', sql]);
  server = spawn(cli[0], [...cli.slice(1), 'dev', '--local', '--config', config, '--persist-to', state, '--port', port, '--inspector-port', '0'], { env, cwd: root, stdio: 'ignore' });
  let ready = false;
  for (let i=0; i<100; i++) {
    try { await fetch(base + '/api/me'); ready = true; break; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  assert.equal(ready, true, 'Local Wrangler did not start');
  async function request(path, method = 'GET', body, headers = {}) {
    return fetch(base + path, { method, redirect: 'manual', headers: { 'X-Custom-Pomodoro': '1', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  const pids = workerdPids();
  await measureCPU('successful desktop login', async () => {
    const r = await request('/api/auth/login', 'POST', { email, password }, { 'X-Client': 'desktop' });
    assert.equal(r.status, 200); await r.json();
  }, pids);
  const login = await request('/api/auth/login', 'POST', { email, password }, { 'X-Client': 'desktop' });
  assert.equal(login.status, 200);
  const token = (await login.json()).token;
  const auth = { Authorization: 'Bearer ' + token };
  assert.equal((await request('/api/sync', 'PUT', { entries: [{ key: 'notes', value: 'local round trip', updatedAt: Date.now() }] }, auth)).status, 200);
  assert.equal((await (await request('/api/sync', 'GET', undefined, auth)).json()).entries[0].value, 'local round trip');
  assert.equal((await request('/api/auth/logout', 'POST', undefined, auth)).status, 200);
  assert.equal((await request('/api/me', 'GET', undefined, auth)).status, 401);
  assert.equal((await request('/account/reset/')).status, 401);
  for (const path of ['/reset', '/reset.html', '/reset/']) assert.equal((await request(path)).status, 404, path);
  const heavy = heavyStats();
  console.log(JSON.stringify({ measurement: 'heavy stats value', bytes: Buffer.byteLength(JSON.stringify(heavy)), chunks: heavy.chunks.length, tasks: heavy.tasksDone.length }));
  const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const content = encoded({ alg: 'RS256', kid: 'fixture' }) + '.' + encoded({ aud: 'fixture', iss: 'https://fixture.invalid', exp: Math.floor(Date.now()/1000)+300, email });
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(content));
  const access = { 'Cf-Access-Jwt-Assertion': content + '.' + Buffer.from(signature).toString('base64url') };
  const resetPage = await request('/account/reset/', 'GET', undefined, access);
  assert.equal(resetPage.status, 200); assert.equal(resetPage.headers.get('Location'), null);
  assert.match(await resetPage.text(), /Set a new password/);
  const beforeReset = await request('/api/auth/login', 'POST', { email, password }, { 'X-Client': 'desktop' });
  const oldToken = (await beforeReset.json()).token;
  const delayed = delayedUpload(oldToken);
  await new Promise(r => setTimeout(r, 100));
  assert.equal((await request('/account/reset/', 'POST', { password: replacement, confirm: replacement }, access)).status, 200);
  assert.equal(await delayed.finish(), 401, 'revoked token must not finish a delayed sync write');
  assert.equal((await request('/api/me', 'GET', undefined, { Authorization: 'Bearer ' + oldToken })).status, 401);
  assert.equal((await request('/api/auth/login', 'POST', { email, password })).status, 401);
  const renewed = await request('/api/auth/login', 'POST', { email, password: replacement }, { 'X-Client': 'desktop' });
  assert.equal(renewed.status, 200);
  const freshAuth = { Authorization: 'Bearer ' + (await renewed.json()).token };
  assert.equal((await (await request('/api/sync', 'GET', undefined, freshAuth)).json()).entries[0].value, 'local round trip');
  await measureCPU('heavy stats sync PUT', async () => {
    const r = await request('/api/sync', 'PUT', { entries: [{ key: 'stats', value: heavy, updatedAt: Date.now() }] }, freshAuth);
    assert.equal(r.status, 200); await r.json();
  }, pids, 10);
  assert.equal((await request('/api/sync', 'PUT', { entries: [{ key: 'notes', value: 'x'.repeat(2 * 1024 * 1024), updatedAt: Date.now() }] }, freshAuth)).status, 413);
  console.log('Local auth check passed: provision, login, sync PUT/GET, logout, Access-only reset HTML, delayed-body reset revocation, new login, heavy stats sync, oversized body rejection.');
} finally {
  if (server) { server.kill('SIGTERM'); await new Promise(r => { server.once('exit', r); setTimeout(r, 2000).unref(); }); }
  await rm(scratch, { recursive: true, force: true });
}
