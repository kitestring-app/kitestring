// Reopens every old-name store through the renamed renderer at the same origin.
// Usage: node scripts/browser/rebrand-migration.mjs <immutable old checkout>
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import { Chrome } from '../golden.mjs';

const oldRoot = process.argv[2];
if (!oldRoot) throw new Error('Pass an immutable checkout of the pre-rename commit.');
const chrome = new Chrome();
const cache = await mkdtemp(join(tmpdir(), 'kitestring-migration-vite-'));
let server;
async function serve(root, port = 0) {
  server = await createServer({ root: resolve(root), configLoader: 'runner', cacheDir: cache, server: { host: '127.0.0.1', port, strictPort: true, hmr: false, watch: null }, clearScreen: false, logLevel: 'error' });
  await server.listen();
  return server.httpServer.address().port;
}
async function open() {
  await chrome.send('Page.navigate', { url: chrome.origin });
  await chrome.waitFor("document.querySelector('.next-action') && document.readyState === 'complete'");
  await chrome.waitFor("import('/src/state/timer.ts').then(async t => { await t.timerHydrationReady; return (await import('/src/lib/store.ts')).canWriteClockStore('stats'); })");
}
const stores = async () => {
  const modules = await Promise.all([
    import('/src/state/settings.ts'), import('/src/state/timer.ts'), import('/src/state/tasks.ts'),
    import('/src/state/stats.ts'), import('/src/state/notes.ts'), import('/src/state/intent.ts'),
    import('/src/state/parked.ts'), import('/src/state/returnActivity.ts'), import('/src/state/tinyStarts.ts'),
    import('/src/state/parkingReview.ts'), import('/src/audio/mixer.ts'), import('/src/audio/radio.ts'), import('/src/data/themes.ts'),
  ]);
  const list = modules.flatMap(module => Object.values(module)).filter(value => value && typeof value.key === 'string' && typeof value.get === 'function' && typeof value.set === 'function' && value.ready);
  await Promise.all(list.map(store => store.ready));
  await modules[0].calmFoundationReady;
  await modules[0].localPreferencesReady;
  return { modules, list };
};
async function snapshot() {
  const { dbGet, dbKeys } = await import('/src/lib/db.ts');
  const result = {};
  for (const key of (await dbKeys()).sort()) {
    const value = await dbGet(key);
    result[key] = value instanceof Blob ? { type: value.type, bytes: Array.from(new Uint8Array(await value.arrayBuffer())) } : value;
  }
  return result;
}
try {
  const port = await serve(oldRoot);
  chrome.origin = `http://127.0.0.1:${port}`;
  await chrome.start();
  await chrome.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  // A frozen clock prevents return activity or timer recovery from changing across reloads.
  await chrome.send('Page.addScriptToEvaluateOnNewDocument', { source: `{
    const RealDate = Date, now = 1793006640000;
    globalThis.Date = new Proxy(RealDate, { construct: (target,args) => Reflect.construct(target,args.length ? args : [now]), get: (target,key) => key === 'now' ? () => now : Reflect.get(target,key) });
  }` });
  await open();
  const keys = await chrome.evaluate(`(async () => {
    const { modules, list } = await (${stores})();
    const [s, t, tasks, stats, notes, intent] = modules;
    s.settings.set({ ...s.settings.get(), extras: { ...s.settings.get().extras, displayName: 'Migration fixture' }, clock: { ...s.settings.get().clock, seconds: true } });
    tasks.tasks.set([{ id:'rename-task', title:'Keep this task', done:false, createdAt:Date.now(), etaMin:35 }]);
    tasks.focusPick.set('rename-task');
    stats.stats.set({chunks:[{id:'rename-session',kind:'focus',segment:'focus',start:Date.now()-600000,ms:600000,completed:true}],tasksDone:[]});
    notes.notes.set('Keep my notes.');
    intent.intent.set({action:'Keep the draft',why:'A useful next step',cue:'After tea',reward:'A short walk',rev:1,updatedAt:Date.now()});
    for (const store of list) store.set(store.get());
    await (await import('/src/lib/store.ts')).flushAll();
    await (await import('/src/lib/db.ts')).dbSet('sync-meta', { notes: Date.now() });
    await (await import('/src/lib/db.ts')).dbSet('sync-account', 'fixture@example.invalid');
    await (await import('/src/lib/db.ts')).dbSet('rename-unknown-future-key', {keep:true});
    await (await import('/src/lib/db.ts')).dbSet('bg:rename-image', new Blob(['image fixture'],{type:'image/png'}));
    localStorage.setItem('cp.rename-fixture','keep');
    return Object.keys(await (${snapshot})());
  })()`);
  await chrome.send('Page.navigate', { url: 'about:blank' });
  await chrome.waitFor("location.href === 'about:blank'");
  // Read after pagehide flushes, without the old app's background state updates.
  await chrome.send('Page.navigate', { url: chrome.origin + '/favicon.svg' });
  const before = await chrome.evaluate(`(${snapshot})()`);
  await chrome.send('Page.navigate', { url: 'about:blank' });
  await server.close();
  await rm(cache, { recursive: true, force: true });
  await serve(new URL('../..', import.meta.url).pathname, port);
  await open();
  await chrome.evaluate(`(${stores})()`);
  const after = await chrome.evaluate(`(${snapshot})()`);
  assert.deepEqual(after, before, 'every persisted key, including binary and unknown keys, stays intact');
  assert.equal(await chrome.evaluate("localStorage.getItem('cp.rename-fixture')"), 'keep');
  assert.equal(await chrome.evaluate('document.title'), 'Kitestring');
  const hydrated = await chrome.evaluate(`(async () => ({
    tasks: (await import('/src/state/tasks.ts')).tasks.get()[0].title,
    notes: (await import('/src/state/notes.ts')).notes.get(),
    action: (await import('/src/state/intent.ts')).intent.get().action,
    settings: (await import('/src/state/settings.ts')).settings.get().clock.seconds,
    stats: (await import('/src/state/stats.ts')).stats.get().chunks[0].ms
  }))()`);
  assert.deepEqual(hydrated, { tasks:'Keep this task', notes:'Keep my notes.', action:'Keep the draft', settings:true, stats:600000 });
  console.log(`PASS: old-name profile reopened with ${keys.length} keys intact, hydrated content, binary image, future key and cp.* localStorage preserved.`);
  console.log(keys.join(', '));
} finally {
  await chrome.close();
  await server?.close();
  await rm(cache, { recursive: true, force: true });
}
