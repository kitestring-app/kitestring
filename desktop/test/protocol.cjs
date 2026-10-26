const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, mkdir, rm, symlink, readFile } = require('node:fs/promises');
const path = require('node:path');
const { createAppHandler } = require('../protocol.cjs');
let root;
let serve;
const request = (route, options) => new Request(`app://custom-pomodoro${route}`, options);
before(async () => {
  await mkdir(path.join(__dirname, '..', 'dist'), { recursive: true });
  root = await mkdtemp(path.join(__dirname, '..', 'dist', 'protocol-test-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><h1>Pomodoro</h1>');
  await writeFile(path.join(root, '_headers'), await readFile(path.join(__dirname, '..', '..', 'public', '_headers')));
  await writeFile(path.join(root, 'sound.ogg'), '0123456789');
  await writeFile(path.join(root, 'sound.wav'), 'wav');
  await writeFile(path.join(root, 'bundle.js'), 'export {};');
  await symlink(path.join(__dirname, '..'), path.join(root, 'escape'));
  serve = await createAppHandler(root);
});
after(async () => { if (root) await rm(root, { recursive: true, force: true }); });
test('serves the app and SPA routes with the exact web CSP and nosniff', async () => {
  const csp = (await readFile(path.join(root, '_headers'), 'utf8')).match(/Content-Security-Policy: (.+)/)[1];
  for (const route of ['/', '/index.html', '/focus', '/focus/today']) {
    const response = await serve(request(route));
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Pomodoro/);
    assert.equal(response.headers.get('Content-Security-Policy'), csp);
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.match(response.headers.get('Permissions-Policy'), /camera=\(\), microphone=\(\)/);
  }
});
test('serves correct MIME types, missing assets stay 404, HEAD stays empty', async () => {
  for (const [file, type] of [['sound.ogg', 'audio/ogg'], ['sound.wav', 'audio/wav'], ['bundle.js', 'text/javascript; charset=utf-8']]) {
    assert.equal((await serve(request(`/${file}`))).headers.get('Content-Type'), type);
  }
  assert.equal((await serve(request('/missing.js'))).status, 404);
  const head = await serve(request('/sound.ogg', { method: 'HEAD' }));
  assert.equal(head.headers.get('Content-Length'), '10');
  assert.equal(await head.text(), '');
});
test('supports media byte ranges and rejects invalid ranges', async () => {
  for (const [range, content] of [['bytes=2-4', '234'], ['bytes=7-', '789'], ['bytes=-3', '789'], ['bytes=8-99', '89']]) {
    const response = await serve(request('/sound.ogg', { headers: { Range: range } }));
    assert.equal(response.status, 206);
    assert.equal(await response.text(), content);
    assert.equal(response.headers.get('Content-Length'), String(content.length));
  }
  for (const range of ['bytes=12-', 'bytes=4-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,3-4', 'invalid', 'bytes=-9007199254740992', `bytes=-${'9'.repeat(400)}`, 'bytes=0-9007199254740992']) assert.equal((await serve(request('/sound.ogg', { headers: { Range: range } }))).status, 416, range);
  const suffix = await serve(request('/sound.ogg', { headers: { Range: 'bytes=-9007199254740991' } }));
  assert.equal(suffix.status, 206);
  assert.equal(await suffix.text(), '0123456789');
});
test('blocks foreign origins, methods, traversal, bad encodings and symlink escapes', async () => {
  assert.equal((await serve(new Request('app://evil/'))).status, 403);
  assert.equal((await serve(request('/', { method: 'POST' }))).status, 405);
  for (const route of ['/%2e%2e%2fsecret', '/%5csecret', '/%00', '/escape/package.json']) assert.equal((await serve(request(route))).status, 403, route);
  assert.equal((await serve(request('/%ZZ'))).status, 400);
});
test('fails closed when the packaged CSP is missing', async () => {
  const empty = path.join(root, 'empty');
  await mkdir(empty);
  await writeFile(path.join(empty, '_headers'), '');
  await assert.rejects(createAppHandler(empty), /Content-Security-Policy/);
});
