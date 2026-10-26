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
describe.skipIf(!chromePath || process.env.AMBIENT_BROWSER !== "1")("job 23 in the rendered dashboard (isolated headless Chrome)", () => {
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
  const click = async (selector: string) => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await delay(30);
  };
  const shots = process.env.SHOTS_DIR ?? tmpdir();
  beforeAll(async () => {
    mkdirSync(shots, { recursive: true });
    server = await createServer({ server: { host: "127.0.0.1", port: 0, hmr: false, watch: null }, clearScreen: false });
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

  const reloadDashboard = async () => {
    const previousDocument = await evaluate("performance.timeOrigin");
    await send("Page.reload", { ignoreCache: true });
    // The old dock can still exist when Page.reload acknowledges the command.
    await waitFor(`performance.timeOrigin !== ${previousDocument} && document.readyState === 'complete' && document.querySelector('[data-panel="sounds"]')`);
  };

  it.each([false, true])("runs the mini timer, preferences, four-hour ETA and SoundCloud favourites (desktop=%s)", async desktop => {
    await reloadDashboard();
    errors.length = 0;
    await evaluate(`(async () => {
      const { settings, DEFAULT_SETTINGS } = await import('/src/state/settings.ts');
      const { timer, timerActions } = await import('/src/state/timer.ts');
      const { transitionStore } = await import('/src/ui/timer/TransitionStore.tsx');
      const { mixerStore } = await import('/src/audio/mixer.ts');
      const { tasks } = await import('/src/state/tasks.ts');
      await Promise.all([settings.ready, timer.ready, tasks.ready, mixerStore.ready]);
      timerActions.pause(); timer.set({ ...(await import('/src/state/timerEngine.ts')).INITIAL_TIMER, segId: 'ambient-browser-test' }); transitionStore.dismiss();
      window.desktop = ${desktop ? "{ armAlarm: async () => true, disarmAlarm() {}, setStatus() {}, attention() {}, release() {} }" : "undefined"};
      settings.set({ ...DEFAULT_SETTINGS, dash: 'ambient', timer: { ...DEFAULT_SETTINGS.timer, alertSound: 'none', speak: false, notify: false, takeover: false, bringToFront: false }, clock: { ...DEFAULT_SETTINGS.clock, flip: true }, themes: { home: { kind: 'library', id: 'dusk-glass' }, ambient: { kind: 'library', id: 'dusk-glass' }, focus: { kind: 'library', id: 'dusk-glass' } } });
      mixerStore.set({ ...mixerStore.get(), favourites: [] });
      tasks.set([{ id: 'long-task', title: 'Read four chapters', done: false, createdAt: Date.now() }]);
    })()`);
    await waitFor("document.querySelector('[aria-label=\"Start ambient timer\"]')");
    await click('[aria-label="Start ambient timer"]');
    await waitFor("document.querySelector('[aria-label=\"Pause ambient timer\"]')");
    await evaluate("document.querySelector('[aria-label=\"Pause ambient timer\"]').focus()");
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " " });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
    await waitFor("document.querySelector('[aria-label=\"Start ambient timer\"]')");
    // Other jobs can add an optional pause prompt; dismiss it before continuing.
    await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Dismiss')?.click()");
    await click('[aria-label="Skip ambient segment"]');
    await waitFor("document.querySelector('.ambient-timer-segment').textContent === 'Short break'");
    await click('[aria-label="Start ambient timer"]');
    await evaluate("import('/src/state/settings.ts').then(({settingsUpdate}) => settingsUpdate('extras', {clearMode: true}))");
    await waitFor("document.querySelector('.ambient-timer').inert && getComputedStyle(document.querySelector('.ambient-timer')).opacity === '0'");
    await evaluate("document.body.dispatchEvent(new KeyboardEvent('keydown', {key: 'Shift', bubbles: true}))");
    await waitFor("!document.querySelector('.ambient-timer').inert");
    await click('[aria-label="Pause ambient timer"]');
    await evaluate("import('/src/state/settings.ts').then(({settingsUpdate}) => settingsUpdate('extras', {clearMode: false}))");

    await click('[aria-label="Settings (S)"]');
    await buttonText("Clock");
    const streakEnabled = await evaluate(`(() => {
      const toggle = [...document.querySelectorAll('label, .opt')].find(e => e.textContent.includes('Show dashboard streak'))?.querySelector('input');
      toggle?.click(); return !!toggle;
    })()`);
    expect(streakEnabled).toBe(false);
    await buttonText("Fern");
    await buttonText("Quotes");
    await evaluate("[...document.querySelectorAll('label.opt')].find(e => e.textContent.includes('Shuffle quote categories daily')).querySelector('input').click()");
    await waitFor("document.querySelector('#quote-category').disabled");
    await buttonText("Focus Timer");
    await evaluate(`(() => {
      const select = document.querySelector('.drawer select'); select.value = 'countdown';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitFor("[...document.querySelectorAll('label.opt')].some(e => e.textContent.includes('Repeat countdown'))");
    await evaluate("[...document.querySelectorAll('label.opt')].find(e => e.textContent.includes('Repeat countdown')).querySelector('input').click()");
    expect(await evaluate("import('/src/state/settings.ts').then(({settings}) => settings.get().timer.countdownRepeat)")).toBe(true);
    await click('[aria-label="Close settings · Escape"]');
    await waitFor("!document.querySelector('.dashboard-streak') && document.querySelector('.face-flip').style.getPropertyValue('--flip-tile') === '#304737'");
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 800, deviceScaleFactor: 1, mobile: false });
    expect(await evaluate(`(() => { const r = document.querySelector('.ambient-timer').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom < innerHeight; })()`)).toBe(true);
    if (!desktop) {
      const png = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(shots, "pomodoro-job23-ambient.png"), Buffer.from(png.data, "base64"));
    }
    await send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 800, deviceScaleFactor: 1, mobile: false });

    await buttonText("Home");
    await waitFor("document.querySelector('.quote')");
    expect(await evaluate(`(async () => {
      const { dailyQuoteCategory, quoteForDay } = await import('/src/data/quotes.ts');
      const expected = quoteForDay(dailyQuoteCategory('all', new Date(), true));
      return document.querySelector('.quote').textContent.includes(expected.text);
    })()`)).toBe(true);
    await buttonText("Ambient");
    await click('[data-panel="tasks"]');
    await click('[aria-label="Estimate for Read four chapters"]');
    await input('[aria-label="Custom estimate in minutes"]', "240");
    await evaluate("document.querySelector('.tasks-custom-eta').requestSubmit()");
    await waitFor("document.querySelector('[aria-label=\"Estimate for Read four chapters\"]').textContent === '240m'");
    await evaluate(`(async () => {
      const { settings, settingsUpdate } = await import('/src/state/settings.ts');
      const { timer, timerActions } = await import('/src/state/timer.ts');
      timerActions.goTo('focus'); settingsUpdate('timer', { mode: 'pomodoro', taskEta: true }); timerActions.start();
      if (timer.get().frozenTotal !== 240 * 60000) throw new Error('ETA did not reach timer');
      timerActions.pause(); timerActions.reset();
      settingsUpdate('timer', { mode: 'countdown', countdownRepeat: true, autoRun: 'off' });
      timerActions.start();
      timer.set({ ...timer.get(), startedAt: Date.now() - timer.get().frozenTotal });
      timerActions.complete(timer.get().segId);
      if (timer.get().segment !== 'focus' || timer.get().startedAt === null) throw new Error('Countdown did not repeat');
      timerActions.pause();
    })()`);
    await evaluate("document.body.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}))");
    await click('[data-panel="sounds"]');
    await buttonText("My Music");
    expect(await evaluate("document.querySelector('.sounds-player iframe') === null")).toBe(true);
    const share = "https://soundcloud.com/example-artist/sets/quiet-hours";
    await input('.sounds-url input', share);
    await buttonText("Load player");
    await waitFor("document.querySelector('.sounds-player iframe')?.src.startsWith('https://w.soundcloud.com/player/?url=')");
    const widget = new URL(await evaluate("document.querySelector('.sounds-player iframe').src"));
    expect([...widget.searchParams]).toEqual([["url", share]]);
    await buttonText("Save to favourites");
    expect(await evaluate("document.querySelector('.sounds-favourites').textContent")).toContain("SoundCloud");
    await buttonText("Stop music");
    await evaluate("import('/src/lib/store.ts').then(({flushAll}) => flushAll())");
    await reloadDashboard();
    await click('[data-panel="sounds"]');
    await buttonText("My Music");
    await buttonText("SoundCloud");
    await waitFor("document.querySelector('.sounds-player iframe')");
    expect(await evaluate("document.querySelector('.sounds-url input').value")).toBe(share);
    await buttonText("Stop music");
    await input('.sounds-url input', share + "?url=https://evil.test/");
    await buttonText("Load player");
    expect(await evaluate("document.querySelector('.sounds-player iframe') === null")).toBe(true);
    expect(await evaluate("document.querySelector('.sounds-status').textContent")).toContain("full HTTPS music link");
    await click('[aria-label="Close sounds · Escape"]');
    expect(errors).toEqual([]);
  }, 20000);
});
