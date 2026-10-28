// Only the disposable, muted headless Chrome launched here is controlled.
// @ts-expect-error Shared JavaScript harness has no declaration file.
import { Chrome } from "../../../scripts/golden.mjs";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe.skipIf(process.env.BACKUP_BROWSER !== "1")("factual records and Hide stats in shared renderers", () => {
  const chrome = new Chrome(); let server: ViteDevServer;
  const page = (body: string) => chrome.evaluate(`(async()=>{const s=await import('/src/state/settings.ts'); ${body}})()`);
  const click = async (text: string) => { await chrome.waitFor(`[...document.querySelectorAll('.drawer button')].some(b=>b.textContent.trim()===${JSON.stringify(text)})`); return chrome.evaluate(`[...document.querySelectorAll('.drawer button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`); };
  beforeAll(async () => {
    server = await createServer({ configLoader: "runner", server: { host: "127.0.0.1", port: 0, hmr: false, watch: null }, logLevel: "error" }); await server.listen();
    const address = server.httpServer!.address(); if (!address || typeof address === "string") throw new Error("No server");
    chrome.origin = `http://127.0.0.1:${address.port}`; await chrome.start();
    await chrome.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    await chrome.send("Page.navigate", { url: chrome.origin }); await chrome.waitFor("document.querySelector('.focus-center')");
    await chrome.waitFor("import('/src/state/timer.ts').then(async t=>{await t.timerHydrationReady;return (await import('/src/lib/store.ts')).canWriteClockStore('stats')})");
    await page(`await s.calmFoundationReady; s.settingsUpdate('extras',{defaultTab:'stats',reduceMotion:true}); s.settingsUpdate('timer',s.CALM_PATCH);
      const t=await import('/src/state/stats.ts'); t.stats.set({chunks:[{id:'partial',kind:'focus',segment:'focus',start:Date.now()-600000,ms:300000,completed:false}],tasksDone:[{taskId:'done',at:Date.now()-600000}]});`);
  }, 30000);
  afterAll(async () => { await chrome.close(); await server?.close(); });
  it("shows neutral daily/weekly records in all five looks at desktop and phone widths", async () => {
    await chrome.evaluate("document.querySelector('[aria-label=\"Settings (S)\"]').click()");
    await chrome.waitFor("document.querySelector('.stats-records')");
    for (const look of ['classic','glass','sketch','companion','sunrise']) for (const width of [1280,600,390,320]) {
      await chrome.send('Emulation.setDeviceMetricsOverride',{width,height:820,deviceScaleFactor:1,mobile:false});
      await page(`s.settingsUpdate('appearance',{look:'${look}'});`);
      await chrome.waitFor(`document.documentElement.dataset.look==='${look}'`);
      const html = await chrome.evaluate("document.querySelector('.focus-stats').innerHTML");
      expect(html).not.toMatch(/score|streak|stats-level|good|bad/i);
      expect(await chrome.evaluate("document.querySelector('.stats-records tbody').textContent")).toMatch(/5m.*1/);
      expect(await chrome.evaluate("document.documentElement.scrollWidth <= innerWidth && document.querySelector('.drawer main').scrollWidth <= document.querySelector('.drawer main').clientWidth")).toBe(true);
    }
    await click('Week'); await click('Weekly');
    await chrome.waitFor("document.querySelector('.stats-records caption').textContent.includes('Weekly')");
    expect(await chrome.evaluate("document.querySelector('.stats-records tbody').textContent")).toMatch(/5m.*1/);
    await click('Log'); await chrome.waitFor("document.querySelector('.session-log tbody tr')");
    await click('Overview'); chrome.assertHealthy();
  }, 30000);
  it("renders midnight slices in daily and weekly records on web and an inert Mac bridge", async () => {
    for (const native of [false, true]) {
      if (await chrome.evaluate("!!document.querySelector('.drawer')")) {
        await chrome.evaluate("document.querySelector('.settings-close').click()");
        await chrome.waitFor("!document.querySelector('.drawer')");
      }
      await page(`window.desktop=${native ? '{setStatus(){},preventSleep(){}}' : 'undefined'};
        s.settingsUpdate('extras',{hideStats:false,defaultTab:'stats'});
        const end=new Date(); end.setDate(end.getDate()-1); end.setHours(0,15,0,0);
        const start=new Date(end); start.setDate(start.getDate()-1); start.setHours(23,50,0,0);
        const t=await import('/src/state/stats.ts');
        t.stats.set({chunks:[{id:'midnight',kind:'focus',segment:'focus',start:start.getTime(),ms:end-start,completed:true}],tasksDone:[]});`);
      await chrome.evaluate("document.querySelector('[aria-label=\"Settings (S)\"]').click()");
      await chrome.waitFor("document.querySelector('.stats-records')");
      await click('All Time');
      await chrome.waitFor("document.querySelectorAll('.stats-records tbody tr').length===3");
      expect(await chrome.evaluate("[...document.querySelectorAll('.stats-records tbody tr')].map(row=>row.querySelector('td').textContent)")).toEqual(['0s','15m','10m']);
      expect(await chrome.evaluate("!!document.querySelector('.stats-empty')")).toBe(false);
      await click('Weekly');
      await chrome.waitFor("document.querySelector('.stats-records caption').textContent.includes('Weekly')");
      expect(await chrome.evaluate("[...document.querySelectorAll('.stats-records tbody tr')].reduce((sum,row)=>sum+parseInt(row.querySelector('td').textContent),0)")).toBe(25);
    }
    chrome.assertHealthy();
  }, 30000);
  it("hides all entry points, handles remembered and live tabs, persists and leaves timer controls usable on web and a Mac bridge", async () => {
    for (const native of [false,true]) {
      await page(`window.desktop=${native ? '{setStatus(){},preventSleep(){}}' : 'undefined'}; s.settingsUpdate('extras',{hideStats:false,defaultTab:'recent'});`);
      if (!await chrome.evaluate("!!document.querySelector('.drawer')")) await chrome.evaluate("document.querySelector('[aria-label=\"Settings (S)\"]').click()");
      await click('Extras'); await chrome.waitFor("document.querySelector('.drawer main .switch')");
      await chrome.evaluate("(()=>{const select=document.querySelector('.drawer select'); select.value='stats'; select.dispatchEvent(new Event('change',{bubbles:true}));})()");
      await chrome.waitFor("import('/src/state/settings.ts').then(s=>s.settings.get().extras.defaultTab==='stats')");
      await chrome.evaluate("[...document.querySelectorAll('.drawer label')].find(l=>l.textContent.includes('Hide stats')).querySelector('input').click()");
      await chrome.waitFor("![...document.querySelectorAll('.drawer nav button')].some(b=>b.textContent.trim()==='Stats')");
      expect(await chrome.evaluate("[...document.querySelectorAll('.drawer select option')].some(o=>o.value==='stats')")).toBe(false);
      await page(`await (await import('/src/lib/store.ts')).flushReadyStores();`);
      await chrome.evaluate("document.querySelector('.settings-close').click()"); await chrome.waitFor("!document.querySelector('.drawer')");
      await chrome.evaluate("document.querySelector('[aria-label=\"Settings (S)\"]').click()");
      await chrome.waitFor("document.querySelector('.drawer header h2').textContent==='Extras'");
      expect(await chrome.evaluate("document.querySelector('.drawer select').value")).toBe('recent');
      expect(await page("return s.settings.get().extras.defaultTab;")).toBe('stats');
      expect(await chrome.evaluate("!!document.querySelector('.focus-stats')")).toBe(false);
      await chrome.evaluate("[...document.querySelectorAll('.drawer label')].find(l=>l.textContent.includes('Hide stats')).querySelector('input').click()");
      await chrome.waitFor("document.querySelector('.drawer select').value==='stats'");
      await chrome.evaluate("document.querySelector('.settings-close').click()");
      await chrome.waitFor("!document.querySelector('.drawer')");
      await chrome.evaluate("document.querySelector('[aria-label=\"Settings (S)\"]').click()");
      await chrome.waitFor("document.querySelector('.focus-stats')");
      await click('Stats'); // Explicit selection also exercises a remembered Stats tab while hidden.
      await page("s.settingsUpdate('extras',{hideStats:true});");
      await chrome.waitFor("!document.querySelector('.focus-stats')");
      await chrome.evaluate("document.querySelector('.settings-close').click()");
      await chrome.waitFor("!document.querySelector('.drawer')");
      await chrome.waitFor("document.querySelector('[aria-label=\"Start · Space\"]')");
      await chrome.evaluate("document.querySelector('[aria-label=\"Start · Space\"]').click()");
      await chrome.waitFor("document.querySelector('[aria-label=\"Pause · Space\"]')");
      expect(await page("return (await import('/src/state/timer.ts')).timer.get().startedAt!==null;")).toBe(true);
      await chrome.evaluate("document.querySelector('[aria-label=\"Pause · Space\"]').click()");
      await chrome.waitFor("document.querySelector('[aria-label=\"Start · Space\"]')");
      expect(await page("const t=await import('/src/state/timer.ts');return t.timer.get().elapsedBefore>=0 && t.timer.get().startedAt===null;")).toBe(true);
    }
    await page("await (await import('/src/lib/store.ts')).flushReadyStores();");
    await chrome.reload("document.querySelector('.focus-center') && document.querySelector('[aria-label=\"Settings (S)\"]')");
    await chrome.evaluate("document.querySelector('[aria-label=\"Settings (S)\"]').click()");
    await chrome.waitFor("document.querySelector('.drawer')");
    expect(await page("return s.settings.get().extras.hideStats;")).toBe(true);
    expect(await chrome.evaluate("[...document.querySelectorAll('.drawer nav button')].some(b=>b.textContent.trim()==='Stats')")).toBe(false);
    expect(await chrome.evaluate("document.querySelector('.drawer header h2').textContent")).toBe('Focus Timer');
    chrome.assertHealthy();
  }, 30000);
});
