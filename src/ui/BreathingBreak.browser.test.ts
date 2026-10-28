// Only disposable muted headless Chrome, with an inert native bridge when requested.
// @ts-expect-error Shared JavaScript harness has no declaration file.
import { Chrome } from "../../scripts/golden.mjs";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { assertFocusFit } from "./focusLayout.browser";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe.skipIf(process.env.BREATHING_BROWSER !== "1")("optional breathing inside ordinary breaks", () => {
  const chrome = new Chrome(); let server: ViteDevServer;
  const shots = process.env.SHOTS_DIR ?? join(tmpdir(), "78-breathing-shots");
  const page = (body: string) => chrome.evaluate(`(async()=>{const s=await import('/src/state/settings.ts'),t=await import('/src/state/timer.ts');${body}})()`);
  const click = (text: string) => chrome.evaluate(`[...document.querySelectorAll('.focus-center button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`);
  beforeAll(async () => {
    await mkdir(shots, {recursive:true});
    server = await createServer({configLoader:"runner",server:{host:"127.0.0.1",port:0,hmr:false,watch:null},logLevel:"error"}); await server.listen();
    const address=server.httpServer!.address(); if(!address || typeof address==="string") throw new Error("No server");
    chrome.origin=`http://127.0.0.1:${address.port}`; await chrome.start();
    await chrome.send("Fetch.enable",{patterns:[{urlPattern:"*",requestStage:"Request"}]});
    await chrome.send("Page.navigate",{url:chrome.origin}); await chrome.waitFor("document.querySelector('.focus-center')");
    await chrome.waitFor("import('/src/state/timer.ts').then(async t=>{await t.timerHydrationReady;return (await import('/src/lib/store.ts')).canWriteClockStore('timer')})");
    await page(`await s.calmFoundationReady;s.settingsUpdate('timer',s.CALM_PATCH);`);
  },30000);
  afterAll(async()=>{await chrome.close();await server?.close();});
  it("offers both durations, static guidance for both motion preferences, hidden time and immediate keyboard exit in all looks",async()=>{
    for(const native of [false,true]) for(const look of ['classic','glass','sketch','companion','sunrise']) {
      await page(`window.desktop=${native ? '{setStatus(){},preventSleep(){}}' : 'undefined'};s.settingsUpdate('appearance',{look:'${look}'});t.timerActions.goTo('short');`);
      await chrome.waitFor("document.querySelector('.breathing-entry')");
      for(const touch of [false,true]) for(const width of [1280,320]) {
        await chrome.send('Emulation.setTouchEmulationEnabled',{enabled:touch,maxTouchPoints:1});
        await chrome.send('Emulation.setDeviceMetricsOverride',{width,height:540,deviceScaleFactor:1,mobile:false});
        await chrome.evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
        expect(await chrome.evaluate("(()=>{const b=document.querySelector('.breathing-entry');b.scrollIntoView({block:'nearest'});const r=b.getBoundingClientRect();return r.width>0 && r.height>=24 && document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===b && document.documentElement.scrollWidth<=innerWidth})()")).toBe(true);
      }
      await chrome.send('Emulation.setTouchEmulationEnabled',{enabled:false});
      await chrome.send('Emulation.setDeviceMetricsOverride',{width:1280,height:820,deviceScaleFactor:1,mobile:false});
      await click('Breathe');
      await chrome.waitFor("document.querySelector('[aria-label=\"Breathing break\"]')");
      expect(await chrome.evaluate("document.querySelectorAll('.recovery-card').length")).toBe(1);
      await chrome.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
      await page(`s.settingsUpdate('extras',{reduceMotion:false});s.settingsUpdate('timer',{display:'remaining'});`);
      await chrome.evaluate("[...document.querySelectorAll('.breathing-card button')].find(b=>b.textContent.trim()==='Breathe for 1 minute').focus()");
      await chrome.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});
      await chrome.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      await chrome.waitFor("document.querySelector('.breathing-paced')?.textContent==='Breathe in'");
      expect(await chrome.evaluate("getComputedStyle(document.querySelector('.breathing-paced')).display")).not.toBe('none');
      expect(await chrome.evaluate("document.querySelector('.breathing-active').textContent")).toMatch(/seconds left/);
      expect(await chrome.evaluate("document.activeElement.matches('.breathing-host')")).toBe(true);
      await chrome.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await chrome.waitFor("document.querySelector('.breathing-entry')");
      expect(await chrome.evaluate("document.querySelector('.breathing-live').textContent")).toBe('Breathing ended.');
      await click('Breathe');
      for(const appMotion of [false,true]) {
        await chrome.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:appMotion ? 'no-preference':'reduce'}]});
        await page(`s.settingsUpdate('extras',{reduceMotion:${appMotion}});s.settingsUpdate('timer',{display:'hidden'});`);
        await click('Cyclic sigh'); await click('Slower'); await click('Breathe for 5 minutes');
        await chrome.waitFor("document.querySelector('.breathing-active')");
        expect(await chrome.evaluate("getComputedStyle(document.querySelector('.breathing-static')).display")).not.toBe('none');
        expect(await chrome.evaluate("getComputedStyle(document.querySelector('.breathing-paced')).display")).toBe('none');
        expect(await chrome.evaluate("document.querySelector('[aria-label=\"Breathing break\"]').textContent")).not.toMatch(/\d/);
        expect(await chrome.evaluate("document.querySelector('.breathing-live').textContent")).toBe('Breathing started.');
        for(const width of [1280,390,320]) {
          await chrome.send('Emulation.setDeviceMetricsOverride',{width,height:820,deviceScaleFactor:1,mobile:false});
          await chrome.evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
          expect(await chrome.evaluate("document.documentElement.scrollWidth<=innerWidth")).toBe(true);
          await assertFocusFit(expression=>chrome.evaluate(expression));
          await writeFile(join(shots,`${native?'mac':'web'}-${look}-${appMotion?'app':'os'}-${width}.png`),await chrome.png());
        }
        await chrome.evaluate("document.querySelector('.breathing-card [aria-label=Close]').focus()");
        await chrome.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});
        await chrome.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
        await chrome.waitFor("!document.querySelector('.breathing-card')");
        expect(await page("return {segment:t.timer.get().segment,running:t.timer.get().startedAt!==null}")).toEqual({segment:'short',running:false});
        await chrome.waitFor("document.activeElement.matches('.breathing-entry')"); await click('Breathe');
      }
      await click('Breathe for 1 minute'); await chrome.waitFor("document.querySelector('.breathing-active')");
      const before=await page("return (await import('/src/state/stats.ts')).stats.get()");
      // Advance only the guide clock to model a delayed callback after suspension.
      await chrome.evaluate("window.breathingNow=performance.now()+61000;window.realBreathingNow=performance.now.bind(performance);performance.now=()=>window.breathingNow");
      await chrome.waitFor("document.querySelector('.breathing-live').textContent==='Breathing ended.'");
      await chrome.evaluate("performance.now=window.realBreathingNow");
      expect(await page("return (await import('/src/state/stats.ts')).stats.get()")).toEqual(before);
      expect(await page("return t.timer.get().startedAt")).toBe(null);
      await click('Close');
    }
  },60000);
  it("preserves a running guide across timer Pause and Resume without replacing recovery cards",async()=>{
    for(const look of ['classic','glass','sketch','companion','sunrise']) {
      await page(`s.settingsUpdate('appearance',{look:'${look}'});s.settingsUpdate('timer',{display:'remaining'});t.timerActions.goTo('long');t.timerActions.start();`);
      await chrome.waitFor("document.querySelector('.breathing-entry')");
      await click('Breathe'); await click('Cyclic sigh'); await click('Slower'); await click('Breathe for 5 minutes');
      await chrome.waitFor("document.querySelector('.breathing-active')");
      await chrome.evaluate("document.querySelector('[aria-label=\"Pause · Space\"]').click()");
      await chrome.waitFor("document.querySelector('[aria-label=\"Session context\"]')");
      expect(await chrome.evaluate("document.querySelectorAll('.recovery-card').length")).toBe(1);
      await click('Resume');
      await chrome.waitFor("document.querySelector('[aria-label=\"Pause · Space\"]')");
      expect(await chrome.evaluate("document.querySelector('.breathing-active')?.textContent")).toMatch(/(?:2\d\d|300) seconds left/);
      expect(await chrome.evaluate("document.activeElement.matches('.breathing-host')")).toBe(true);
      await chrome.waitFor("import('/src/lib/alertTypingGuard.ts').then(g=>!g.alertTypingGuard.pending())");
      await chrome.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await chrome.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await chrome.waitFor("document.activeElement.matches('.breathing-entry')"); await click('Breathe');
      expect(await chrome.evaluate("document.querySelector('[aria-label=\"Breathing pattern\"] [aria-pressed=true]').textContent")).toBe('Cyclic sigh');
      expect(await chrome.evaluate("document.querySelector('[aria-label=\"Breathing pace\"] [aria-pressed=true]').textContent")).toBe('Slower');
      await page(`t.timerActions.stop();`);
    }
  },30000);
  it("keeps active guidance visible and reachable when Clear mode hides other chrome",async()=>{
    for(const look of ['classic','glass','sketch','companion','sunrise']) {
      await page(`s.settingsUpdate('appearance',{look:'${look}'});s.settingsUpdate('extras',{clearMode:true,reduceMotion:false});t.timerActions.goTo('short');t.timerActions.start();`);
      await chrome.waitFor("document.querySelector('.breathing-entry')");
      await click('Breathe'); await click('Breathe for 1 minute');
      await chrome.waitFor("document.querySelector('.breathing-active')");
      await chrome.evaluate("document.documentElement.dispatchEvent(new PointerEvent('pointerleave',{pointerType:'mouse'}))");
      await chrome.waitFor("document.querySelector('.app.idle')");
      await chrome.evaluate("new Promise(r=>setTimeout(r,600))");
      expect(await chrome.evaluate("(()=>{const s=getComputedStyle(document.querySelector('.breathing-card'));return {opacity:s.opacity,pointerEvents:s.pointerEvents}})()")).toEqual({opacity:'1',pointerEvents:'auto'});
      expect(await chrome.evaluate("document.querySelector('.breathing-card').inert")).toBe(false);
      await chrome.evaluate("document.querySelector('.breathing-card [aria-label=Close]').focus()");
      expect(await chrome.evaluate("document.activeElement===document.querySelector('.breathing-card [aria-label=Close]')")).toBe(true);
      await chrome.evaluate("document.querySelector('.breathing-card [aria-label=Close]').click()");
      await page(`t.timerActions.stop();`);
    }
    await page(`s.settingsUpdate('extras',{clearMode:false});t.timerActions.goTo('focus');`);
  },30000);
  it("leaves Start, Pause and Skip usable, closes on segment change and never resumes on navigation or reload",async()=>{
    await page(`s.settingsUpdate('timer',{display:'remaining'});s.settingsUpdate('extras',{reduceMotion:false});t.timerActions.goTo('long');`);
    await chrome.waitFor("document.querySelector('.breathing-entry')"); await click('Breathe'); await click('Breathe for 1 minute');
    await chrome.evaluate("document.querySelector('[aria-label=\"Start · Space\"]').click()");
    await chrome.waitFor("document.querySelector('[aria-label=\"Pause · Space\"]')");
    await chrome.evaluate("document.querySelector('[aria-label=\"Pause · Space\"]').click()");
    await chrome.waitFor("document.querySelector('[aria-label=\"Start · Space\"]')");
    await chrome.evaluate("document.querySelector('[aria-label=\"Skip to next · N\"]').click()");
    await chrome.waitFor("!document.querySelector('.breathing-card') && !document.querySelector('.breathing-entry')");
    expect(await page("return t.timer.get().segment")).toBe('focus');
    await page(`t.timerActions.goTo('short');`); await chrome.waitFor("document.querySelector('.breathing-entry')");
    await click('Breathe'); await click('Breathe for 1 minute'); await page(`s.settingsUpdate('dash','home');`); await chrome.waitFor("!document.querySelector('.focus-center')");
    await page(`s.settingsUpdate('dash','focus');`); await chrome.waitFor("document.querySelector('.breathing-entry')");
    expect(await chrome.evaluate("!!document.querySelector('.breathing-active')")).toBe(false);
    await click('Breathe'); await click('Breathe for 1 minute');
    await page("await (await import('/src/lib/store.ts')).flushReadyStores()");
    await chrome.send('Page.reload'); await chrome.waitFor("document.querySelector('.focus-center')");
    await chrome.waitFor("import('/src/state/timer.ts').then(async t=>{await t.timerHydrationReady;return (await import('/src/lib/store.ts')).canWriteClockStore('timer')})");
    expect(await chrome.evaluate("!!document.querySelector('.breathing-active')")).toBe(false);
    expect(await page("return t.timer.get().startedAt")).toBe(null); chrome.assertHealthy();
  },30000);
});
