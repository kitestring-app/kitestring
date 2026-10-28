import { mkdir, writeFile } from "node:fs/promises";
// @ts-expect-error Shared JavaScript harness has no declaration file.
import { Chrome } from "../../scripts/golden.mjs";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe.skipIf(process.env.START_CUES_BROWSER !== "1")("start chime in disposable muted Chrome", () => {
  const chrome = new Chrome();
  let server: ViteDevServer;
  beforeAll(async () => {
    server = await createServer({ configLoader: "runner", server: { host: "127.0.0.1", port: 0, hmr: false }, logLevel: "error" });
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === "string") throw new Error("No test port");
    chrome.origin = `http://127.0.0.1:${address.port}`;
    await chrome.start();
    await chrome.send("Page.addScriptToEvaluateOnNewDocument", { source: `
      window.cues = 0;
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function(...args) {
        if (this.buffer?.duration === 2.5) window.cues++;
        return start.apply(this, args);
      };` });
    await chrome.send("Page.navigate", { url: chrome.origin });
    await chrome.waitFor("import('/src/state/timer.ts').then(async t => { await t.timerHydrationReady; return import('/src/lib/store.ts').then(s => s.canWriteClockStore('timer')); })");
  }, 30000);
  afterAll(async () => { await chrome.close(); await server?.close(); });
  it.each([false, true])("starts once with native bridge stub %s, and stays silent on resume/sync/reload", async native => {
    await chrome.waitFor("import('/src/lib/store.ts').then(s => s.canWriteClockStore('timer'))");
    await chrome.evaluate(`(async () => {
      window.desktop = ${native ? "{ armAlarm: async () => true, disarmAlarm() {}, cancelSpeech() {}, release() {} }" : "undefined"};
      const s = await import('/src/state/settings.ts'), t = await import('/src/state/timer.ts');
      s.settings.set({...s.DEFAULT_SETTINGS, timer: {...s.DEFAULT_SETTINGS.timer, notify: false, speak: false}});
      t.timerActions.stop();
      window.cues = 0;
      window.startCue = () => t.timerActions.start();
    })()`);
    await chrome.send("Runtime.evaluate", { expression: "window.startCue()", userGesture: true, awaitPromise: true });
    await chrome.waitFor("window.cues === 1");
    await chrome.evaluate(`import('/src/state/timer.ts').then(t => { t.timerActions.start(); t.timerActions.pause(); t.timerActions.start(); t.timer.set({...t.timer.get()}); })`);
    expect(await chrome.evaluate("window.cues")).toBe(1);
    await chrome.reload("document.querySelector('button')");
    expect(await chrome.evaluate("window.cues")).toBe(0);
    chrome.assertHealthy();
  }, 20000);
  it("shows the choices in all five looks and keeps Preview disabled while muted", async () => {
    await chrome.waitFor("import('/src/lib/store.ts').then(s => s.canWriteClockStore('timer'))");
    await chrome.evaluate(`import('/src/state/settings.ts').then(s => { s.settingsUpdate('extras', {defaultTab: 'timer'}); s.localPreferences.set(p => ({...p, muted:false})); document.querySelector('[aria-label="Settings (S)"]').click(); })`);
    await chrome.waitFor("document.querySelector('[aria-label=\"Start sound\"]')");
    await mkdir('/tmp/kitestring89-ui', { recursive: true });
    for (const look of ['classic', 'glass', 'sketch', 'companion', 'sunrise']) {
      await chrome.evaluate(`import('/src/state/settings.ts').then(s => s.settingsUpdate('appearance', {look: '${look}'}))`);
      await chrome.evaluate(`document.querySelector('[aria-label="Start sound"]').scrollIntoView({block:'center'})`);
      expect(await chrome.evaluate(`document.querySelector('[aria-label="Start sound"]').options.length`)).toBe(3);
      await writeFile(`/tmp/kitestring89-ui/${look}.png`, await chrome.png());
    }
    await chrome.evaluate(`import('/src/state/settings.ts').then(s => s.localPreferences.set(p => ({...p, muted:true})))`);
    await chrome.waitFor("document.querySelector('[aria-label=\"Preview start chime\"]').disabled");
    chrome.assertHealthy();
  });

});
