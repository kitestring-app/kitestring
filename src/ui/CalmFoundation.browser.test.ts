import { chromeArgs } from "../../scripts/browser/chrome-args.ts";
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
describe.skipIf(!chromePath || process.env.CALM_BROWSER !== "1")("Calm foundation in the rendered dashboard (isolated headless Chrome)", () => {
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
  const shots = process.env.SHOTS_DIR ?? tmpdir();
  beforeAll(async () => {
    mkdirSync(shots, { recursive: true });
    server = await createServer({ configLoader: "runner", cacheDir: join(tmpdir(), "pomodoro-calm-vite-cache"), server: { host: "127.0.0.1", port: 0, hmr: false, watch: null }, clearScreen: false });
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === "string") throw new Error("No test server port");
    origin = `http://127.0.0.1:${address.port}`;
    profile = mkdtempSync(join(tmpdir(), "pomodoro-ambient-test-"));
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


  const buttonText = async (text: string) => {
    const found = await evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)} && b.getBoundingClientRect().width);
      button?.click(); return !!button;
    })()`);
    expect(found, `Visible button: ${text}`).toBe(true);
    await delay(50);
  };
  it("13/14: compact next action and controls are centered; credits shrink-wrap on the right at 1440x900", async () => {
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await waitFor("document.querySelector('.next-action button')");
    const layout = await evaluate(`(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect();
      const center = selector => { const r = rect(selector); return r.x + r.width / 2 };
      const credits = rect('.credits');
      const style = getComputedStyle(document.querySelector('.credits'));
      return { pin: center('.next-action button'), block: center('.next-action'), controls: center('.controls'),
        height: rect('.next-action').height, creditsWidth: credits.width, creditsRight: credits.right, grow: style.flexGrow };
    })()`);
    expect(Math.abs(layout.pin - layout.controls)).toBeLessThan(1);
    expect(Math.abs(layout.block - layout.controls)).toBeLessThan(1);
    expect(layout.height).toBeLessThan(110);
    expect(layout.grow).toBe("0"); expect(layout.creditsWidth).toBeLessThan(700);
    expect(layout.creditsRight).toBeCloseTo(1418, 0);
  });

  it.each([false, true])("Calm, pin, pause, expiry and reload (native bridge=%s)", async native => {
    await send("Page.navigate", { url: "about:blank" });
    await send("Storage.clearDataForOrigin", { origin, storageTypes: "all" });
    const injected = await send("Page.addScriptToEvaluateOnNewDocument", { source: `
      window.quietCalls = {arm: 0, speech: 0, attention: 0, notification: 0};
      window.desktop = ${native ? "{armAlarm: async () => {window.quietCalls.arm++; return true}, disarmAlarm() {}, cancelSpeech() {}, attention() {window.quietCalls.attention++}, release() {}}" : "undefined"};
      window.Notification = class {static permission = 'granted'; static requestPermission() { return Promise.resolve('granted') }; constructor() {window.quietCalls.notification++}};
      speechSynthesis.speak = () => {window.quietCalls.speech++};
    ` });
    await send("Page.navigate", { url: origin });
    await waitFor("document.querySelector('[aria-label=\"Pinned next action\"]')");
    expect(await evaluate("import('/src/state/settings.ts').then(async s => {await s.calmFoundationReady; return s.supportPresetLabel()})")).toBe("Calm");
    await buttonText("Pin a next action");
    expect(await evaluate("document.activeElement === document.querySelector('.next-action input')")).toBe(true);
    const revision = await evaluate("import('/src/state/intent.ts').then(i => i.intent.get().rev)");
    await send("Input.insertText", { text: "Draft an outline" });
    expect(await evaluate("import('/src/state/intent.ts').then(i => i.intent.get().rev)")).toBe(revision);
    await waitFor(`import('/src/state/intent.ts').then(i => i.intent.get().rev === ${revision + 1})`);
    await evaluate(`Promise.all([import('/src/state/tasks.ts'), import('/src/state/intent.ts')]).then(([t,i]) => {
      const id = t.addTask({ title: 'Open the draft' }); i.updateIntent({ action: 'Open the draft', why: 'Send the outline' }); t.deleteTask(id);
    })`);
    await buttonText("Done");
    expect(await evaluate("document.activeElement === document.querySelector('.next-action button')")).toBe(true);
    expect(await evaluate("document.querySelector('.next-action').textContent")).toContain("Open the draft");
    expect(await evaluate("document.querySelector('.next-action').textContent")).toContain("Send the outline");
    await evaluate("import('/src/lib/store.ts').then(s => s.flushReadyStores())");
    await send("Page.reload");
    await waitFor("document.querySelector('.next-action')?.textContent.includes('Open the draft')");
    await evaluate(`import('/src/state/timer.ts').then(t => {
      t.timer.set({...t.timer.get(), segId:'browser-quiet', startedAt:null, elapsedBefore:0, frozen:true, frozenTotal:1000, creditedUpTo:0});
      t.timerActions.start(); t.timerActions.pause();
    })`);
    expect(await evaluate("!!document.querySelector('.interruption-capture')")).toBe(false);
    await evaluate("import('/src/state/timer.ts').then(t => t.timerActions.start())");
    await waitFor("import('/src/state/timer.ts').then(t => t.timer.get().segId !== 'browser-quiet')");
    expect(await evaluate("!!document.querySelector('.transition-screen')")).toBe(false);
    expect(await evaluate("window.quietCalls")).toEqual({ arm: 0, speech: 0, attention: 0, notification: 0 });
    await evaluate("document.querySelector('[aria-label=\"Settings (S)\"]').click()");
    await buttonText("Focus Timer");
    // c765eb6: the first preset change saves the original device setup, even Strong.
    const original = await evaluate("import('/src/state/settings.ts').then(s => s.presetFields(s.settings.get().timer))");
    await buttonText("Strong");
    await waitFor("import('/src/state/settings.ts').then(s => s.supportPresetLabel() === 'Strong')");
    expect(await evaluate("import('/src/state/settings.ts').then(s => s.presetState.get().snapshot)")).toEqual(original);
    await buttonText("Try Calm");
    await waitFor("import('/src/state/settings.ts').then(s => s.supportPresetLabel() === 'Calm')");
    await buttonText("Restore");
    await waitFor("import('/src/state/settings.ts').then(s => s.supportPresetLabel() === 'Calm' && s.presetState.get().snapshot === null)");
    expect(await evaluate("import('/src/state/settings.ts').then(s => s.presetFields(s.settings.get().timer))")).toEqual(original);
    // An existing Strong setup is snapshotted by Try Calm and restored in full.
    await evaluate("import('/src/state/settings.ts').then(s => s.settingsUpdate('timer', s.STRONG_PATCH))");
    const strong = await evaluate("import('/src/state/settings.ts').then(s => s.presetFields(s.settings.get().timer))");
    await buttonText("Try Calm");
    await waitFor("import('/src/state/settings.ts').then(s => s.supportPresetLabel() === 'Calm')");
    await buttonText("Restore");
    await waitFor("import('/src/state/settings.ts').then(s => s.settings.get().timer.takeover)");
    expect(await evaluate("import('/src/state/settings.ts').then(s => s.presetFields(s.settings.get().timer))")).toEqual(strong);
    await buttonText("Stats");
    const content = await evaluate("document.querySelector('.drawer').textContent");
    expect(content).not.toMatch(/Focus Score|Current Streak/);
    if (!native) { const png = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(shots, "calm-foundation.png"), Buffer.from(png.data, "base64")); }
    await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: injected.identifier });
    expect(errors).toEqual([]);
  }, 25000);
});
