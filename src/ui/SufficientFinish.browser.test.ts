// Disposable headless Chrome only.
// @ts-expect-error Existing JavaScript harness has no declaration file.
import { Chrome } from '../../scripts/golden.mjs';
import { assertFocusFit } from './focusLayout.browser';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe.skipIf(process.env.PHONE_BROWSER !== '1')('optional sufficient finish', () => {
  const chrome = new Chrome(); let server: ViteDevServer;
  const page = (body: string) => chrome.evaluate(`(async()=>{const s=await import('/src/state/settings.ts'),
    i=await import('/src/state/intent.ts'),t=await import('/src/state/timer.ts');${body}})()`);
  const owner = () => chrome.waitFor("import('/src/state/timer.ts').then(async t=>{await t.timerHydrationReady;return import('/src/lib/store.ts').then(f=>f.canWriteClockStore('timer'))})");
  const click = (label: string) => chrome.evaluate(`(()=>{const b=[...document.querySelectorAll('.next-action button')].find(b=>b.textContent===${JSON.stringify(label)});b.click()})()`);
  const input = (selector: string, value: string) => chrome.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.focus()})()`);
  const key = async (key: string, code = key) => {
    await chrome.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code });
    await chrome.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code });
  };
  beforeAll(async () => {
    server = await createServer({ configLoader: 'runner', server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, logLevel: 'error' });
    await server.listen(); const address = server.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('No server');
    chrome.origin = `http://127.0.0.1:${address.port}`; await chrome.start();
    await chrome.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  }, 30000);
  afterAll(async () => { await chrome.close(); await server?.close(); });
  it.each([false, true])('optional, keyboard saved, persistent and ungraded (native bridge=%s)', async native => {
    await chrome.send('Page.navigate', { url: 'about:blank' });
    await chrome.send('Storage.clearDataForOrigin', { origin: chrome.origin, storageTypes: 'all' });
    const script = await chrome.send('Page.addScriptToEvaluateOnNewDocument', { source: native
      ? 'window.desktop={armAlarm:async()=>true,disarmAlarm(){},release(){},cancelSpeech(){},onLifecycle(){return()=>{}}};' : 'window.desktop=undefined;' });
    await chrome.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await chrome.send('Page.navigate', { url: chrome.origin }); await owner();
    await page("await s.calmFoundationReady;s.settingsUpdate('dash','focus');s.settingsUpdate('timer',{...s.CALM_PATCH,display:'hidden'});s.settingsUpdate('extras',{reduceMotion:true});");
    await chrome.waitFor("document.querySelector('.next-action')");
    expect(await chrome.evaluate("document.querySelector('.next-action-finish')")).toBeNull();
    await chrome.evaluate("document.querySelector('[aria-label=\"Start · Space\"]').click()");
    await chrome.waitFor("import('/src/state/timer.ts').then(t=>t.timer.get().startedAt!==null)");
    await page('t.timerActions.stop();');
    await click('Pin a next action');
    expect(await chrome.evaluate("document.querySelector('.next-action details').open")).toBe(false);
    await input('.next-action input', 'Draft the introduction');
    await chrome.evaluate("document.querySelector('.next-action summary').focus()"); await key(' ', 'Space');
    await chrome.waitFor("document.querySelector('.next-action details').open");
    await input('.next-action details input', 'Three rough paragraphs is enough for this pass'); await key('Enter');
    await chrome.waitFor("document.querySelector('.next-action-finish')?.textContent.includes('Three rough paragraphs') && !document.querySelector('.next-action input')");
    expect(await chrome.evaluate('document.activeElement.textContent')).toBe('Edit next action');
    await page("await (await import('/src/lib/store.ts')).flushReadyStores();");
    await chrome.reload("document.querySelector('.next-action-finish')"); await owner();
    expect(await page("return s.settings.get().timer.display;")).toBe("hidden");
    const shots = process.env.SHOTS_DIR ?? join(tmpdir(), 'job93-enough-shots'); await mkdir(shots, { recursive: true });
    for (const width of [1280, 390, 320]) for (const look of ['classic', 'glass', 'sketch', 'companion', 'sunrise']) {
      await chrome.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: width < 500 });
      await page(`s.settingsUpdate('appearance',{look:'${look}'});`);
      await chrome.waitFor(`document.documentElement.dataset.look==='${look}'`);
      expect(await chrome.evaluate("document.querySelector('.next-action-finish').textContent")).toContain('Three rough paragraphs');
      expect(await chrome.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
      await assertFocusFit((expression: string) => chrome.evaluate(expression));
      if (!native && width === 320) {
        await writeFile(join(shots, `${look}-320.png`), await chrome.png());
        await click('Edit next action');
        await chrome.evaluate("document.querySelector('.next-action details').open=true");
        await chrome.evaluate("document.querySelector('.next-action details input').scrollIntoView({block:'nearest'})");
        expect(await chrome.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true);
        await writeFile(join(shots, `${look}-editor-320.png`), await chrome.png());
        await chrome.evaluate("document.querySelector('.next-action details input').focus()");
        await key('Tab');
        expect(await chrome.evaluate('document.activeElement.textContent')).toBe('Done');
        expect(await chrome.evaluate("(()=>{const r=document.activeElement.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()")).toBe(true);
        await key('Escape'); await chrome.waitFor("!document.querySelector('.next-action input')");
      }
    }
    await click('Edit next action'); await input('.next-action input', 'A revised action'); await key('Escape');
    await chrome.waitFor("!document.querySelector('.next-action input')");
    expect(await page('return i.intent.get().sufficientFinish;')).toBe('');
    await page("i.updateIntent({sufficientFinish:'No proof needed'});");
    await click('Finish action');
    expect(await page('return i.intent.get().action;')).toBe('');
    expect(await page("return (await import('/src/state/tasks.ts')).tasks.get().filter(t=>t.done).length;")).toBe(0);
    await chrome.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: script.identifier }); chrome.assertHealthy();
  }, 30000);
  it.each(["Enter", "Escape"])("%s used for composition leaves the editor open", async key => {
    await chrome.send('Page.navigate', { url: chrome.origin }); await owner();
    await page("await s.calmFoundationReady;s.settingsUpdate('dash','focus');i.updateIntent({action:'Draft'});");
    await chrome.waitFor("document.querySelector('.next-action')"); await click('Edit next action');
    expect(await chrome.evaluate(`document.querySelector('.next-action input').dispatchEvent(new KeyboardEvent('keydown',
      {key:${JSON.stringify(key)},bubbles:true,cancelable:true,isComposing:true}))`)).toBe(true);
    await chrome.evaluate('new Promise(resolve=>requestAnimationFrame(resolve))');
    expect(await chrome.evaluate("!!document.querySelector('.next-action input')")).toBe(true);
    await chrome.evaluate("document.querySelector('.next-action button').click()");
    await chrome.waitFor("!document.querySelector('.next-action input')");
  });
  it.each(["Three paragraphs", ""])("keeps the original criterion in Hidden recovery after editing it to %j", async sufficientFinish => {
    await chrome.send('Page.navigate', { url: chrome.origin }); await owner();
    await page(`await s.calmFoundationReady;s.settingsUpdate('dash','focus');s.settingsUpdate('timer',{...s.CALM_PATCH,display:'hidden'});
      t.timerActions.stop();i.updateIntent({action:'Draft',sufficientFinish:'One paragraph'});t.timerActions.start();
      i.updateIntent({sufficientFinish:${JSON.stringify(sufficientFinish)}});t.timerActions.pause();`);
    await chrome.waitFor("document.querySelector('[aria-label=\"Session context\"]')");
    expect(await chrome.evaluate("document.querySelector('.recovery-card').textContent")).toContain('One paragraph');
    expect(await page('return i.intent.get().sufficientFinish;')).toBe(sufficientFinish);
    await page('t.timerActions.stop();');
  });
  it('retains a failed draft on Escape and retries it without overwriting saved text', async () => {
    await page("i.updateIntent({action:'Draft',sufficientFinish:'One paragraph'});await (await import('/src/lib/store.ts')).flushReadyStores();");
    await click('Edit next action');
    await chrome.evaluate("document.querySelector('.next-action details').open=true;window.originalTransaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){if(args[1]==='readwrite')throw new DOMException('Storage is full','QuotaExceededError');return window.originalTransaction.apply(this,args)}");
    await input('.next-action details input', 'Three paragraphs'); await key('Escape');
    await chrome.waitFor("document.querySelector('.next-action [role=alert]')");
    expect(await chrome.evaluate("document.querySelector('.next-action details input').value")).toBe('Three paragraphs');
    expect(await page('return i.intent.get().sufficientFinish;')).toBe('One paragraph');
    await chrome.evaluate('IDBDatabase.prototype.transaction=window.originalTransaction;delete window.originalTransaction;');
    await click('Done'); await chrome.waitFor("!document.querySelector('.next-action input')");
    await chrome.reload("document.querySelector('.next-action-finish')"); await owner();
    expect(await page('return i.intent.get().sufficientFinish;')).toBe('Three paragraphs'); chrome.assertHealthy();
  }, 30000);
});
