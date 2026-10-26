import { chromeArgs } from "../../scripts/browser/chrome-args.ts";
import { assertFocusFit } from "./focusLayout.browser";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Only a Chrome process launched here, with a disposable profile, is controlled.
const chromePath = [process.env.CHROME_BIN, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((path) => path && existsSync(path));

// Opt in on hosts that permit starting a loopback server and launching Chrome.
// Normal unit checks do not launch a browser.
describe.skipIf(!chromePath || process.env.START_CUES_BROWSER !== "1")("Start cues, parking and rewards in all five looks (isolated headless Chrome)", () => {
  let browser: ChildProcess, server: ViteDevServer, profile: string, socket: WebSocket;
  let origin = "", sequence = 0;
  const errors: unknown[] = [];
  const pending = new Map<number, { resolve: (value: any) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const send = (method: string, params: object = {}): Promise<any> => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 8000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression: string) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = async (expression: string) => {
    for (let n = 0; n < 100; n++) {
      if (await evaluate(`Promise.resolve(${expression}).then(Boolean)`)) return;
      await delay(50);
    }
    throw new Error(`Dashboard did not reach: ${expression}; ${JSON.stringify(errors)}; ${await evaluate("(location.href + document.documentElement.outerHTML.slice(0, 1200))")}`);
  };
  const waitForOwner = () => waitFor("import('/src/state/timer.ts').then(async t => { await t.timerHydrationReady; return (await import('/src/lib/store.ts')).canWriteClockStore('timer'); })");
  beforeAll(async () => {
    server = await createServer({ configLoader: "runner", cacheDir: join(tmpdir(), "pomodoro-return-vite-cache"), server: { host: "127.0.0.1", port: 0, hmr: false, watch: null }, clearScreen: false });
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === "string") throw new Error("No test server port");
    origin = `http://127.0.0.1:${address.port}`;
    profile = mkdtempSync(join(tmpdir(), "pomodoro-return-test-"));
    browser = spawn(chromePath!, chromeArgs(profile), { stdio: "ignore" });
    const portFile = join(profile, "DevToolsActivePort");
    for (let n = 0; n < 150 && !existsSync(portFile); n++) await delay(50);
    const port = readFileSync(portFile, "utf8").split("\n")[0];
    const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json()) as { type: string; url: string; webSocketDebuggerUrl: string }[];
    socket = new WebSocket(pages.find(p => p.type === "page" && p.url === "about:blank")!.webSocketDebuggerUrl);
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(String(data)), request = pending.get(message.id);
      if (message.method === "Runtime.exceptionThrown") errors.push(message.params);
      if (!request) return;
      clearTimeout(request.timer);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    });
    await new Promise<void>((resolve, reject) => { socket.addEventListener("open", () => resolve(), { once: true }); socket.addEventListener("error", () => reject(new Error("Test Chrome socket failed")), { once: true }); });
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Network.enable");
    await send("Network.setBlockedURLs", { urls: ["https://*"] });
    await send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 800, deviceScaleFactor: 1, mobile: false });
    await waitFor("document.readyState === 'complete'");
    const response = await fetch(origin);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const navigation = await send("Page.navigate", { url: origin });
    if (navigation.errorText) throw new Error(`${navigation.errorText}: ${JSON.stringify(errors)}`);
    await waitFor("document.querySelector('[data-tip]')");
  }, 20000);

  afterAll(async () => {
    socket?.close();
    for (const request of pending.values()) clearTimeout(request.timer);
    if (browser && browser.exitCode === null) {
      const exited = new Promise<void>(resolve => browser.once("exit", () => resolve()));
      browser.kill("SIGKILL");
      await exited;
    }
    await server?.close();
    if (profile) rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });


  const click = async (text: string) => {
    expect(await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); b?.click(); return !!b; })()`)).toBe(true);
    await delay(60);
  };
  const shot = async (name: string) => {
    const shots = process.env.SHOTS_DIR ?? ".agents/jobs/42-shots";
    mkdirSync(shots, { recursive: true });
    const png = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(shots, `${name}.png`), Buffer.from(png.data, "base64"));
  };
  const reloadDashboard = async () => {
    const previousDocument = await evaluate("performance.timeOrigin");
    await send("Page.reload");
    // A retained old document is not evidence that the saved review/reward hydrated.
    await waitFor(`performance.timeOrigin !== ${previousDocument} && document.readyState === 'complete' && document.querySelector('.start-support')`);
    await waitForOwner();
  };
  it.each([false, true])("tiny start, cue, review and reward (native bridge=%s)", async native => {
    await send("Page.navigate", { url: "about:blank" });
    await send("Storage.clearDataForOrigin", { origin, storageTypes: "all" });
    const injection = await send("Page.addScriptToEvaluateOnNewDocument", { source: native ? `
      window.desktop = { armAlarm: async () => true, disarmAlarm() {}, release() {}, cancelSpeech() {}, onLifecycle() { return () => {} } };
    ` : "window.desktop = undefined;" });
    await send("Page.navigate", { url: origin });
    await waitFor("document.querySelector('.next-action')"); await waitForOwner();
    await evaluate(`Promise.all([import('/src/state/settings.ts'), import('/src/state/intent.ts')]).then(async ([s,i]) => {
      await s.calmFoundationReady; s.settingsUpdate('dash', 'focus');
      i.updateIntent({action:'Write the opening paragraph', why:'Share a draft with the team', cue:'When I sit down after lunch, I will open the draft', reward:'Make a cup of tea'});
    })`);
    for (const [width, height] of [[1000, 800], [1280, 720]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    for (const look of ["classic", "glass", "sketch", "companion", "sunrise"]) {
      await evaluate(`import('/src/state/settings.ts').then(s => s.settingsUpdate('appearance', {look: '${look}'}))`);
      await waitFor(`document.documentElement.dataset.look === '${look}'`); await delay(100);
      expect(await evaluate("document.querySelector('.next-action-cue').textContent")).toContain("after lunch");
      expect(await evaluate("document.querySelector('.tiny-start').textContent")).toContain("Start with 5 min");
      await assertFocusFit(evaluate);
      expect(await evaluate("(() => {const r = document.querySelector('.start-support').getBoundingClientRect(); return r.x >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight})()")).toBe(true);
      if (!native) await shot(`tiny-start-${look}${width === 1000 ? "" : "-1280x720"}`);
      if (!native && ["glass", "companion"].includes(look)) await shot(`cue-${look}`);
      await evaluate("document.querySelector('[aria-label=\"Tiny block length\"]').click()"); await click("Custom");
      await assertFocusFit(evaluate);
      await evaluate("document.querySelector('[aria-label=\"Tiny block length\"]').click()"); await click("5 min");
    }}
    expect(await evaluate("document.querySelector('.focus-center select')")).toBeNull();
    await evaluate("document.querySelector('[aria-label=\"Tiny block length\"]').click()");
    expect(await evaluate("document.querySelector('.tiny-options').textContent")).toMatch(/5 min.*10 min.*Custom/);
    await click("Custom");
    await waitFor("document.querySelector('[aria-label=\"Custom tiny block minutes\"]')");
    await evaluate("document.querySelector('[aria-label=\"Tiny block length\"]').click()");
    await click("10 min");
    await click("Start with 10 min");
    expect(await evaluate("import('/src/state/timer.ts').then(t => t.totalMs())")).toBe(600000);
    expect(await evaluate("!!document.querySelector('.tiny-start')")).toBe(false);
    await evaluate("import('/src/state/timer.ts').then(t => t.timerActions.stop())");
    await waitFor("document.querySelector('.tiny-start')");
    await evaluate("document.querySelector('[aria-label=\"Tiny block length\"]').click()");
    await click("5 min");
    await click("Start with 5 min");
    expect(await evaluate("import('/src/state/timer.ts').then(t => t.totalMs())")).toBe(300000);
    await evaluate("import('/src/state/timer.ts').then(t => t.timerActions.pause())");
    await waitFor("document.querySelector('.recovery-card')");
    expect(await evaluate("document.querySelector('.next-action-cue').textContent")).toContain("after lunch");
    await evaluate("import('/src/state/timer.ts').then(t => t.timerActions.stop())");
    await evaluate(`Promise.all([import('/src/state/parkingReview.ts'), import('/src/state/parked.ts'), import('/src/state/timer.ts')]).then(([r,p,t]) => {
      r.chooseReviewBoundary('session'); p.parkThought('Check the meeting notes', {segment:'focus'}); p.parkThought('Send the outline', {segment:'focus'});
      t.timerActions.start(); t.timerActions.stop();
    })`);
    await waitFor("document.querySelector('[aria-label=\"Review parked thoughts\"]')");
    for (const [width, height] of [[1000, 800], [1280, 720]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    for (const look of ["classic", "glass", "sketch", "companion", "sunrise"]) {
      await evaluate(`import('/src/state/settings.ts').then(s => s.settingsUpdate('appearance', {look: '${look}'}))`);
      await waitFor(`document.documentElement.dataset.look === '${look}'`); await delay(100);
      expect(await evaluate("document.querySelector('.recovery-card').textContent")).toContain("Check the meeting notes");
      expect(await evaluate("document.querySelector('.recovery-card').textContent")).toContain("Make a task");
      expect(await evaluate("document.querySelectorAll('.recovery-card').length")).toBe(1);
      await assertFocusFit(evaluate);
      if (!native) await shot(`parking-review-${look}${width === 1000 ? "" : "-1280x720"}`);
    }}
    await click("Keep"); await click("Review later");
    await evaluate("import('/src/lib/store.ts').then(s => s.flushReadyStores())"); await reloadDashboard();
    await waitFor("document.querySelector('.park-chip')?.textContent === '2 parked'"); await click("2 parked");
    await waitFor("document.querySelector('.recovery-card')");
    expect(await evaluate("document.querySelector('.recovery-action').textContent")).toBe("Send the outline");
    await click("Make a task");
    expect(await evaluate("import('/src/state/tasks.ts').then(t => t.tasks.get().filter(t => t.title === 'Send the outline').length)")).toBe(1);
    await waitFor("!document.querySelector('.recovery-card')"); await click("Finish action");
    await waitFor("document.querySelector('.reward-moment')");
    for (const [width, height] of [[1000, 800], [1280, 720]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    for (const look of ["classic", "glass", "sketch", "companion", "sunrise"]) {
      await evaluate(`import('/src/state/settings.ts').then(s => s.settingsUpdate('appearance', {look: '${look}'}))`);
      await waitFor(`document.documentElement.dataset.look === '${look}'`); await delay(100);
      expect(await evaluate("document.querySelector('.reward-moment').textContent")).toContain("Make a cup of tea");
      await assertFocusFit(evaluate);
      if (!native) await shot(`reward-${look}${width === 1000 ? "" : "-1280x720"}`);
    }}
    await evaluate("document.querySelector('.reward-moment [aria-label=\"Close\"]').click()"); await evaluate("import('/src/lib/store.ts').then(s => s.flushReadyStores())"); await reloadDashboard();
    await waitFor("document.querySelector('.start-support')"); expect(await evaluate("!!document.querySelector('.reward-moment')")).toBe(false);
    await evaluate("import('/src/state/tinyStarts.ts').then(t=>t.tinyStarts.set({version:1,finished:['tiny-a','tiny-b'],offer:'available'}))");
    await waitFor("document.querySelector('[aria-label=\"Usual length offer\"]')");
    for (const [width,height] of [[1000,800],[1280,720]]) {
      await send("Emulation.setDeviceMetricsOverride", {width,height,deviceScaleFactor:1,mobile:false});
      for (const look of ["classic","glass","sketch","companion","sunrise"]) {
        await evaluate(`import('/src/state/settings.ts').then(s=>s.settingsUpdate('appearance',{look:'${look}'}))`);
        await waitFor(`document.documentElement.dataset.look === '${look}'`); await delay(60);
        await assertFocusFit(evaluate);
      }
    }
    await click("Keep tiny blocks");
    await evaluate("import('/src/lib/store.ts').then(s=>s.flushReadyStores())"); await reloadDashboard();
    await waitFor("document.querySelector('.start-support')");
    expect(await evaluate("!!document.querySelector('[aria-label=\"Usual length offer\"]')")).toBe(false);
    // Small-screen and reduced-motion layout remain usable in every look.
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    for (const look of ["classic", "glass", "sketch", "companion", "sunrise"]) {
      await evaluate(`import('/src/state/settings.ts').then(s => s.settingsUpdate('appearance', {look: '${look}'}))`);
      await waitFor(`document.documentElement.dataset.look === '${look}'`);
      expect(await evaluate("document.documentElement.scrollWidth <= innerWidth"), await evaluate("JSON.stringify({look:document.documentElement.dataset.look,width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('body *')].map(e=>({tag:e.tagName,cls:e.className,x:e.getBoundingClientRect().x,right:e.getBoundingClientRect().right})).filter(r=>r.x<0||r.right>innerWidth).slice(0,15)})")).toBe(true);
    }
    await send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 800, deviceScaleFactor: 1, mobile: false });
    await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: injection.identifier });
    expect(errors).toEqual([]);
  }, 60000);
});
