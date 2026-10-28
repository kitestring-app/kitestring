const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readFile } = require('node:fs/promises');
const { createAppHandler } = require('../protocol.cjs');
const { isAppURL } = require('../security.cjs');

test('the bundled evidence page and return link stay on the permitted app origin', async () => {
  const origin = 'app://custom-pomodoro/';
  const url = new URL('./research.html', origin).href;
  assert.equal(isAppURL(url), true);
  const serve = await createAppHandler(path.join(__dirname, '../../public'));
  const response = await serve(new Request(url));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'text/html; charset=utf-8');
  const html = await response.text();
  assert.match(html, /<h1>Why it works this way<\/h1>/);
  assert.match(html, /href="\.\/"/);
  assert.equal(isAppURL(new URL('./', url).href), true);
  // The existing main-window policy permits same-origin navigation without opening a browser.
  const main = await readFile(path.join(__dirname, '../main.cjs'), 'utf8');
  assert.match(main, /if \(!isAppURL\(event.url \?\? url\)\) event.preventDefault\(\)/);
});
