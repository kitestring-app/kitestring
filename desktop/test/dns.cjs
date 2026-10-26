const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createDns, registerDns, validDnsUrl } = require('../dns.cjs');

test('fresh install uses system DNS; opted-in HTTPS DNS persists only on this device and can be cleared', async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'kitestring-dns-'));
  const calls = [];
  const app = { configureHostResolver: value => calls.push(value) };
  try {
    const dns = createDns({ app, userData });
    await dns.apply();
    assert.equal(dns.get(), '');
    assert.deepEqual(calls, [{ secureDnsMode: 'off' }]);
    assert.equal(await dns.set('https://resolver.example.invalid/dns-query'), true);
    const restored = createDns({ app, userData });
    assert.equal(restored.get(), 'https://resolver.example.invalid/dns-query');
    await restored.apply();
    assert.deepEqual(calls.at(-1), { secureDnsMode: 'secure', secureDnsServers: [restored.get()] });
    assert.equal(await restored.set(''), true);
    assert.equal(createDns({ app, userData }).get(), '');
    assert.deepEqual(calls.at(-1), { secureDnsMode: 'off' });
    writeFileSync(path.join(userData, 'secure-dns.json'), '{bad json');
    assert.equal(createDns({ app, userData }).get(), '');
  } finally { rmSync(userData, { recursive: true, force: true }); }
});
test('DNS IPC accepts only trusted main frames and valid HTTPS endpoints', async () => {
  for (const value of [null, {}, 1, 'http://resolver.invalid', 'https://' + 'user:pass@resolver.invalid', 'https://resolver.invalid/#hash', 'invalid']) assert.equal(validDnsUrl(value), false);
  const handlers = new Map();
  const calls = [];
  registerDns({ handle: (key, fn) => handlers.set(key, fn) }, event => event.trusted, { get: () => '', set: value => calls.push(value) });
  assert.equal(await handlers.get('desktop:dns-get')({ trusted: false }), null);
  assert.equal(await handlers.get('desktop:dns-set')({ trusted: false }, 'https://resolver.invalid'), false);
  assert.deepEqual(calls, []);
  assert.equal(await handlers.get('desktop:dns-get')({ trusted: true }), '');
});
