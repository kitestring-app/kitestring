// Own muted headless Chrome and disposable profiles only.
// @ts-expect-error Shared JS harness has no declaration file.
import { Chrome } from '../../scripts/golden.mjs';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe.skipIf(process.env.PHONE_BROWSER !== '1')('optional deliberate stop', () => {
  const chrome = new Chrome(); let server: ViteDevServer, injection: string | undefined;
  const page = (body: string) => chrome.evaluate(`(async()=>{const s=await import('/src/state/settings.ts'),t=await import('/src/state/timer.ts'),o=await import('/src/state/stopOutcomes.ts'),h=await import('/src/state/stats.ts'),k=await import('/src/state/tasks.ts'),i=await import('/src/state/intent.ts'),b=await import('/src/lib/store.ts');${body}})()`);
  const owner = () => chrome.waitFor("import('/src/state/timer.ts').then(async t=>{await t.timerHydrationReady;return import('/src/lib/store.ts').then(b=>b.canWriteClockStore('timer'))})");
  const click = (text: string, parent = 'document') => chrome.evaluate(`[...${parent}.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(text)}).click()`);
  const snapshot = () => page('return {stats:h.stats.get(),tasks:k.tasks.get(),pin:i.intent.get()};');
  const start = async () => {
    await chrome.evaluate("document.querySelector('[aria-label=\"Start · Space\"]').click()");
    await page('t.timer.set({...t.timer.get(),elapsedBefore:5000});');
    await chrome.waitFor("document.querySelector('[aria-label=\"Stop session\"]')");
  };
  const stop = async () => { await chrome.evaluate("document.querySelector('[aria-label=\"Stop session\"]').click()"); await chrome.waitFor("document.querySelector('.stopped-card')"); };
  const seed = async (native = false) => {
    if (injection) await chrome.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection });
    await chrome.send('Page.navigate', { url: 'about:blank' }); await chrome.waitFor("location.href==='about:blank'");
    await chrome.send('Storage.clearDataForOrigin', { origin: chrome.origin, storageTypes: 'all' });
    const script = await chrome.send('Page.addScriptToEvaluateOnNewDocument', { source: `Date.now=()=>1800000000000;${native ? 'window.desktop={armAlarm:async()=>true,disarmAlarm(){},release(){},cancelSpeech(){},onLifecycle(){return()=>{}}};' : 'window.desktop=undefined;'}` }); injection = script.identifier;
    await chrome.send('Page.navigate', { url: chrome.origin }); await owner();
    await page("await s.calmFoundationReady;s.settingsUpdate('dash','focus');s.settingsUpdate('timer',{...s.CALM_PATCH,startChime:false,display:'hidden'});s.settingsUpdate('extras',{reduceMotion:true});k.tasks.set([{id:'task',title:'Open task',done:false,createdAt:Date.now()}]);k.focusPick.set('task');i.updateIntent({action:'Draft the opening',sufficientFinish:'Three rough paragraphs'});");
    await chrome.waitFor("document.querySelector('[aria-label=\"Start · Space\"]')");
  };
  beforeAll(async () => {
    server = await createServer({ configLoader: 'runner', server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, logLevel: 'error' });
    await server.listen(); const address = server.httpServer!.address(); if (!address || typeof address === 'string') throw Error('No server');
    chrome.origin = `http://127.0.0.1:${address.port}`; await chrome.start(); await chrome.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  }, 30000);
  afterAll(async () => { await chrome.close(); await server?.close(); });
  it.each([false, true])('preserves time/task/pin through label, Undo, reload and removal in every look (native=%s)', async native => {
    await seed(native); expect(await page('return o.stopAttempt.get();')).toBeNull();
    await start(); expect(await chrome.evaluate("!!document.querySelector('.stopped-card')")).toBe(false); await stop();
    const raw = await snapshot(); expect(raw.stats.chunks.reduce((n: number, c: { ms: number }) => n + c.ms, 0)).toBe(5000);
    const shots = process.env.SHOTS_DIR ?? join(tmpdir(), 'job93-stop-shots'); await mkdir(shots, { recursive: true });
    for (const width of [1280, 390, 320]) for (const look of ['classic', 'glass', 'sketch', 'companion', 'sunrise']) {
      await chrome.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: width < 500 });
      await page(`s.settingsUpdate('appearance',{look:'${look}'});`); await chrome.waitFor(`document.documentElement.dataset.look==='${look}'`);
      expect(await chrome.evaluate("document.querySelector('.stopped-card').textContent")).toContain('Record as deliberately stopped');
      expect(await chrome.evaluate("document.querySelector('.big-time')?.textContent ?? ''")).not.toMatch(/\d/);
      expect(await chrome.evaluate("(()=>{const r=document.querySelector('.stopped-card').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&document.documentElement.scrollWidth<=innerWidth})()")).toBe(true);
      if (width === 320 && !native) await writeFile(join(shots, `${look}-320.png`), await chrome.png());
    }
    await click('Record as deliberately stopped'); await chrome.waitFor("document.querySelector('.stopped-card [role=status]')?.textContent==='Label saved.'"); expect(await snapshot()).toEqual(raw);
    await click('Undo label'); await chrome.waitFor("!document.querySelector('.stopped-card [role=status]')"); expect(await page('return Object.keys(o.stopOutcomes.get()).length;')).toBe(0); expect(await snapshot()).toEqual(raw);
    await click('Record as deliberately stopped'); await chrome.waitFor("document.querySelector('.stopped-card [role=status]')");
    await page('await b.flushReadyStores();'); await chrome.reload("document.querySelector('.stopped-card [role=status]')"); await owner(); expect(await snapshot()).toEqual(raw);
    expect(await chrome.evaluate('!!window.desktop')).toBe(native);
    await page("s.settingsUpdate('extras',{hideStats:true});"); await chrome.waitFor("!document.querySelector('.stopped-card')");
    expect(await chrome.evaluate("!!document.querySelector('[aria-label=\"Start · Space\"]')")).toBe(true);
    await page("s.settingsUpdate('extras',{hideStats:false});s.settingsUpdate('lastTab','stats');");
    await chrome.evaluate("document.querySelector('[aria-label=\"Settings (S)\"]').click()"); await chrome.waitFor("document.querySelector('.focus-stats')");
    await click('Log'); await chrome.waitFor("document.querySelector('.stop-labels')");
    await click('Remove label', "document.querySelector('.stop-labels')"); await chrome.waitFor("!document.querySelector('.stop-labels')"); expect(await snapshot()).toEqual(raw); chrome.assertHealthy();
  }, 90000);
  it('keeps the offer and error after a rejected write, then permits keyboard retry', async () => {
    await seed(); await start(); await stop(); const raw = await snapshot();
    await page("await b.flushReadyStores();window.__stopTx=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(names,mode,...rest){if(mode==='readwrite')throw new DOMException('Rejected','QuotaExceededError');return window.__stopTx.call(this,names,mode,...rest)};");
    await click('Record as deliberately stopped'); await chrome.waitFor("document.querySelector('.stopped-card [role=alert]')");
    expect(await page('return Object.keys(o.stopOutcomes.get()).length;')).toBe(0); expect(await snapshot()).toEqual(raw);
    await chrome.evaluate("IDBDatabase.prototype.transaction=window.__stopTx;document.querySelector('.stopped-card .recovery-buttons button').focus()");
    await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
    await chrome.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await chrome.waitFor("document.querySelector('.stopped-card [role=status]')"); expect(await snapshot()).toEqual(raw); chrome.assertHealthy();
  });
  it('ordinary Stop needs no label and Hard mode still refuses it', async () => {
    await seed(); await start(); await stop(); expect(await page('return Object.keys(o.stopOutcomes.get()).length;')).toBe(0);
    await chrome.evaluate("document.querySelector('.stopped-card [aria-label=Close]').click()"); await chrome.waitFor("!document.querySelector('.stopped-card')");
    await start(); expect(await page('return o.stopAttempt.get();')).toBeNull();
    await page("s.settingsUpdate('timer',{hardMode:true});"); await chrome.waitFor("!document.querySelector('[aria-label=\"Stop session\"]')");
    expect(await page("return t.runTimerCommand('stop');")).toMatchObject({ ok: false, reason: 'hard-mode' });
    expect(await page('return o.stopAttempt.get();')).toBeNull(); expect(await page('return Object.keys(o.stopOutcomes.get()).length;')).toBe(0); chrome.assertHealthy();
  });
  it('keeps existing recovery ahead of the optional label without discarding it', async () => {
    await seed(); await page("i.updateIntent({action:'A'.repeat(500)});"); await start(); await stop(); const id = await page('return o.stopAttempt.get().id;');
    await chrome.send('Emulation.setDeviceMetricsOverride', { width:320,height:844,deviceScaleFactor:1,mobile:true });
    expect(await chrome.evaluate("(()=>{const r=document.querySelector('.stopped-card .recovery-buttons button').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&r.height>0})()")).toBe(true);
    await page("t.timer.set({...t.timer.get(),reentry:'return-here'});");
    await chrome.waitFor("!document.querySelector('.stopped-card') && !!document.querySelector('.recovery-card')");
    expect(await page('return o.stopAttempt.get().id;')).toBe(id);
    expect(await page("return t.requestRecovery(t.recoveryCommand(),'dismiss');")).toBe(true);
    await chrome.waitFor("document.querySelector('.stopped-card')"); expect(await page('return o.stopAttempt.get().id;')).toBe(id);
  });
  it('paginates labels and retains a failed deletion for retry', async () => {
    await seed(); await page("o.stopOutcomes.set(Object.fromEntries(Array.from({length:45},(_,n)=>['attempt-'+n,{id:'attempt-'+n,at:Date.now()-n,action:'Earlier action '+n}])));await b.flushReadyStores();s.settingsUpdate('lastTab','stats');");
    const raw = await snapshot(); await chrome.evaluate("document.querySelector('[aria-label=\"Settings (S)\"]').click()");
    await chrome.waitFor("document.querySelector('.focus-stats')"); await click('Log'); await chrome.waitFor("document.querySelectorAll('.stop-labels li').length===20");
    await click('Older'); expect(await chrome.evaluate("document.querySelectorAll('.stop-labels li').length")).toBe(20);
    await click('Older'); expect(await chrome.evaluate("document.querySelectorAll('.stop-labels li').length")).toBe(5);
    expect(await chrome.evaluate("[...document.querySelectorAll('.stop-labels button')].find(b=>b.textContent==='Older').disabled")).toBe(true);
    await click('Newer');
    await page("await b.flushReadyStores();window.__stopTx=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(names,mode,...rest){if(mode==='readwrite')throw new DOMException('Rejected','AbortError');return window.__stopTx.call(this,names,mode,...rest)};");
    await click('Remove label', "document.querySelector('.stop-labels')"); await chrome.waitFor("document.querySelector('.stop-labels [role=alert]')");
    expect(await page('return Object.keys(o.stopOutcomes.get()).length;')).toBe(45); expect(await snapshot()).toEqual(raw);
    await chrome.evaluate("IDBDatabase.prototype.transaction=window.__stopTx"); await click('Remove label', "document.querySelector('.stop-labels')");
    await chrome.waitFor("import('/src/state/stopOutcomes.ts').then(o=>Object.keys(o.stopOutcomes.get()).length===44)"); expect(await snapshot()).toEqual(raw); chrome.assertHealthy();
  });

});
