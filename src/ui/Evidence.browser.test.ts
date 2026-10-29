// Disposable, muted headless Chrome only. No Electron or personal browser.
// @ts-expect-error Shared JavaScript harness has no declaration file.
import { Chrome } from "../../scripts/golden.mjs";
import { build, preview, type PreviewServer } from "vite";
import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe.skipIf(process.env.EVIDENCE_BROWSER !== "1")("bundled evidence page", () => {
  const chrome = new Chrome();
  let server: PreviewServer;
  beforeAll(async () => {
    await build({ configLoader: "runner", logLevel: "error" });
    const csp = readFileSync("public/_headers", "utf8").match(/Content-Security-Policy: (.+)/)![1];
    server = await preview({ configLoader: "runner", preview: { host: "127.0.0.1", port: 0, headers: { "Content-Security-Policy": csp } }, logLevel: "error" });
    const address = server.httpServer.address();
    if (!address || typeof address === "string") throw new Error("No preview server");
    chrome.origin = `http://127.0.0.1:${address.port}`;
    await chrome.start();
    await chrome.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  }, 30000);
  afterAll(async () => {
    await chrome.close();
    await new Promise<void>((done, reject) => server?.httpServer.close(error => error ? reject(error) : done()));
  });
  it("loads directly from built files with networking disabled, supports both schemes, fits phones and reaches every link by Tab", async () => {
    await chrome.send("Fetch.disable");
    await chrome.send("Network.enable");
    await chrome.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    const shots = process.env.SHOTS_DIR ?? join(tmpdir(), "82-evidence-shots");
    await mkdir(shots, { recursive: true });
    for (const scheme of ["dark", "light"]) {
      await chrome.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: "reduce" }] });
      for (const width of [1280, 390, 320]) {
        await chrome.send("Emulation.setDeviceMetricsOverride", { width, height: 820, deviceScaleFactor: 1, mobile: false });
        await chrome.send("Page.navigate", { url: pathToFileURL(resolve("dist/research.html")).href });
        await chrome.waitFor("document.querySelectorAll('article[data-feature]').length === 18 && document.readyState === 'complete'");
        expect(await chrome.evaluate("document.querySelector('article[data-feature=enough] h3').textContent")).toBe("A sufficient finish you choose");
        expect(await chrome.evaluate("document.querySelector('article[data-feature=allowance] .strength').textContent")).toContain("untested");
        expect(await chrome.evaluate("document.querySelector('article[data-feature=stopped] .strength').textContent")).toContain("untested");
        expect(await chrome.evaluate("document.querySelector('article[data-feature=portion] .strength').textContent")).toContain("untested");
        expect(await chrome.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
        expect(await chrome.evaluate("getComputedStyle(document.documentElement).colorScheme")).toBe(scheme);
        expect(await chrome.evaluate("performance.getEntriesByType('resource').length")).toBe(0);
        expect(await chrome.evaluate("[...document.querySelectorAll('a[href^=\"#\"]')].every(a=>document.getElementById(a.hash.slice(1)))")).toBe(true);
        await writeFile(join(shots, `${scheme}-${width}.png`), await chrome.png());
      }
    }
    const count = await chrome.evaluate("document.querySelectorAll('a').length");
    for (let index = 0; index < count; index++) {
      await chrome.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      await chrome.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      expect(await chrome.evaluate(`document.activeElement === document.querySelectorAll('a')[${index}]`)).toBe(true);
      expect(await chrome.evaluate("getComputedStyle(document.activeElement).outlineStyle")).toBe("solid");
    }
    chrome.assertHealthy();
  }, 30000);
  it("keeps the phone evidence link clear of open panels with a full touch target", async () => {
    await chrome.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await chrome.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    for (const width of [320, 390]) {
      await chrome.send("Emulation.setDeviceMetricsOverride", { width, height: 820, deviceScaleFactor: 1, mobile: true });
      await chrome.send("Page.navigate", { url: chrome.origin });
      await chrome.waitFor("document.querySelector('.credits a[href=\"./research.html\"]')");
      for (const panel of ["tasks", "sounds", "notes"]) {
        await chrome.evaluate(`document.querySelector('[data-panel="${panel}"]').click()`);
        await chrome.waitFor("document.querySelector('.panel:not([hidden])')");
        expect(await chrome.evaluate(`(()=>{const link=document.querySelector('.credits a[href="./research.html"]');
          const r=link.getBoundingClientRect(), p=document.querySelector('.panel:not([hidden])').getBoundingClientRect();
          return r.height>=44 && r.top>=p.bottom && document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===link;})()`)).toBe(true);
        await chrome.evaluate(`document.querySelector('[data-panel="${panel}"]').click()`);
        await chrome.waitFor("!document.querySelector('.panel:not([hidden])')");
      }
    }
  }, 30000);
  it("keeps rating and citation jumps inside the embedded evidence document", async () => {
    await chrome.send("Page.navigate", { url: chrome.origin });
    await chrome.waitFor("document.querySelector('.credits a[href=\"./research.html\"]')");
    await chrome.evaluate("document.querySelector('.credits a[href=\"./research.html\"]').click()");
    await chrome.waitFor("document.querySelector('.evidence-reader iframe')?.contentDocument?.querySelectorAll('article').length === 18");
    expect(await chrome.evaluate("document.querySelector('.evidence-reader iframe').contentDocument.querySelector('article[data-feature=enough] .strength').textContent")).toContain("untested");
    await chrome.evaluate("void (window.evidenceDocument = document.querySelector('.evidence-reader iframe').contentDocument)");
    for (const id of ["moderate", "S1"]) {
      await chrome.evaluate(`window.evidenceDocument.querySelector('a[href$="#${id}"]').click()`);
      await chrome.waitFor(`document.querySelector('.evidence-reader iframe')?.contentDocument?.location.hash === '#${id}'`);
      expect(await chrome.evaluate(`(() => {
        const doc = document.querySelector('.evidence-reader iframe').contentDocument;
        const target = doc.querySelector(':target');
        return doc === window.evidenceDocument && target?.id === '${id}' &&
          target.getBoundingClientRect().top >= 0 && target.getBoundingClientRect().top < doc.defaultView.innerHeight &&
          location.pathname === '/' && location.hash === '';
      })()`)).toBe(true);
    }
    await chrome.evaluate("document.querySelector('.evidence-reader button').click()");
    chrome.assertHealthy();
  }, 30000);
  it("opens from footer and About in the same app view and returns to the dashboard", async () => {
    await chrome.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await chrome.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    await chrome.send("Page.navigate", { url: chrome.origin });
    await chrome.waitFor("document.querySelector('.credits a[href=\"./research.html\"]')");
    expect(await chrome.evaluate("document.querySelector('.credits a[href=\"./research.html\"]').getBoundingClientRect().width > 0")).toBe(true);
    await chrome.evaluate("document.querySelector('.credits a[href=\"./research.html\"]').click()");
    await chrome.waitFor("document.querySelector('.evidence-reader iframe')?.contentDocument?.querySelector('h1')?.textContent === 'Why it works this way'");
    await chrome.evaluate("document.querySelector('.evidence-reader iframe').contentDocument.querySelector('nav a').click()");
    await chrome.waitFor("document.querySelector('[aria-label=\"Settings (S)\"]')");
    await chrome.evaluate("document.querySelector('[aria-label=\"Settings (S)\"]').click()");
    await chrome.waitFor("document.querySelector('.drawer')");
    await chrome.evaluate("[...document.querySelectorAll('.drawer nav button')].find(b=>b.textContent.trim()==='About').click()");
    await chrome.waitFor("document.querySelector('.drawer a[href=\"./research.html\"]')");
    await chrome.evaluate("document.querySelector('.drawer a[href=\"./research.html\"]').focus(); document.querySelector('.drawer a[href=\"./research.html\"]').click()");
    await chrome.waitFor("document.querySelector('.evidence-reader iframe')?.contentDocument?.querySelectorAll('article').length === 18");
    await chrome.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await chrome.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    expect(await chrome.evaluate("document.querySelector('.evidence-reader iframe').contentDocument.activeElement.tagName")).toBe("A");
    await chrome.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await chrome.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await chrome.waitFor("!document.querySelector('.evidence-reader') && document.querySelector('.drawer')");
    expect(await chrome.evaluate("document.activeElement === document.querySelector('.drawer a[href=\"./research.html\"]')")).toBe(true);
    expect([...chrome.blocked]).toEqual([]);
    chrome.assertHealthy();
  }, 30000);
  it("keeps the running dashboard alive while reading the evidence", async () => {
    await chrome.send("Emulation.setCPUThrottlingRate", { rate: 20 });
    await chrome.send("Page.navigate", { url: chrome.origin });
    await chrome.waitFor("document.querySelector('.credits a[href=\"./research.html\"]')");
    await chrome.waitFor("document.querySelector('[aria-label=\"Start · Space\"]')");
    await chrome.evaluate("document.querySelector('[aria-label=\"Start · Space\"]').click()");
    await chrome.waitFor("document.querySelector('[aria-label=\"Pause · Space\"]')");
    await chrome.evaluate("void (window.evidenceDashboard = document.querySelector('#root').firstElementChild)");
    await chrome.evaluate("document.querySelector('.credits a[href=\"./research.html\"]').click()");
    await chrome.waitFor("document.querySelector('.evidence-reader iframe')?.contentDocument?.querySelector('h1')");
    expect(await chrome.evaluate("!!document.querySelector('.evidence-reader[open]') && window.evidenceDashboard.isConnected")).toBe(true);
    await chrome.evaluate("window.evidenceTitle = document.title; window.evidenceNow = Date.now; window.evidenceMono = performance.now.bind(performance); Date.now = () => window.evidenceNow() + 5000; performance.now = () => window.evidenceMono() + 5000");
    await chrome.waitFor("document.title !== window.evidenceTitle");
    expect(await chrome.evaluate("!!document.querySelector('[aria-label=\"Pause · Space\"]') && location.pathname === '/'")).toBe(true);
    await chrome.evaluate("Date.now = window.evidenceNow; performance.now = window.evidenceMono; document.querySelector('.evidence-reader button').click()");
    await chrome.waitFor("!document.querySelector('.evidence-reader')");
    await chrome.evaluate("document.querySelector('[aria-label=\"Pause · Space\"]').click()");
  }, 30000);
});
