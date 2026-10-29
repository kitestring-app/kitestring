// Disposable muted Chrome only.
// @ts-expect-error Shared JavaScript harness has no declaration file.
import { Chrome } from '../../../scripts/golden.mjs';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe.skipIf(process.env.NOTEPAD_BROWSER !== '1')('voluntary explain from memory', () => {
  const chrome = new Chrome(); let server: ViteDevServer;
  const page = (body: string) => chrome.evaluate(`(async()=>{const s=await import('/src/state/settings.ts'),n=await import('/src/state/notes.ts'),t=await import('/src/state/timer.ts');${body}})()`);
  const click = (label: string) => chrome.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===${JSON.stringify(label)});b.focus();b.click()})()`);
  const type = (text: string) => chrome.evaluate(`(()=>{const e=document.querySelector('.note-recall textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));e.focus()})()`);
  beforeAll(async () => {
    server = await createServer({ configLoader:'runner', server:{host:'127.0.0.1',port:0,hmr:false,watch:null},logLevel:'error' });
    await server.listen(); const address=server.httpServer!.address(); if(!address||typeof address==='string')throw new Error('No server');
    chrome.origin=`http://127.0.0.1:${address.port}`; await chrome.start();
    await chrome.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
  },30000);
  afterAll(async()=>{await chrome.close();await server?.close();});
  it.each([false,true])('user invoked, safe append, close/reload and five Hidden looks (native=%s)',async native=>{
    await chrome.send('Page.navigate',{url:'about:blank'});
    await chrome.send('Storage.clearDataForOrigin',{origin:chrome.origin,storageTypes:'all'});
    const script=await chrome.send('Page.addScriptToEvaluateOnNewDocument',{source:native?'window.desktop={armAlarm:async()=>true,disarmAlarm(){},release(){},cancelSpeech(){},onLifecycle(){return()=>{}}};':'window.desktop=undefined;'});
    await chrome.send('Page.navigate',{url:chrome.origin});
    await chrome.waitFor("import('/src/state/timer.ts').then(async t=>{await t.timerHydrationReady;return import('/src/lib/store.ts').then(f=>f.canWriteClockStore('timer'))})");
    await page("await s.calmFoundationReady;await n.notes.ready;s.settingsUpdate('dash','focus');s.settingsUpdate('timer',{...s.CALM_PATCH,display:'hidden'});s.settingsUpdate('extras',{reduceMotion:true});n.setNotesText('Original');t.timerActions.start();");
    await chrome.waitFor("document.querySelector('[aria-label=\"Pause · Space\"]')");
    expect(await chrome.evaluate("document.querySelector('.note-recall')")).toBeNull();
    expect(await chrome.evaluate("[...document.querySelectorAll('button')].some(b=>b.textContent==='Explain from memory in Notes')")).toBe(false);
    await page('t.timerActions.pause();');
    await chrome.waitFor("[...document.querySelectorAll('button')].some(b=>b.textContent==='Explain from memory in Notes')");
    await click('Explain from memory in Notes');await chrome.waitFor("document.querySelector('.note-recall textarea')===document.activeElement");
    expect(await chrome.evaluate("document.querySelector('.note-recall').textContent")).toContain('exports that include Focus data');
    expect(await chrome.evaluate("document.querySelector('.note-recall button[type=submit]').disabled")).toBe(true);
    const shots=process.env.SHOTS_DIR??join(tmpdir(),'job94-recall');await mkdir(shots,{recursive:true});
    for(const width of [1280,390,320])for(const look of ['classic','glass','sketch','companion','sunrise']){
      await chrome.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<500});
      await page(`s.settingsUpdate('appearance',{look:'${look}'});`);
      await chrome.waitFor(`document.documentElement.dataset.look==='${look}'`);
      expect(await chrome.evaluate('document.documentElement.scrollWidth<=innerWidth')).toBe(true);
      await chrome.evaluate("document.querySelector('.note-recall button[type=submit]').scrollIntoView({block:'nearest'})");
      expect(await chrome.evaluate("(()=>{const r=document.querySelector('.note-recall button[type=submit]').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()")).toBe(true);
      if(!native&&width===320)await writeFile(join(shots,`${look}-recall.png`),await chrome.png());
    }
    await type('My explanation');await page(`n.setNotesText(${JSON.stringify("Original\nNewer edit")});`);
    await click('Save to Notes');await chrome.waitFor("document.querySelector('.note-recall [role=status]')");
    expect(await page('return n.notes.get();')).toBe('Original\nNewer edit\n\n## Explain from memory\nMy explanation');
    await chrome.send('Emulation.setDeviceMetricsOverride',{width:1280,height:844,deviceScaleFactor:1,mobile:false});
    await click('Explain from memory in Notes');
    await chrome.waitFor("document.querySelector('.note-recall textarea')");
    await type('Keep this draft');await click('Close practice');await click('Explain from memory in Notes');
    await chrome.waitFor("document.querySelector('.note-recall textarea')?.value==='Keep this draft'");
    await click('Close practice');
    await chrome.evaluate("document.querySelector('[aria-label^=\"Close notepad\"]').click()");
    await chrome.waitFor("document.activeElement?.textContent==='Explain from memory in Notes'").catch(async (error: unknown) => { throw new Error(String(error) + ' Active: ' + await chrome.evaluate("document.activeElement.outerHTML")); });
    await page("await (await import('/src/lib/store.ts')).flushReadyStores();");
    await chrome.reload("document.querySelector('[data-panel=notes]')");
    await chrome.evaluate("document.querySelector('[data-panel=notes]').click()");
    await chrome.waitFor("document.querySelector('.note-source')?.value.includes('My explanation')");
    expect(await chrome.evaluate("document.querySelector('.note-recall textarea')")).toBeNull();
    await click('Explain from memory');await type('Skipped draft');
    await chrome.waitFor("import('/src/lib/alertTypingGuard.ts').then(g=>!g.alertTypingGuard.pending())");
    expect(await chrome.evaluate("document.activeElement.matches('.note-recall textarea')")).toBe(true);
    await chrome.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
    await chrome.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
    await chrome.waitFor("!document.querySelector('.note-recall textarea')");
    expect(await chrome.evaluate('document.activeElement.textContent')).toBe('Explain from memory');
    expect(await page('return n.notes.get();')).not.toContain('Skipped draft');
    await chrome.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:script.identifier});chrome.assertHealthy();
  },30000);
  it('keeps a failed or over-cap draft for retry without overwriting Notes',async()=>{
    await click('Explain from memory');await type('Retry explanation');
    await page("n.setNotesText('Keep');await (await import('/src/lib/store.ts')).flushReadyStores();");
    await chrome.evaluate("window.originalTransaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){if(args[1]==='readwrite')throw new DOMException('Full','QuotaExceededError');return window.originalTransaction.apply(this,args)}");
    await click('Save to Notes');await chrome.waitFor("document.querySelector('.note-recall [role=alert]')");
    expect(await chrome.evaluate("document.querySelector('.note-recall textarea').value")).toBe('Retry explanation');
    expect(await page('return n.notes.get();')).toBe('Keep');
    await chrome.evaluate('IDBDatabase.prototype.transaction=window.originalTransaction;delete window.originalTransaction;');
    await page("n.setNotesText('x'.repeat(999999));await (await import('/src/lib/store.ts')).flushReadyStores();");
    await click('Save to Notes');await chrome.waitFor("document.querySelector('.note-recall [role=alert]')?.textContent.includes('full')");
    expect(await chrome.evaluate("document.querySelector('.note-recall textarea').value")).toBe('Retry explanation');
    await page("n.setNotesText('Keep');");await click('Save to Notes');await chrome.waitFor("document.querySelector('.note-recall [role=status]')");
    expect(await page('return n.notes.get();')).toBe('Keep\n\n## Explain from memory\nRetry explanation');chrome.assertHealthy();
  });
});
