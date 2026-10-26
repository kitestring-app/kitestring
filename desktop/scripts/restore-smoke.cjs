const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtemp, rm, mkdir } = require('node:fs/promises');
const { once } = require('node:events');
const path = require('node:path');
const net = require('node:net');
const { connect, waitFor } = require('./cdp.cjs');

async function checkRestore() {
  const base = path.join(__dirname, '..');
  await mkdir(path.join(base, 'dist'), { recursive: true });
  const profile = await mkdtemp(path.join(base, 'dist', 'restore-profile-'));
  const binary = path.join(base, 'out/mac-arm64/Kitestring.app/Contents/MacOS/Kitestring');
  let child, cdp;
  async function launch() {
    const server = net.createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    child = spawn(binary, ['--smoke-test', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], { stdio: 'ignore' });
    const page = await waitFor('packaged restore page', async () => {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      return pages.find(page => page.url === 'app://custom-pomodoro/');
    }, { timeoutMs: 30000 });
    cdp = await connect(page.webSocketDebuggerUrl);
    await waitFor('timer controls', () => evaluate('!!document.querySelector(".tabs button") && !!window.__desktopSmokeQuit'));
    // Read behind the app's hydration requests, then wait for that saved state to render.
    const saved = await evaluate(`new Promise((resolve, reject) => {
      const req = indexedDB.open('custom-pomodoro', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => { const db = req.result; const tx = db.transaction('kv');
        const read = tx.objectStore('kv').get('timer'); read.onsuccess = () => resolve(read.result ?? null);
        tx.oncomplete = () => db.close(); };
    })`);
    await waitFor('hydrated timer and main leader', () => evaluate(`(async () => {
      const tabs = [...document.querySelectorAll('.tabs button')];
      const index = ${JSON.stringify(saved?.segment === 'short' ? 1 : saved?.segment === 'long' ? 2 : 0)};
      const running = ${JSON.stringify(saved?.startedAt != null)};
      return tabs[index]?.getAttribute('aria-pressed') === 'true' &&
        !!document.querySelector(running ? 'button[aria-label^="Pause"]' : 'button[aria-label^="Start"]') &&
        (await navigator.locks.query()).held.some(lock => lock.name === 'custom-pomodoro-leader');
    })()`));
  }
  async function evaluate(expression) {
    const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  async function quit(expression = '') {
    const exited = once(child, 'exit');
    void evaluate(`${expression}; window.__desktopSmokeQuit()`).catch(() => {});
    await Promise.race([exited, new Promise((_, reject) => { const t = setTimeout(() => reject(new Error('app.quit did not exit')), 8000); t.unref(); })]);
    cdp.socket.close();
  }
  try {
    await launch();
    await evaluate(`document.querySelectorAll('.tabs button')[1].click(); document.querySelector('button[aria-label^="Start"]').click()`);
    await waitFor('running break', () => evaluate('document.title.includes("Short break") && !document.title.includes("paused")'));
    // Establish the older saved value, then reset and quit inside the 150 ms debounce.
    await new Promise(resolve => setTimeout(resolve, 500));
    await evaluate(`new Promise(resolve => { const req = indexedDB.open('custom-pomodoro', 1); req.onsuccess = () => { const db = req.result; const tx = db.transaction('kv', 'readwrite'); const store = tx.objectStore('kv'); const end = Date.now() + 1000; const hold = () => { if (Date.now() < end) store.get('timer').onsuccess = hold; }; hold(); tx.oncomplete = () => db.close(); resolve(true); }; })`);
    await quit(`document.querySelectorAll('.tabs button')[0].click(); document.querySelector('button[aria-label^="Reset"]').click()`);
    await launch();
    const restored = await evaluate(`({ title: document.title, focus: document.querySelectorAll('.tabs button')[0].getAttribute('aria-pressed'), paused: !!document.querySelector('button[aria-label^="Start"]') })`);
    console.log('Restored after immediate reset + app.quit:', restored);
    await quit();
    if (process.argv.includes('--expect-stale')) assert.equal(restored.focus, 'false', 'Baseline must reproduce the stale break');
    else { assert.equal(restored.focus, 'true'); assert.equal(restored.paused, true); }
    return restored;
  } finally {
    cdp?.socket.close();
    if (child?.exitCode === null && child?.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; }
    await rm(profile, { recursive: true, force: true });
  }
}
module.exports = { checkRestore };
if (require.main === module) checkRestore().catch(error => { console.error(error); process.exitCode = 1; });
