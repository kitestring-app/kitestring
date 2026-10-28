// Only this harness's muted headless Chrome and disposable profile are controlled.
// @ts-expect-error Shared JavaScript harness has no declaration file.
import { Chrome } from "../../scripts/golden.mjs";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertFocusFit } from "./focusLayout.browser";

describe.skipIf(process.env.RETURN_BROWSER !== "1")("away records in disposable Chrome with web and inert native bridges", () => {
  const chrome = new Chrome(); let server: ViteDevServer;
  const shots = process.env.SHOTS_DIR ?? join(tmpdir(), "90-away-shots");
  const fixed = Date.UTC(2026, 9, 29, 12);
  beforeAll(async () => {
    await mkdir(shots, { recursive: true });
    server = await createServer({ configLoader: "runner", server: { host: "127.0.0.1", port: 0, hmr: false, watch: null }, logLevel: "error" });
    await server.listen(); const address = server.httpServer!.address();
    if (!address || typeof address === "string") throw new Error("No test server");
    chrome.origin = `http://127.0.0.1:${address.port}`; await chrome.start();
    await chrome.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    await chrome.send("Page.addScriptToEvaluateOnNewDocument", { source: `Date.now = () => ${fixed};
      if (sessionStorage.getItem('away-native') === 'Mac') window.desktop = {
        armAlarm: async () => true, disarmAlarm() {}, cancelSpeech() {}, release() {}, consumeSuspensionAt: () => null
      };` });
    await chrome.send("Page.navigate", { url: chrome.origin });
    await chrome.waitFor("import('/src/state/timer.ts').then(async t => {await t.timerHydrationReady; return import('/src/lib/store.ts').then(s=>s.canWriteClockStore('timer'))})");
  }, 30_000);
  afterAll(async () => { await chrome.close(); await server?.close(); });

  it.each(["web", "Mac"])("%s restores factual focus and away, stops Strong/Hard auto-run, and fits every look", async platform => {
    await chrome.evaluate(`(async () => {
      sessionStorage.setItem('away-native', '${platform}');
      const s = await import('/src/state/settings.ts'), d = await import('/src/lib/db.ts'), t = await import('/src/state/timerEngine.ts');
      const settings = {...s.settings.get(), dash:'focus', timer:{...s.settings.get().timer, ...s.STRONG_PATCH,
        display:'remaining', hardMode:true, autoRun:'always', countdownRepeat:true, speak:false, notify:false, bringToFront:false, takeover:false,
        focusDoneSound:'none', breakOverSound:'none'}};
      await d.dbSetMany([['settings',settings],['stats',{chunks:[],tasksDone:[]}],
        ['timer',{...t.INITIAL_TIMER,segId:'departed',startedAt:${fixed - 4_440_000},frozen:true,frozenTotal:1500000,hardLocked:true}],
        ['clockPresence',{segId:'departed',lastAliveAt:${fixed - 3_840_000},ownerId:'terminated'}]]);
    })()`);
    await chrome.reload("document.querySelector('.recovery-card')?.textContent.includes('Away 1 h 4 min.')");
    await chrome.waitFor("document.querySelector('.recovery-card')?.textContent.includes('Away 1 h 4 min.')");
    expect(await chrome.evaluate("document.querySelector('.recovery-card').textContent")).toContain("You focused 10 min. Away 1 h 4 min.");
    const snapshot = await chrome.evaluate(`(async () => {const t=await import('/src/state/timer.ts'),s=await import('/src/state/stats.ts');return {running:t.timer.get().startedAt,focus:s.stats.get().chunks.filter(c=>c.kind==='focus').reduce((n,c)=>n+c.ms,0),away:s.stats.get().chunks.filter(c=>c.away).map(c=>c.ms)}})()`);
    expect(snapshot).toEqual({ running: null, focus: 600_000, away: [3_840_000] });
    for (const look of ["classic", "glass", "sketch", "companion", "sunrise"]) for (const width of [1280, 390]) {
      await chrome.send("Emulation.setDeviceMetricsOverride", { width, height: 820, deviceScaleFactor: 1, mobile: width < 600 });
      await chrome.evaluate(`import('/src/state/settings.ts').then(s=>s.settingsUpdate('appearance',{look:'${look}'}))`);
      await chrome.waitFor(`document.documentElement.dataset.look === '${look}'`);
      await assertFocusFit(expression => chrome.evaluate(expression));
      await writeFile(join(shots, `${platform}-${look}-${width}.png`), await chrome.png());
    }
    await chrome.evaluate("import('/src/state/settings.ts').then(s=>s.settingsUpdate('timer',{display:'hidden'}))");
    await chrome.waitFor("!document.querySelector('.recovery-card').textContent.includes('You focused')");
    expect(await chrome.evaluate("document.querySelector('.recovery-card').textContent")).toContain("Away 1 h 4 min.");
    expect(await chrome.evaluate("document.querySelector('.big-time')?.textContent ?? ''")).not.toMatch(/\d/);
    await chrome.evaluate(`(async () => {
      const t=await import('/src/state/timer.ts'),e=await import('/src/state/timerEngine.ts');
      t.timer.set({...e.INITIAL_TIMER,segId:'unworked-hard',frozen:true,frozenTotal:1500000,hardLocked:true,reentry:'locked'});
      await t.requestRecovery(t.recoveryCommand(),'dismiss');
    })()`);
    await chrome.waitFor("!document.querySelector('.start-support')");
    expect(await chrome.evaluate("import('/src/state/timer.ts').then(t=>t.requestTinyBlock(t.recoveryCommand(),1))")).toBe(false);
    expect(await chrome.evaluate("import('/src/state/timer.ts').then(t=>t.timer.get().frozenTotal)")).toBe(1_500_000);
    expect(await chrome.evaluate("document.querySelector('[aria-label=\"Start · Space\"]').disabled")).toBe(false);
    await chrome.evaluate("document.querySelector('[aria-label=\"Start · Space\"]').click()");
    expect(await chrome.evaluate("import('/src/state/timer.ts').then(t=>t.timer.get().startedAt)")).toBe(fixed);
    await chrome.evaluate(`(async () => {
      const t=await import('/src/state/timer.ts'),s=await import('/src/state/settings.ts');
      t.timer.set({...t.timer.get(),startedAt:null}); s.settings.set({...s.settings.get(),dash:'ambient'});
    })()`);
    await chrome.waitFor("document.querySelector('[aria-label=\"Start ambient timer\"]')");
    expect(await chrome.evaluate("document.querySelector('[aria-label=\"Start ambient timer\"]').disabled")).toBe(false);
    await chrome.evaluate("document.querySelector('[aria-label=\"Start ambient timer\"]').click()");
    expect(await chrome.evaluate("import('/src/state/timer.ts').then(t=>t.timer.get().startedAt)")).toBe(fixed);
    // End only this disposable fixture so the next platform starts idle.
    await chrome.evaluate("import('/src/state/timer.ts').then(t=>t.timer.set({...t.timer.get(),startedAt:null,hardLocked:false}))");
    chrome.assertHealthy();
  }, 30_000);
});
