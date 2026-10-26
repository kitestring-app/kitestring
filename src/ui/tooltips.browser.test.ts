import { chromeArgs } from "../../scripts/browser/chrome-args.ts";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Only a Chrome process launched here, with a disposable profile, is controlled.
const chromePath = [process.env.CHROME_BIN, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((path) => path && existsSync(path));

// Opt in on hosts that permit starting a loopback server and launching Chrome.
// The managed agent sandbox blocks both; keep the required unit checks usable there.
describe.skipIf(!chromePath || process.env.TOOLTIP_BROWSER !== "1")("tooltips in the rendered dashboard (isolated headless Chrome)", () => {
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
    throw new Error(`Dashboard did not reach: ${expression}; errors: ${JSON.stringify(errors)}; page: ${await evaluate("location.href + document.documentElement.outerHTML.slice(0, 2500)")}`);
  };
  const click = async (selector: string) => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await delay(30);
  };
  const auditButtons = async () => {
    const result = await evaluate(`(() => {
      const controls = [...document.querySelectorAll('button, a.iconbtn')].filter(b => !b.textContent.trim());
      return { count: controls.length, failures: controls.filter(b => !b.getAttribute('aria-label') || b.dataset.tip !== b.getAttribute('aria-label') || b.hasAttribute('title')).map(b => b.outerHTML) };
    })()`);
    expect(result.count).toBeGreaterThan(8);
    expect(result.failures).toEqual([]);
  };

  beforeAll(async () => {
    server = await createServer({ configLoader: "runner", cacheDir: join(tmpdir(), "pomodoro-tooltip-vite"), server: { host: "127.0.0.1", port: 0, hmr: false, watch: null }, clearScreen: false });
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === "string") throw new Error("No test server port");
    origin = `http://127.0.0.1:${address.port}`;
    profile = mkdtempSync(join(tmpdir(), "pomodoro-tooltip-test-"));
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
    // Settle the initial blank document before navigating, as the other browser suites do.
    await waitFor("document.readyState === 'complete'");
    expect((await fetch(origin)).status).toBe(200);
    const navigation = await send("Page.navigate", { url: origin });
    if (navigation.errorText) throw new Error(navigation.errorText);
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

  it.each([false, true])("gives every textless dashboard button a matching label and tooltip (desktop=%s)", async (desktop) => {
    await evaluate(`window.desktop = ${desktop ? "{ setStatus() {}, attention() {}, release() {} }" : "undefined"}`);
    await evaluate(`(async () => {
      const { settings } = await import('/src/state/settings.ts');
      settings.set({ ...settings.get(), dash: 'focus', extras: { ...settings.get().extras, clearMode: false } });
      const { tasks } = await import('/src/state/tasks.ts');
      tasks.set([{ id: 'tooltip-task', title: 'Review chapter', done: false, createdAt: 0 }]);
      const { mixerStore } = await import('/src/audio/mixer.ts');
      mixerStore.set({ ...mixerStore.get(), mixes: [{ id: 'tip-mix', name: 'Rain', layers: [] }], favourites: [{ id: 'tip-fav', name: 'Station', emoji: '♫', url: 'https://open.spotify.com/playlist/abc' }] });
    })()`);
    await delay(50);
    await auditButtons();
    for (const panel of ["tasks", "notes", "sounds"]) {
      await click(`[data-panel="${panel}"]`);
      await auditButtons();
      if (panel === "tasks") {
        await click(".task-color"); await auditButtons();
        await click(".tasks-colors button");
        await click(".task-emoji"); await auditButtons();
        await click(".tasks-emojis button");
      }
      if (panel === "sounds") {
        await evaluate(`([...document.querySelectorAll('.ptabs button')].find(b => b.textContent.trim() === 'Sounds')).click()`);
        await delay(30);
        await evaluate(`(() => { const s = document.querySelector('.sounds-mix-select select'); s.value = 'tip-mix'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await delay(30); await auditButtons();
        for (const tab of ["My Music", "Stations", "Radio"]) {
          await evaluate(`([...document.querySelectorAll('.ptabs button')].find(b => b.textContent.trim() === '${tab}')).click()`);
          await delay(30); await auditButtons();
        }
      }
      await click(`[data-panel="${panel}"]`);
    }
    await click('[aria-label="Settings (S)"]');
    for (const tab of ["Themes", "Clock", "Focus Timer", "Stats", "Quotes", "Extras", "Your data", "About"]) {
      await evaluate(`([...document.querySelectorAll('.drawer .tab')].find(b => b.textContent.trim() === '${tab}')).click()`);
      await delay(30); await auditButtons();
    }
    await click('[aria-label="Close settings · Escape"]');
  }, 20000);

  it("delays hover, shows keyboard focus immediately, updates labels and dismisses on Escape/blur", async () => {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await evaluate(`document.querySelector('[aria-label="Reset this session · R"]').focus()`);
    expect(await evaluate(`document.querySelector('.control-tooltip').hidden`)).toBe(false);
    expect(await evaluate(`document.querySelector('.control-tooltip').textContent`)).toBe("Reset this session · R");
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    expect(await evaluate(`document.querySelector('.control-tooltip').hidden`)).toBe(true);
    await evaluate(`document.activeElement.blur()`);
    await evaluate(`document.querySelector('[aria-label="Start · Space"]').dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))`);
    expect(await evaluate(`document.querySelector('.control-tooltip').hidden`)).toBe(true);
    await delay(180);
    expect(await evaluate(`document.querySelector('.control-tooltip').hidden`)).toBe(true);
    await delay(170);
    expect(await evaluate(`document.querySelector('.control-tooltip').textContent`)).toBe("Start · Space");
    expect(await evaluate(`document.querySelector('.control-tooltip').hidden`)).toBe(false);
    await click('[aria-label="Start · Space"]');
    await evaluate(`document.querySelector('[aria-label="Pause · Space"]').focus()`);
    expect(await evaluate(`document.querySelector('.control-tooltip').textContent`)).toBe("Pause · Space");
    await evaluate(`document.activeElement.blur()`);
    expect(await evaluate(`document.querySelector('.control-tooltip').hidden`)).toBe(true);
    await click('[aria-label="Pause · Space"]');
  });

  it("keeps tips inside every viewport edge, in dialogs, light themes and reduced motion", async () => {
    const results = await evaluate(`(() => {
      document.documentElement.classList.add('theme-light', 'reduce-motion');
      const dialog = document.createElement('dialog'); dialog.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;margin:0';
      document.body.append(dialog); dialog.showModal();
      const b = document.createElement('button'); b.ariaLabel = 'A long tooltip for a control near the edge of the viewport'; b.style.position = 'fixed'; dialog.append(b);
      const checks = [];
      for (const [x, y] of [[0,0],[innerWidth-30,0],[0,innerHeight-30],[innerWidth-30,innerHeight-30]]) {
        b.blur(); b.style.left = x+'px'; b.style.top = y+'px'; b.style.width = '30px'; b.style.height = '30px'; b.focus();
        const tip = document.querySelector('.control-tooltip'), r = tip.getBoundingClientRect(), style = getComputedStyle(tip);
        checks.push({ visible: !tip.hidden && tip.matches(':popover-open'), inside: r.left >= 8 && r.top >= 8 && r.right <= innerWidth-8 && r.bottom <= innerHeight-8, animated: style.animationName !== 'none', color: style.color, background: style.backgroundColor });
      }
      b.blur(); dialog.remove(); document.documentElement.classList.remove('theme-light', 'reduce-motion');
      return checks;
    })()`);
    expect(results).toHaveLength(4);
    for (const result of results) {
      expect(result.visible).toBe(true); expect(result.inside).toBe(true); expect(result.animated).toBe(false);
      expect(result.color).not.toBe(result.background);
    }
  });
});
