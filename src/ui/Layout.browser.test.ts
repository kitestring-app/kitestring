// @ts-expect-error Shared JavaScript harness has no declaration file.
import { Chrome } from "../../scripts/golden.mjs";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe.skipIf(process.env.FIT_BROWSER !== "1")("narrow layouts with different font metrics", () => {
  const chrome = new Chrome();
  let server: ViteDevServer;
  beforeAll(async () => {
    server = await createServer({ configLoader: "runner", server: { host: "127.0.0.1", port: 0, hmr: false, watch: null }, logLevel: "error" });
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === "string") throw new Error("No test server");
    chrome.origin = `http://127.0.0.1:${address.port}`;
    await chrome.start();
    await chrome.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    await chrome.send("Page.navigate", { url: chrome.origin });
    await chrome.waitFor("document.querySelector('.next-action')");
  }, 30000);
  afterAll(async () => { await chrome.close(); await server?.close(); });

  it("keeps dashboard bars and records inside 320px on web and the native renderer", async () => {
    for (const native of [false, true]) for (const font of ["system-ui", "monospace"]) {
      await chrome.send("Emulation.setDeviceMetricsOverride", { width: 320, height: 820, deviceScaleFactor: 1, mobile: false });
      await chrome.evaluate(`(async () => {
        const s = await import('/src/state/settings.ts'); await s.calmFoundationReady;
        document.documentElement.dataset.desktop = '${native}';
        document.documentElement.style.setProperty('--ui', '${font}');
        document.documentElement.style.setProperty('--display', '${font}');
        s.settingsUpdate('extras', {defaultTab: 'stats', reduceMotion: true});
      })()`);
      await chrome.evaluate("document.fonts.ready");
      await chrome.evaluate("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
      const bars = await chrome.evaluate(`(() => {
        const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return {left: r.left, right: r.right, top: r.top, bottom: r.bottom}; };
        return {width: document.documentElement.scrollWidth, viewport: innerWidth,
          groups: ['.topbar .seg', '.topbar > .row', '.dock', '.credits'].map(rect)};
      })()`);
      expect(bars.width, JSON.stringify({native, font, bars})).toBe(bars.viewport);
      for (const group of bars.groups) {
        expect(group.left).toBeGreaterThanOrEqual(0);
        expect(group.right).toBeLessThanOrEqual(bars.viewport);
      }
      await chrome.evaluate("document.querySelector('[aria-label=\"Settings (S)\"]').click()");
      await chrome.waitFor("document.querySelector('.stats-records')");
      expect(await chrome.evaluate("document.querySelector('.drawer main').scrollWidth <= document.querySelector('.drawer main').clientWidth")).toBe(true);
      await chrome.evaluate("document.querySelector('.settings-close').click()");
      await chrome.waitFor("!document.querySelector('.drawer')");
    }
    chrome.assertHealthy();
  }, 30000);
});
