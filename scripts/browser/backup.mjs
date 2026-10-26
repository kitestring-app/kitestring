// Job 49 UI evidence. Own headless Chrome, temporary profile, no personal browser.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'vite';
import { Chrome } from '../golden.mjs';

const shots = resolve(process.env.SHOTS_DIR || '.agents/jobs/49-shots');
const looks = ['classic', 'glass', 'sketch', 'companion', 'sunrise'];
const browser = new Chrome();
let server, cache;
const results = [];
async function click(text) {
  const found = await browser.evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); b?.click(); return !!b; })()`);
  assert.ok(found, `Missing button: ${text}`);
  await delay(60);
}
async function tick(label, checked, panel = '.data-file-panel') {
  await browser.evaluate(`(() => {
    const label = [...document.querySelectorAll(${JSON.stringify(panel + ' label')})].find(el => el.textContent.trim().startsWith(${JSON.stringify(label)}));
    if (!label) throw new Error('Missing switch: ' + ${JSON.stringify(label)});
    const input = label.querySelector('input'); if (input.checked !== ${checked}) input.click();
  })()`);
  await delay(40);
}
async function screenshot(name) {
  await browser.evaluate(`(async () => {
    const panel = document.querySelector('.data-file-panel'); panel.scrollIntoView({ block: 'start', behavior: 'instant' });
    const main = panel.closest('main'); main.scrollTop = Math.max(0, main.scrollTop - Math.max(0, 100 - panel.getBoundingClientRect().top));
    document.activeElement?.blur(); await document.fonts.ready;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  })()`);
  await delay(500);
  await writeFile(join(shots, name), await browser.png());
}
async function chooseFile(path) {
  const { root } = await browser.send('DOM.getDocument');
  const { nodeId } = await browser.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type="file"]' });
  await browser.send('DOM.setFileInputFiles', { nodeId, files: [path] });
}
try {
  await mkdir(shots, { recursive: true });
  cache = await mkdtemp(join(tmpdir(), 'pomodoro-job49-'));
  server = await createServer({ root: process.cwd(), configLoader: 'runner', cacheDir: join(cache, 'vite'), server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, clearScreen: false, logLevel: 'error' });
  await server.listen(); browser.origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  await browser.start();
  await browser.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  await browser.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: join(cache, 'downloads') });
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  for (const native of [false, true]) for (const look of looks) {
    await browser.send('Page.navigate', { url: 'about:blank' }); await browser.waitFor("location.href === 'about:blank'");
    await browser.send('Storage.clearDataForOrigin', { origin: browser.origin, storageTypes: 'all' });
    await browser.send('Page.navigate', { url: browser.origin });
    await browser.waitFor("document.querySelector('.next-action') && document.readyState === 'complete'");
    // Seed accounting only after the real timer owner has hydrated its stores.
    await browser.waitFor("import('/src/state/timer.ts').then(async t => { await t.timerHydrationReady; return (await import('/src/lib/store.ts')).canWriteClockStore('stats'); })");
    await browser.evaluate(`(async () => {
      ${native ? `const off = () => () => {}; const signedOut = async () => ({status:401,data:{ok:false}});
      window.desktop = { cloud:{ status:signedOut, request:signedOut, signIn:signedOut, signOut:signedOut, openReset:async()=>false },
        armAlarm:async()=>true, disarmAlarm(){}, cancelSpeech(){}, preventSleep(){}, setStatus(){}, publishTimerState(){}, publishAudioState(){},
        floatTimer:async()=>false, setFloatingPreferences:async()=>true, onFloatingPreferences:off, onFloatTimer:off, onLifecycle:off, onFlush:off,
        onMenuCommand:off, onTimerRequest:off, onTimerAction:off, onAudioAction:off, onAudioRequest:off };` : ''}
      const s = await import('/src/state/settings.ts'), p = await import('/src/lib/store.ts');
      const tasks = await import('/src/state/tasks.ts'), stats = await import('/src/state/stats.ts');
      const intent = await import('/src/state/intent.ts'), notes = await import('/src/state/notes.ts'), parked = await import('/src/state/parked.ts');
      await s.calmFoundationReady; await s.localPreferencesReady; await p.flushReadyStores();
      const value = structuredClone(s.DEFAULT_SETTINGS); value.appearance.look = ${JSON.stringify(look)};
      value.extras = { ...value.extras, reduceMotion:true, disableAnimated:true, displayName:'Sample person', defaultTab:'data' };
      value.timer = { ...value.timer, speak:false, notify:false, takeover:false, bringToFront:false, alertSound:'none', focusDoneSound:'none', breakOverSound:'none' };
      s.settings.set(value);
      tasks.tasks.set([{id:'task',title:'Keep my task',done:false,createdAt:Date.now()}]);
      stats.stats.set({chunks:[{id:'session',kind:'focus',segment:'focus',start:Date.now()-60000,ms:60000,completed:true}],tasksDone:[]});
      intent.updateIntent({action:'Keep my next action',why:'Small steps'}); notes.setNotesText('Keep my notes');
      parked.parked.set([{id:'thought',text:'Read later',at:Date.now(),segment:'focus',status:'open'}]);
      // A declared section without stored content is intentionally hidden by 5e5aad4.
      // Persist real data in each optional section so all four populated sections are exercised.
      const mixer = await import('/src/audio/mixer.ts'), radio = await import('/src/audio/radio.ts');
      await Promise.all([mixer.mixerStore.ready, radio.radioStore.ready, s.localPreferences.ready, s.floatingGlass.ready]);
      mixer.mixerStore.set({...mixer.mixerStore.get()}); radio.radioStore.set({...radio.radioStore.get()});
      s.localPreferences.set({...s.localPreferences.get()}); s.floatingGlass.set({...s.floatingGlass.get()});
      await p.flushReadyStores();
      const create = URL.createObjectURL.bind(URL); URL.createObjectURL = blob => { if (blob.type === 'application/json') window.__downloadText = blob.text(); return create(blob); };
      const aClick = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function() { if (this.download) window.__downloadName = this.download; return aClick.call(this); };
      const style = document.createElement('style'); style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'; document.head.append(style);
    })()`);
    await browser.waitFor(`document.documentElement.dataset.look === ${JSON.stringify(look)}`);
    await browser.evaluate(`document.querySelector('[aria-label="Settings (S)"]').click()`);
    await browser.waitFor(`document.querySelector('.drawer h1')?.textContent === 'Your data'`);
    await click('Export settings…');
    await browser.waitFor("document.querySelector('#settings-export')");
    const defaults = await browser.evaluate(`Array.from(document.querySelectorAll('#settings-export input')).map(x => ({checked:x.checked,disabled:x.disabled}))`);
    assert.deepEqual(defaults.map(x => x.checked), [true, false, false, false, false, false]);
    assert.equal(defaults[0].disabled, true);
    await click('Download settings file');
    await browser.waitFor("window.__downloadText && document.querySelector('.drawer [role=status]')?.textContent.includes('Exported')");
    const anonymous = JSON.parse(await browser.evaluate('window.__downloadText'));
    assert.deepEqual(anonymous.sections, ['settings']); assert.equal(anonymous.data.settings.extras.displayName, '');
    assert.match(await browser.evaluate('window.__downloadName'), /^kitestring-settings-\d{4}-\d{2}-\d{2}\.json$/);
    // 5e5aad4: full backups select the three optional content sections individually.
    for (const label of ['Sounds and mixes', 'This device’s options', 'Focus data']) await tick(label, true);
    await tick('Images', true);
    if (!native) await screenshot(`${look}-export.png`);
    await click('Download settings file'); await delay(100);
    const full = JSON.parse(await browser.evaluate('window.__downloadText'));
    assert.deepEqual(full.sections, ['settings','sounds','device','focus','images']); assert.deepEqual(full.images, []);
    await tick('Include my name', true); await click('Download settings file'); await delay(100);
    assert.equal(JSON.parse(await browser.evaluate('window.__downloadText')).data.settings.extras.displayName, 'Sample person');
    // Create an import candidate with visibly different values and focus contents.
    full.data.settings.sounds.master = 0.2; full.data.settings.appearance.look = look;
    full.data.tasks = []; full.data.intent = {action:'Imported action',why:'',rev:1,updatedAt:0};
    const candidate = join(cache, 'settings-v2.json'); await writeFile(candidate, JSON.stringify(full));
    await chooseFile(candidate);
    await browser.waitFor("document.querySelector('#settings-import-heading')");
    assert.equal(await browser.evaluate(`document.querySelector('.data-file-panel .help').textContent.includes('Version 2')`), true);
    assert.equal(await browser.evaluate(`document.querySelectorAll('.data-file-panel fieldset input:checked').length`), 4);
    const text = await browser.evaluate(`document.querySelector('.data-file-panel fieldset').textContent`);
    for (const count of ['0 tasks', '1 session', '1 parked thought', 'Notes']) assert.ok(text.includes(count), count);
    assert.equal(full.data.notes.length, 13);
    assert.equal(await browser.evaluate(`document.querySelector('.data-file-panel fieldset').textContent.includes('Images')`), false);
    if (!native) await screenshot(`${look}-import.png`);
    for (const label of ['Settings', 'Sounds and mixes', 'This device’s options', 'Focus data']) await tick(label, false);
    assert.equal(await browser.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Import selected sections').disabled`), true);
    await tick('Settings', true);
    await click('Import selected sections');
    await browser.waitFor("document.querySelector('.drawer [role=status]')?.textContent.includes('Imported.')");
    // Let the actual reload occur, then read the hydrated stores and IndexedDB.
    await browser.waitFor("!document.querySelector('.drawer') && document.querySelector('.next-action')");
    const after = await browser.evaluate(`(async () => {
      const s=await import('/src/state/settings.ts'), t=await import('/src/state/tasks.ts'), i=await import('/src/state/intent.ts'), db=await import('/src/lib/db.ts');
      await Promise.all([s.settings.ready,t.tasks.ready,i.intent.ready]);
      return { master:s.settings.get().sounds.master,tasks:t.tasks.get().length,action:i.intent.get().action,stats:(await db.dbGet('stats')).chunks.length,notes:await db.dbGet('notes') };
    })()`);
    assert.deepEqual(after, {master:0.2,tasks:1,action:'Keep my next action',stats:1,notes:'Keep my notes'});
    // Legacy file preview, cancellation, and validation failure must never apply.
    await browser.evaluate(`document.querySelector('[aria-label="Settings (S)"]').click()`);
    await browser.waitFor("document.querySelector('.drawer h1')?.textContent === 'Your data'");
    const legacy = join(cache, 'settings-v1.json'); await writeFile(legacy, await readFile('src/lib/fixtures/backup-v1.json'));
    await chooseFile(legacy); await browser.waitFor("document.querySelector('#settings-import-heading')");
    assert.ok((await browser.evaluate("document.querySelector('.data-file-panel').textContent")).includes('Export date not recorded'));
    await click('Cancel import');
    const invalid = join(cache, 'invalid.json'); await writeFile(invalid, '{"format":"custom-pomodoro-backup","version":2}');
    await chooseFile(invalid); await browser.waitFor("document.querySelector('.drawer [role=status]')?.textContent.includes('Nothing was changed')");
    assert.equal(await browser.evaluate("!!document.querySelector('#settings-import-heading')"), false);
    browser.assertHealthy();
    results.push({look, renderer:native?'shared renderer with inert Mac bridge':'web',passed:true});
    console.log(`PASS ${native?'Mac renderer':'web'} ${look}`);
  }
  await writeFile(join(shots, 'browser-results.json'), JSON.stringify({browser:browser.version,results,blockedOrigins:[...browser.blocked]},null,2)+'\n');
} catch (error) {
  console.error(error);
  console.error(await browser.evaluate(`({status:document.querySelector('.drawer [role=status]')?.textContent,panels:[...document.querySelectorAll('.data-file-panel')].map(x=>x.textContent),download:!!window.__downloadText})`).catch(()=>null));
  throw error;
} finally {
  await browser.close(); await server?.close(); if(cache) await rm(cache,{recursive:true,force:true});
}
