// Only disposable muted Chrome profiles are controlled.
// @ts-expect-error Existing JavaScript harness has no declarations.
import { Chrome } from '../../scripts/golden.mjs';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe.skipIf(process.env.PHONE_BROWSER !== '1')('separate transition allowance', () => {
  const chrome = new Chrome(); let server: ViteDevServer; let injection: string | undefined;
  const page = (body: string) => chrome.evaluate(`(async()=>{const s=await import('/src/state/settings.ts'),k=await import('/src/state/tasks.ts'),t=await import('/src/state/timer.ts'),h=await import('/src/state/stats.ts'),b=await import('/src/lib/store.ts');${body}})()`);
  const owner = () => chrome.waitFor("import('/src/state/timer.ts').then(async t=>{await t.timerHydrationReady;return import('/src/lib/store.ts').then(b=>b.canWriteClockStore('timer'))})");
  const key = async (key: string, code = key, windowsVirtualKeyCode = 0) => {
    await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
    await chrome.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
  };
  const input = (value: string) => chrome.evaluate(`(()=>{const e=document.querySelector('.tasks-allowance input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.focus()})()`);
  const open = async () => {
    await chrome.evaluate("document.querySelector('[data-task-id=new] .task-eta').click()");
    await chrome.waitFor("document.querySelector('.tasks-allowance summary')");
    await chrome.evaluate("document.querySelector('.tasks-allowance summary').click()");
    await chrome.waitFor("document.querySelector('.tasks-allowance').open");
  };
  const submit = () => chrome.evaluate("document.querySelector('.tasks-allowance form').requestSubmit()");
  const seed = async (native = false) => {
    if (injection) await chrome.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection });
    await chrome.send('Page.navigate', { url: 'about:blank' });
    await chrome.waitFor("location.href==='about:blank'");
    await chrome.send('Storage.clearDataForOrigin', { origin: chrome.origin, storageTypes: 'all' });
    const script = await chrome.send('Page.addScriptToEvaluateOnNewDocument', { source: native ? 'window.desktop={armAlarm:async()=>true,disarmAlarm(){},release(){},cancelSpeech(){},onLifecycle(){return()=>{}}};' : 'window.desktop=undefined;' });
    injection = script.identifier;
    await chrome.send('Page.navigate', { url: chrome.origin }); await owner();
    await page("await s.calmFoundationReady;s.settingsUpdate('dash','focus');s.settingsUpdate('timer',{...s.CALM_PATCH,display:'hidden',taskEta:true});s.settingsUpdate('extras',{reduceMotion:true});k.tasks.set([{id:'new',title:'Draft outline',done:false,etaMin:20,createdAt:Date.now()},{id:'old',title:'Draft outline',done:true,etaMin:20,createdAt:Date.now()}]);h.stats.set({chunks:[{id:'old-work',taskId:'old',kind:'focus',segment:'focus',start:Date.now()-900000,ms:900000,completed:false}],tasksDone:[]});");
    await chrome.evaluate("document.querySelector('[data-panel=tasks]').click()");
    await chrome.waitFor("document.querySelector('[data-task-id=new] .task-eta')");
  };
  const reload = async () => {
    await page('await b.flushReadyStores();'); await chrome.reload("document.querySelector('.next-action')"); await owner();
    await chrome.evaluate("(()=>{const b=document.querySelector('[data-panel=tasks]');if(b.getAttribute('aria-pressed')!=='true')b.click()})()");
    await chrome.waitFor("document.querySelector('[data-task-id=new] .task-transition')");
  };
  beforeAll(async () => {
    server = await createServer({ configLoader: 'runner', server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, logLevel: 'error' });
    await server.listen(); const address = server.httpServer!.address(); if (!address || typeof address === 'string') throw Error('No server');
    chrome.origin = `http://127.0.0.1:${address.port}`; await chrome.start();
    await chrome.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  }, 30000);
  afterAll(async () => { await chrome.close(); await server?.close(); });
  it.each([false, true])('keeps work, allowance and credit separate in every look and Hidden (native=%s)', async native => {
    await seed(native); await page('t.timerActions.start();');
    const total = await page('return t.totalMs();'), history = await page('return JSON.stringify(h.stats.get());');
    expect(total).toBe(20 * 60000);
    await open(); await input('10'); await submit(); await chrome.waitFor("!document.querySelector('.tasks-popover')");
    expect(await chrome.evaluate("document.activeElement.getAttribute('aria-label')")).toBe('Estimate for Draft outline');
    expect(await page('return t.totalMs();')).toBe(total); expect(await page('return JSON.stringify(h.stats.get());')).toBe(history);
    const shots = process.env.SHOTS_DIR ?? join(tmpdir(), 'job93-allowance-shots'); await mkdir(shots, { recursive: true });
    for (const width of [1280, 390, 320]) for (const look of ['classic', 'glass', 'sketch', 'companion', 'sunrise']) {
      await chrome.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: width < 500 });
      await page(`s.settingsUpdate('appearance',{look:'${look}'});`);
      await chrome.waitFor(`document.documentElement.dataset.look==='${look}'`);
      expect(await chrome.evaluate("document.querySelector('[data-task-id=new] .task-transition').textContent")).toBe('Work guess 20 min; transition allowance 10 min');
      expect(await chrome.evaluate("document.querySelector('.tasks-summary').textContent")).not.toMatch(/remaining|Done by|current focus progress/);
      expect(await chrome.evaluate('document.documentElement.scrollWidth<=innerWidth')).toBe(true);
      await open();
      const bounds = await chrome.evaluate("(()=>{const r=document.querySelector('.tasks-popover').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,w:innerWidth,h:innerHeight}})()");
      expect(bounds.left).toBeGreaterThanOrEqual(8); expect(bounds.right).toBeLessThanOrEqual(bounds.w - 8);
      expect(bounds.top).toBeGreaterThanOrEqual(8); expect(bounds.bottom).toBeLessThanOrEqual(bounds.h - 8);
      if (!native && width === 320) await writeFile(join(shots, `${look}-320.png`), await chrome.png());
      await key('Escape'); await chrome.waitFor("!document.querySelector('.tasks-popover')");
    }
    await open();
    for (const bad of ['-1', '241', '1.5']) {
      await input(bad); await submit(); await chrome.waitFor("document.querySelector('.tasks-allowance [role=alert]')");
      expect(await chrome.evaluate("document.querySelector('.tasks-allowance input').value")).toBe(bad);
      expect(await page("return k.tasks.get().find(t=>t.id==='new').transitionAllowanceMin;")).toBe(10);
    }
    await input('0'); await key('Enter', 'Enter', 13); await chrome.waitFor("!document.querySelector('.tasks-popover')");
    expect(await chrome.evaluate("document.querySelector('[data-task-id=new] .task-transition').textContent")).toContain('allowance 0 min');
    await reload();
    expect(await chrome.evaluate('!!window.desktop')).toBe(native);
    expect(await page("return k.tasks.get().find(t=>t.id==='new').transitionAllowanceMin;")).toBe(0);
    await open(); await input(''); await submit(); await chrome.waitFor("!document.querySelector('.tasks-popover')");
    expect(await chrome.evaluate("document.querySelector('[data-task-id=new] .task-transition')")).toBeNull();
    expect(await page("return k.tasks.get().find(t=>t.id==='new').etaMin;")).toBe(20);
    await page('t.timerActions.stop();await b.flushReadyStores();'); chrome.assertHealthy();
  }, 30000);
  it('retains a rejected draft, blocks Escape during the write, and retries to disk', async () => {
    await seed(); await open(); await input('13');
    await chrome.evaluate("window.allowanceTransaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){if(args[1]==='readwrite')throw new DOMException('Storage full','QuotaExceededError');return window.allowanceTransaction.apply(this,args)};document.querySelector('.tasks-allowance form').requestSubmit();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));");
    await chrome.waitFor("document.querySelector('.tasks-allowance [role=alert]')");
    expect(await chrome.evaluate("document.querySelector('.tasks-allowance input').value")).toBe('13');
    expect(await page("return k.tasks.get().find(t=>t.id==='new').transitionAllowanceMin??null;")).toBeNull();
    await chrome.evaluate('IDBDatabase.prototype.transaction=window.allowanceTransaction;delete window.allowanceTransaction;');
    await submit(); await chrome.waitFor("!document.querySelector('.tasks-popover')");
    await reload();
    expect(await page("return k.tasks.get().find(t=>t.id==='new').transitionAllowanceMin;")).toBe(13); chrome.assertHealthy();
  }, 30000);
  it('keeps hidden disclosure controls out of the Tab cycle', async () => {
    await chrome.evaluate("document.querySelector('[data-task-id=new] .task-eta').click()");
    await chrome.waitFor("document.querySelector('.tasks-allowance summary')");
    await chrome.evaluate("document.querySelector('.tasks-allowance summary').focus()"); await key('Tab', 'Tab', 9);
    expect(await chrome.evaluate('document.activeElement.textContent')).toBe('5');
    await key('Escape'); chrome.assertHealthy();
  });
});
