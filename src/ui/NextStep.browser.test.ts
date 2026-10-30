// Disposable muted Chrome only.
// @ts-expect-error Shared JavaScript harness has no declaration file.
import { Chrome } from '../../scripts/golden.mjs';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe.skipIf(process.env.PHONE_BROWSER !== '1')('voluntary leave a next step',()=>{
 const chrome=new Chrome();let server:ViteDevServer;
 const page=(body:string)=>chrome.evaluate(`(async()=>{const s=await import('/src/state/settings.ts'),i=await import('/src/state/intent.ts'),t=await import('/src/state/timer.ts'),f=await import('/src/lib/store.ts');${body}})()`);
 const click=(text:string)=>chrome.evaluate(`(()=>{const b=[...document.querySelectorAll('.next-action button')].find(b=>b.textContent===${JSON.stringify(text)});b.focus();b.click()})()`);
 const type=(text:string)=>chrome.evaluate(`(()=>{const e=document.querySelector('.next-action input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));e.focus()})()`);
 const key=async(key:string)=>{await chrome.send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key});await chrome.send('Input.dispatchKeyEvent',{type:'keyUp',key,code:key});};
 beforeAll(async()=>{server=await createServer({configLoader:'runner',server:{host:'127.0.0.1',port:0,hmr:false,watch:null},logLevel:'error'});await server.listen();const a=server.httpServer!.address();if(!a||typeof a==='string')throw new Error('No server');chrome.origin=`http://127.0.0.1:${a.port}`;await chrome.start();await chrome.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});},30000);
 afterAll(async()=>{await chrome.close();await server?.close();});
 it.each([false,true])('Keep, explicit replacement, interrupted context and five Hidden looks (native=%s)',async native=>{
  await chrome.send('Page.navigate',{url:'about:blank'});await chrome.send('Storage.clearDataForOrigin',{origin:chrome.origin,storageTypes:'all'});
  const script=await chrome.send('Page.addScriptToEvaluateOnNewDocument',{source:native?'window.desktop={armAlarm:async()=>true,disarmAlarm(){},release(){},cancelSpeech(){},onLifecycle(){return()=>{}}};':'window.desktop=undefined;'});
  await chrome.send('Page.navigate',{url:chrome.origin});
  await chrome.waitFor("import('/src/state/timer.ts').then(async t=>{await t.timerHydrationReady;return import('/src/lib/store.ts').then(f=>f.canWriteClockStore('timer'))})");
  await page("await s.calmFoundationReady;s.settingsUpdate('dash','focus');s.settingsUpdate('timer',{...s.CALM_PATCH,display:'hidden'});s.settingsUpdate('extras',{reduceMotion:true});i.updateIntent({action:'Read chapter',why:'Understand',portion:'One page'});t.timerActions.start();");
  await chrome.waitFor("document.querySelector('[aria-label=\"Pause · Space\"]')");
  await click('Leave a next step');await click('Keep current action');
  expect(await page('return t.timer.get().startedAt!==null;')).toBe(true);
  await page('t.timerActions.pause();await f.flushReadyStores();');
  const before=await page("return {timer:t.timer.get(),stats:(await import('/src/state/stats.ts')).stats.get(),tasks:(await import('/src/state/tasks.ts')).tasks.get(),intent:i.intent.get()};");
  const shots=process.env.SHOTS_DIR??join(tmpdir(),'job94-nextstep');await mkdir(shots,{recursive:true});
  for(const width of [1280,720,390,320])for(const look of ['classic','glass','sketch','companion','sunrise']){
   await chrome.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<500});await page(`s.settingsUpdate('appearance',{look:'${look}'});`);await chrome.waitFor(`document.documentElement.dataset.look==='${look}'`);
   expect(await chrome.evaluate("(()=>{const entry=document.querySelector('.next-action-leave').getBoundingClientRect();return [...document.querySelectorAll('.next-action-buttons-closeout button:not(.next-action-leave)')].every(b=>{const r=b.getBoundingClientRect();return !(entry.left<r.right&&entry.right>r.left&&entry.top<r.bottom&&entry.bottom>r.top)})})()")).toBe(true);
   await click('Leave a next step');expect(await chrome.evaluate("document.querySelector('.next-action').textContent")).toContain('Current next action: Read chapter');
   expect(await chrome.evaluate('document.documentElement.scrollWidth<=innerWidth')).toBe(true);
   await chrome.evaluate("[...document.querySelectorAll('.next-action button')].find(b=>b.textContent==='Replace for next time').scrollIntoView({block:'nearest'})");
   if(!native&&width===320)await writeFile(join(shots,`${look}-nextstep.png`),await chrome.png());
   await click('Keep current action');await chrome.waitFor("document.activeElement.textContent==='Leave a next step'");
  }
  expect(await page('return i.intent.get();')).toEqual(before.intent);
  await click('Leave a next step');await click('Replace for next time');await type('Unsaved step');
  await new Promise(resolve=>setTimeout(resolve,600));expect(await page('return i.intent.get();')).toEqual(before.intent);
  await chrome.waitFor("import('/src/lib/alertTypingGuard.ts').then(g=>!g.alertTypingGuard.pending())");await key('Escape');await chrome.waitFor("!document.querySelector('.next-action input')");
  expect(await page('return i.intent.get();')).toEqual(before.intent);
  await click('Leave a next step');await click('Replace for next time');await type('Read the next page');await key('Enter');
  await chrome.waitFor("!document.querySelector('.next-action input')&&document.querySelector('.next-action-text')?.textContent==='Read the next page'");
  expect(await chrome.evaluate('document.activeElement.textContent')).toBe('Leave a next step');
  expect(await page('return {timer:t.timer.get(),stats:(await import("/src/state/stats.ts")).stats.get(),tasks:(await import("/src/state/tasks.ts")).tasks.get()};')).toEqual({timer:before.timer,stats:before.stats,tasks:before.tasks});
  expect(await chrome.evaluate("document.querySelector('.recovery-card').textContent")).toContain('Read chapter');expect(await chrome.evaluate("document.querySelector('.recovery-card').textContent")).toContain('One page');
  await page('await f.flushReadyStores();');await chrome.reload("document.querySelector('.next-action-text')?.textContent==='Read the next page'");
  expect(await page('return t.timer.get().context;')).toEqual(before.timer.context);
  await click('Leave a next step');await click('Replace for next time');await type('Do not save on close');
  await page("s.settingsUpdate('dash','home');await f.flushReadyStores();");await chrome.waitFor("!document.querySelector('.next-action')");
  expect(await page('return i.intent.get().action;')).toBe('Read the next page');
  await page("s.settingsUpdate('dash','focus');");await chrome.waitFor("document.querySelector('.next-action')");
  await chrome.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:script.identifier});chrome.assertHealthy();
 },30000);
 it('keeps the empty pin centered and the entry out of open panels',async()=>{
  await chrome.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await page("i.updateIntent({action:''});");
  await chrome.waitFor("document.querySelector('.next-action button')?.textContent==='Pin a next action'");
  expect(await chrome.evaluate("(()=>{const a=document.querySelector('.next-action button').getBoundingClientRect(),b=document.querySelector('.controls').getBoundingClientRect();return Math.abs(a.x+a.width/2-b.x-b.width/2)<1})()")).toBe(true);
  for(const panel of ['tasks','sounds']){
   await chrome.evaluate(`document.querySelector('[data-panel=${panel}]').click()`);
   await chrome.waitFor("document.querySelector('.panel:not([hidden])')");
   expect(await chrome.evaluate("document.querySelector('.next-action-leave')")).toBeNull();
   await chrome.evaluate(`document.querySelector('[data-panel=${panel}]').click()`);
   await chrome.waitFor("!document.querySelector('.panel:not([hidden])')");
  }
  await page("i.updateIntent({action:'Read the next page'});");
 });
 it('keeps rejected replacement drafts and permits explicit retry or saved-action recovery',async()=>{
  await click('Leave a next step');await click('Replace for next time');await type('Next section');
  await chrome.evaluate("window.originalTransaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){if(args[1]==='readwrite')throw new DOMException('Full','QuotaExceededError');return window.originalTransaction.apply(this,args)}");
  await click('Save next step');await chrome.waitFor("document.querySelector('.next-action [role=alert]')");
  expect(await chrome.evaluate("document.querySelector('.next-action input').value")).toBe('Next section');expect(await page('return i.intent.get().action;')).toBe('Read the next page');
  await chrome.evaluate('IDBDatabase.prototype.transaction=window.originalTransaction;delete window.originalTransaction;');
  await click('Save next step');await chrome.waitFor("!document.querySelector('.next-action input')");expect(await page('return i.intent.get().action;')).toBe('Next section');
  await click('Leave a next step');await click('Replace for next time');await type('Draft to keep');await page("i.updateIntent({action:'Remote replacement'});");await click('Save next step');
  await chrome.waitFor("document.querySelector('.next-action [role=alert]')");expect(await chrome.evaluate("document.querySelector('.next-action input').value")).toBe('Draft to keep');expect(await page('return i.intent.get().action;')).toBe('Remote replacement');
  await click('Keep current action');expect(await page('return i.intent.get().action;')).toBe('Remote replacement');chrome.assertHealthy();
 });

 it('keeps timer controls reachable and scrolls only the close-out at short sizes',async()=>{
  const script=await chrome.send('Page.addScriptToEvaluateOnNewDocument',{source:'window.desktop=undefined;'});
  await chrome.send('Page.navigate',{url:chrome.origin});
  await chrome.waitFor("document.querySelector('.next-action') && import('/src/state/timer.ts').then(async t=>{await t.timerHydrationReady;return true})");
  await page("s.settingsUpdate('dash','focus');s.settingsUpdate('timer',{...s.CALM_PATCH,display:'remaining'});s.settingsUpdate('quotes',{inFocus:true});");
  for(const [width,height] of [[375,500],[320,568],[720,540]])for(const look of ['classic','glass','sketch','companion','sunrise']){
   await chrome.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<500});
   await chrome.send('Emulation.setTouchEmulationEnabled',{enabled:width<500});
   await page(`s.settingsUpdate('appearance',{look:'${look}'});i.updateIntent({action:'Read chapter',why:'Understand'});`);
   await chrome.waitFor(`document.documentElement.dataset.look==='${look}'`);
   await click('Leave a next step');
   for(const replace of [false,true]){
    if(replace){await click('Replace for next time');await type('A long next action '.repeat(25));}
    await chrome.waitFor("document.querySelector('.focus-card-slot .next-action')&&[...document.querySelectorAll('.recovery-card')].filter(c=>!c.closest('[hidden]')).length===1");
    await new Promise(resolve=>setTimeout(resolve,150));
    const geometry=await chrome.evaluate(`(()=>{
     const controls=[...document.querySelectorAll('.controls button')].filter(b=>getComputedStyle(b).display!=='none');
     const reachable=controls.every(b=>{const r=b.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===b||b.contains(hit)});
     const center=document.querySelector('.focus-center'),card=document.querySelector('.next-step-slot'),r=card.getBoundingClientRect(),c=center.getBoundingClientRect();
     return {reachable,oneCard:document.querySelectorAll('.focus-card-slot').length===1,inside:r.top>=c.top&&r.bottom<=c.bottom+.5,page:document.documentElement.scrollTop,center: center.scrollTop,overflow:document.documentElement.scrollWidth>innerWidth,quote:[...document.querySelectorAll('.quote')].some(q=>getComputedStyle(q).display!=='none')};
    })()`);
    if(process.env.SHOTS_DIR){await mkdir(process.env.SHOTS_DIR,{recursive:true});await writeFile(join(process.env.SHOTS_DIR,`${width}x${height}-${look}-${replace?'replace':'keep'}.png`),await chrome.png());}
    expect(geometry,`${width}x${height} ${look} replace=${replace}`).toEqual({reachable:true,oneCard:true,inside:true,page:0,center:0,overflow:false,quote:false});
    for(const text of replace?['Save next step','Keep current action']:['Keep current action','Replace for next time']){
     expect(await chrome.evaluate(`(()=>{const b=[...document.querySelectorAll('.next-action button')].find(b=>b.textContent===${JSON.stringify(text)});b.scrollIntoView({block:'nearest'});const r=b.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===b||b.contains(hit)})()`)).toBe(true);
    }
    expect(await chrome.evaluate("document.querySelector('.focus-center').scrollTop")).toBe(0);
   }
   await click('Keep current action');
  }
  await chrome.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:script.identifier});
 },30000);

});
