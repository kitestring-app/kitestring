import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import alertFiles from '../desktop/alert-files.cjs';

// Exercise the real request callback without opening sockets, touching a profile, or running native tools.
async function harness(headers = "/*\n  Content-Security-Policy: default-src 'none'; script-src 'self'\n") {
  let handler;
  const source = readFileSync(new URL('./companion.mjs', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '')
    .replaceAll('import.meta.url', JSON.stringify(new URL('./companion.mjs', import.meta.url).href));
  const context = {
    ...path, URL, Buffer, alertFiles, console: { log() {} },
    process: { argv: ['node', 'companion.mjs'] },
    fileURLToPath: () => '/fixture/scripts/companion.mjs', homedir: () => '/fixture/home',
    realpath: async value => value, mkdirSync() {}, writeFileSync() {}, existsSync: () => true,
    readFileSync() { throw new Error('no saved alarm'); },
    readFile: async file => file.endsWith('_headers') ? headers : Buffer.from('fixture'),
    execFile() { throw new Error('native execution is outside this test'); },
    createServer: fn => { handler = fn; return { listen() {} }; },
    setTimeout, clearTimeout,
  };
  await vm.runInNewContext(`(async () => {${source}\n})()`, context);
  return async url => {
    const reply = { code: null, headers: {}, body: null };
    const res = {
      writeHead(code, headers) { reply.code = code; reply.headers = headers; return this; },
      end(body) { reply.body = body; },
    };
    await handler({ url, method: 'GET', headers: { host: '127.0.0.1:4747' } }, res);
    return reply;
  };
}

test('malformed URL encodings return 400 and the companion keeps serving', async () => {
  const request = await harness();
  for (const url of ['/%', '/%E0%A4%A', '/%00', '/%5c', 'http://[invalid']) {
    assert.equal((await request(url)).code, 400, url);
  }
  assert.equal((await request('/')).code, 200);
  assert.equal((await request('/api/health')).code, 200);
});

test('the built CSP applies to static files, API responses and errors', async () => {
  const request = await harness();
  for (const url of ['/', '/assets/app.js', '/api/health', '/%']) {
    assert.equal((await request(url)).headers['Content-Security-Policy'], "default-src 'none'; script-src 'self'");
  }
});

test('missing CSP prevents companion startup', async () => {
  await assert.rejects(harness('/*\n  X-Frame-Options: DENY\n'), /missing its Content-Security-Policy/);
});
