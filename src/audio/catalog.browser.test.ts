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
// Normal unit runs do not launch a browser.
describe.skipIf(!chromePath || process.env.CATALOG_BROWSER !== "1")("sound and theme catalog (isolated headless Chrome)", () => {
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
      if (await evaluate(`!!(${expression})`)) return;
      await delay(50);
    }
    throw new Error(`Dashboard did not reach: ${expression}; errors: ${JSON.stringify(errors)}`);
  };
  const click = async (selector: string) => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await delay(30);
  };

  const shots = process.env.SHOTS_DIR ?? "node_modules/.tmp";
  beforeAll(async () => {
    mkdirSync(shots, { recursive: true });
    server = await createServer({ server: { host: "127.0.0.1", port: 0 }, clearScreen: false });
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === "string") throw new Error("No test server port");
    origin = `http://127.0.0.1:${address.port}`;
    const probe = await fetch(origin);
    expect(probe.headers.get("content-type")).toContain("text/html");
    profile = mkdtempSync(join(tmpdir(), "pomodoro-catalog-test-"));
    browser = spawn(chromePath!, chromeArgs(profile), { stdio: "ignore" });
    const portFile = join(profile, "DevToolsActivePort");
    for (let n = 0; n < 150 && !existsSync(portFile); n++) await delay(50);
    const port = readFileSync(portFile, "utf8").split("\n")[0];
    const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json()) as { type: string; url: string; webSocketDebuggerUrl: string }[];
    socket = new WebSocket(pages.find(page => page.type === "page" && page.url === "about:blank")!.webSocketDebuggerUrl);
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
    const navigation = await send("Page.navigate", { url: origin });
    if (navigation.errorText) throw new Error(`Test navigation failed: ${navigation.errorText}; ${JSON.stringify(errors)}`);
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

  it("renders every procedural voice and decodes each new recording without clipping or a loop-boundary spike", async () => {
    const results = await evaluate(`(async () => {
      const { SOUNDS } = await import('/src/data/sounds.ts');
      const { createProcedural, seamlessBuffer } = await import('/src/audio/procedural.ts');
      const result = [];
      for (const sound of SOUNDS.filter(sound => !sound.layers)) {
        const ctx = new OfflineAudioContext(2, 33 * 12000, 12000);
        let buffer;
        if (sound.file) {
          const response = await fetch('/sounds/' + sound.file);
          if (!response.ok) throw new Error(sound.file + ': ' + response.status);
          buffer = seamlessBuffer(ctx, await ctx.decodeAudioData(await response.arrayBuffer()));
          const source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true;
          source.connect(ctx.destination); source.start();
        } else {
          const voice = createProcedural(ctx, sound); voice.output.connect(ctx.destination);
        }
        const rendered = await ctx.startRendering();
        let peak = 0, energy = 0, finite = true, seam = 0, maxStep = 0;
        for (let channel = 0; channel < rendered.numberOfChannels; channel++) {
          const data = rendered.getChannelData(channel);
          for (let i = 0; i < data.length; i++) {
            finite &&= Number.isFinite(data[i]); peak = Math.max(peak, Math.abs(data[i])); energy += data[i] ** 2;
          }
          if (buffer) {
            const samples = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1));
            seam = Math.max(seam, Math.abs(samples[0] - samples[samples.length - 1]));
            for (let i = 1; i < samples.length; i++) maxStep = Math.max(maxStep, Math.abs(samples[i] - samples[i - 1]));
          }
        }
        result.push({ id: sound.id, finite, peak, rms: Math.sqrt(energy / (rendered.length * 2)), seam, maxStep });
      }
      return result;
    })()`);
    expect(results.length).toBe(42);
    for (const result of results) {
      expect(result.finite, result.id).toBe(true);
      expect(result.peak, result.id).toBeLessThan(1);
      expect(result.rms, result.id).toBeGreaterThan(0.0001);
      expect(result.seam, result.id).toBeLessThanOrEqual(Math.max(0.01, result.maxStep));
    }
    writeFileSync(join(shots, "catalog-audio-check.json"), JSON.stringify(results, null, 2));
  }, 60000);

  it("shows the expanded categories, applies new themes, and respects every motion control", async () => {
    const catalog = await evaluate(`import('/src/data/themes.ts').then(({THEMES}) => ({
      count: THEMES.length, invalid: THEMES.filter(theme => !CSS.supports('background', theme.background)).map(theme => theme.id)
    }))`);
    expect(catalog).toEqual({ count: 96, invalid: [] });
    await click('button[aria-label^="Settings"]');
    await waitFor('document.querySelector(".drawer")');
    await evaluate(`Array.from(document.querySelectorAll('.drawer button')).find(button => button.textContent.trim() === 'Themes').click()`);
    await waitFor('document.querySelector(".theme-categories")');
    await click('button[aria-label="See all 24 Scenic themes"]');
    expect(await evaluate('document.querySelectorAll(".theme-section .theme-tile").length')).toBe(24);
    await evaluate(`Array.from(document.querySelectorAll('.theme-categories button')).find(button => button.textContent === 'Gradients & Colors').click()`);
    await evaluate(`Array.from(document.querySelectorAll('.theme-tile')).find(button => button.textContent.includes('Porcelain Sky')).click()`);
    await waitFor('document.documentElement.classList.contains("theme-light")');
    await evaluate(`Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Apply to all modes').click()`);
    expect(await evaluate(`import('/src/state/settings.ts').then(({settings}) => Object.values(settings.get().themes).map(ref => ref.id))`)).toEqual(['porcelain-sky', 'porcelain-sky', 'porcelain-sky']);
    await evaluate(`import('/src/state/settings.ts').then(({settings,settingsUpdate}) => {
      settingsUpdate('extras', {disableAnimated:false, reduceMotion:false});
      settingsUpdate('themes', {[settings.get().dash]:{kind:'library',id:'tide-pools'}});
    })`);
    await waitFor('document.querySelector(".bg.anim-tide-pools")');
    expect(await evaluate('getComputedStyle(document.querySelector(".bg")).animationName')).toBe('tide-pools');
    await evaluate(`Object.defineProperty(document, 'hidden', { configurable:true, value:true }); document.dispatchEvent(new Event('visibilitychange'));`);
    expect(await evaluate('getComputedStyle(document.querySelector(".bg")).animationPlayState')).toBe('paused');
    await evaluate(`delete document.hidden; document.dispatchEvent(new Event('visibilitychange'));`);
    expect(await evaluate('getComputedStyle(document.querySelector(".bg")).animationPlayState')).toBe('running');
    await evaluate(`import('/src/state/settings.ts').then(({settingsUpdate}) => settingsUpdate('extras',{reduceMotion:true}))`);
    await waitFor('document.documentElement.classList.contains("reduce-motion")');
    expect(await evaluate('getComputedStyle(document.querySelector(".bg")).animationName')).toBe('none');
    await evaluate(`import('/src/state/settings.ts').then(({settingsUpdate}) => settingsUpdate('extras',{reduceMotion:false}))`);
    await send('Emulation.setEmulatedMedia', { features: [{ name:'prefers-reduced-motion', value:'reduce' }] });
    expect(await evaluate('getComputedStyle(document.querySelector(".bg")).animationName')).toBe('none');
    await send('Emulation.setEmulatedMedia', { features: [] });
    await evaluate(`import('/src/state/settings.ts').then(({settingsUpdate}) => settingsUpdate('extras',{disableAnimated:true}))`);
    await waitFor('!document.querySelector(".bg.anim-tide-pools")');
    expect(await evaluate('getComputedStyle(document.querySelector(".bg")).animationName')).toBe('none');
    writeFileSync(join(shots, "catalog-theme-check.png"), Buffer.from((await send("Page.captureScreenshot")).data, "base64"));
    expect(errors).toEqual([]);
  }, 20000);
});
