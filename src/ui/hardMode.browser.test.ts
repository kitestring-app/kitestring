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
describe.skipIf(!chromePath || process.env.HARD_MODE_BROWSER !== "1")("hard mode in the rendered dashboard (isolated headless Chrome)", () => {
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
      if (await evaluate(`Boolean(${expression})`)) return;
      await delay(50);
    }
    throw new Error(`Dashboard did not reach: ${expression}; ${JSON.stringify(errors)}; ${await evaluate("(location.href + document.documentElement.outerHTML.slice(0, 1200))")}`);
  };
  const shots = process.env.SHOTS_DIR ?? tmpdir();
  beforeAll(async () => {
    mkdirSync(shots, { recursive: true });
    server = await createServer({ configLoader: "runner", cacheDir: join(tmpdir(), "pomodoro-hard-mode-vite"), server: { host: "127.0.0.1", port: 0, hmr: false, watch: null }, clearScreen: false });
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === "string") throw new Error("No test server port");
    origin = `http://127.0.0.1:${address.port}`;
    profile = mkdtempSync(join(tmpdir(), "pomodoro-hard-mode-test-"));
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
      const button = [...document.querySelectorAll('button')].find(b => (b.querySelector('.lbl')?.textContent.trim() ?? b.textContent.trim()) === ${JSON.stringify(text)} && b.getBoundingClientRect().width);
      button?.click(); return !!button;
    })()`);
    expect(found, `Visible button: ${text}`).toBe(true);
    await delay(40);
  };
  const input = async (selector: string, value: string) => {
    await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await delay(40);
  };

  const setup = async (mini: boolean, native: boolean) => {
    await evaluate(`(async () => {
      const { settings, DEFAULT_SETTINGS } = await import('/src/state/settings.ts');
      const { timer, timerActions, runTimerCommand } = await import('/src/state/timer.ts');
      const { stats } = await import('/src/state/stats.ts');
      const { parked } = await import('/src/state/parked.ts');
      const { transitionStore } = await import('/src/ui/timer/TransitionStore.tsx');
      await Promise.all([timer.ready, settings.ready, stats.ready, parked.ready]);
      timer.set({ ...(await import('/src/state/timerEngine.ts')).INITIAL_TIMER, segId: 'hard-browser-' + Math.random() });
      stats.set({ chunks: [], tasksDone: [] }); parked.set([]); transitionStore.dismiss();
      window.desktop = ${native ? "{ timerControl: runTimerCommand, showMain() { void import('/src/ui/hardMode.browser-fixture.tsx').then(f => f.restoreMain()) }, requestAudioState() {}, requestTimerState() {}, armAlarm: async () => true, disarmAlarm() {}, release() {} }" : "undefined"};
      settings.set({ ...DEFAULT_SETTINGS, dash: 'focus', timer: { ...DEFAULT_SETTINGS.timer, hardMode: true, notify: false, speak: false, focusDoneSound: 'none', breakOverSound: 'none', bringToFront: false }, themes: { home: { kind: 'library', id: 'dusk-glass' }, ambient: { kind: 'library', id: 'dusk-glass' }, focus: { kind: 'library', id: 'dusk-glass' } } });
      timerActions.start();
      ${mini ? "await (await import('/src/ui/hardMode.browser-fixture.tsx')).mountMini(" + native + ");" : "document.getElementById('root').style.display = ''; document.getElementById('test-mini')?.remove();"}
    })()`);
    await waitFor(mini ? "document.querySelector('.mini-timer')" : "[...document.querySelectorAll('button')].some(b => b.textContent === 'End session' && b.getBoundingClientRect().width)");
  };
  const running = () => evaluate("import('/src/state/timer.ts').then(({timer}) => timer.get().startedAt !== null)");
  // Enter needs its character event for the browser to submit the reason form.
  const key = (type: string, value: string) => send("Input.dispatchKeyEvent", { type, key: value, code: value === " " ? "Space" : value === "Enter" ? "Enter" : `Key${value.toUpperCase()}`, windowsVirtualKeyCode: value === " " ? 32 : value === "Enter" ? 13 : value.toUpperCase().charCodeAt(0), ...(value === "Enter" ? { text: "\r" } : {}) });

  it.each([[false, false], [true, false], [true, true]])("blocks controls and completes the keyboard hold and reason flow (mini=%s, native=%s)", async (mini, native) => {
    await setup(mini, native);
    for (const value of [" ", "r", "n"]) { await key("keyDown", value); await key("keyUp", value); }
    expect(await running()).toBe(true);
    if (mini) {
      // 6d37432 makes the floating timer display-only, so it cannot bypass Hard mode.
      const buttons = await evaluate("[...document.querySelectorAll('.mini-timer button')].map(b => b.getAttribute('aria-label'))");
      expect(buttons).toEqual(native ? ["Close floating timer", expect.stringMatching(/Open Kitestring$/), "Mute audio"] : []);
      expect(await evaluate("document.querySelector('.mini-lock') !== null")).toBe(true);
      if (native) await evaluate("document.querySelector('.mini-digits').click()");
      else await evaluate("import('/src/ui/hardMode.browser-fixture.tsx').then(f => f.restoreMain())");
      await waitFor("!document.querySelector('.mini-timer') && document.getElementById('root').style.display !== 'none'");
    }
    const selector = '.controls button[aria-label*="Space"], .controls button[aria-label*=" · R"], .controls button[aria-label*=" · N"]';
    expect(await evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`)).toBe(3);
    expect(await evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].every(b => b.disabled)`)).toBe(true);
    await buttonText("End session");
    await waitFor("document.querySelector('.end-session[open]')");
    expect(await evaluate("document.activeElement.getAttribute('aria-label')")).toBe("Hold for 10 seconds to end session");
    await key("keyDown", " "); await delay(5000); await key("keyUp", " ");
    expect(await evaluate("document.querySelector('.end-session-hold').textContent.includes('Hold to continue')")).toBe(true);
    await key("keyDown", "Enter"); await delay(50);
    // Use the real hold clock. A virtual-time budget can pause React before it paints
    // the interval's completion, and leave subsequent mini renderers frozen.
    await delay(10_100);
    await waitFor("document.querySelector('.end-session input')");
    await key("keyUp", "Enter");
    expect(await running()).toBe(true);
    expect(await evaluate("document.activeElement === document.querySelector('.end-session input')")).toBe(true);
    expect(await evaluate("document.querySelector('.end-session button[type=submit]').disabled")).toBe(true);
    await input('.end-session input', 'ab');
    expect(await evaluate("document.querySelector('.end-session button[type=submit]').disabled")).toBe(true);
    await input('.end-session input', 'Urgent call');
    await send("Emulation.setEmulatedMedia", { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const screenshot = await send("Page.captureScreenshot", { format: 'png' });
    writeFileSync(join(shots, `job39-reason-${mini}-${native}.png`), Buffer.from(screenshot.data, 'base64'));
    await key("keyDown", "Enter"); await key("keyUp", "Enter");
    await waitFor("!document.querySelector('.end-session[open]')");
    expect(await running()).toBe(false);
    expect(await evaluate("import('/src/state/stats.ts').then(({stats,sessionLog}) => sessionLog(stats.get(),[])[0].sessions[0].earlyEndReason)")).toBe('Urgent call');
  }, 20000);
});
