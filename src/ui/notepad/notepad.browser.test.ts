import { chromeArgs } from "../../../scripts/browser/chrome-args.ts";
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
describe.skipIf(!chromePath || process.env.NOTEPAD_BROWSER !== "1")("notepad and interruptions in the rendered dashboard (isolated headless Chrome)", () => {
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
    throw new Error(`Dashboard did not reach: ${expression}; errors: ${JSON.stringify(errors)}; page: ${await evaluate("document.body.innerHTML")}`);
  };
  const click = async (selector: string) => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await delay(30);
  };

  const shots = process.env.SHOTS_DIR ?? tmpdir();
  beforeAll(async () => {
    mkdirSync(shots, { recursive: true });
    server = await createServer({ server: { host: "127.0.0.1", port: 0 }, clearScreen: false });
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === "string") throw new Error("No test server port");
    origin = `http://127.0.0.1:${address.port}`;
    const probe = await fetch(origin);
    expect(probe.headers.get("content-type")).toContain("text/html");
    profile = mkdtempSync(join(tmpdir(), "pomodoro-notepad-test-"));
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

  const key = async (key: string, code: string, windowsVirtualKeyCode: number) => {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode, ...(key === "Enter" ? { text: "\r" } : key.length === 1 ? { text: key } : {}) });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
    await delay(30);
  };
  const setText = async (selector: string, text: string) => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus(); document.querySelector(${JSON.stringify(selector)}).select()`);
    await send("Input.insertText", { text }); await delay(40);
  };
  const button = async (label: string) => {
    await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent === ${JSON.stringify(label)}).click()`); await delay(40);
  };
  it("edits, formats, ticks checklists, blocks HTML, and restores notes after reload", async () => {
    await evaluate(`(async () => {
      const { notes } = await import('/src/state/notes.ts'); await notes.ready; notes.set('legacy text');
      const { settings } = await import('/src/state/settings.ts'); settings.set({ ...settings.get(), dash: 'focus', extras: { ...settings.get().extras, clearMode: false } });
    })()`);
    await click('[data-panel="notes"]');
    await waitFor(`document.querySelector('textarea[aria-label="Notes"]')?.value === 'legacy text'`);
    await setText('textarea[aria-label="Notes"]', 'Draft');
    await evaluate(`document.querySelector('.note-source').select()`); await delay(40);
    await click('button[aria-label="Bold"]');
    expect(await evaluate(`document.querySelector('.note-source').value`)).toBe('**Draft**');
    expect(await evaluate(`document.querySelector('.note-preview strong').textContent`)).toBe('Draft');
    await setText('.note-source', 'Plan'); await click('button[aria-label="Heading"]');
    expect(await evaluate(`document.querySelector('.note-preview h2').textContent`)).toBe('Plan');
    await setText('.note-source', 'Write draft'); await click('button[aria-label="Checklist"]');
    await evaluate(`document.querySelector('.note-preview input[type=checkbox]').focus()`);
    await key(' ', 'Space', 32);
    expect(await evaluate(`document.querySelector('.note-source').value`)).toBe('- [x] Write draft');
    await setText('.note-source', '<img src=x onerror=alert(1)>\n[bad](javascript:alert)\n[Read](https://example.com)');
    expect(await evaluate(`document.querySelector('.note-preview img')`)).toBeNull();
    expect(await evaluate(`document.querySelector('.note-preview a').href`)).toBe('https://example.com/');
    expect(await evaluate(`document.querySelector('.note-preview').textContent`)).toContain('<img src=x onerror=alert(1)>');
    await setText('.note-source', '## Plan\n- [x] Write **draft**\n1. Review *carefully*');
    await evaluate(`import('/src/lib/store.ts').then(({ flushAll }) => flushAll())`);
    writeFileSync(join(shots, "notepad-editor.png"), Buffer.from((await send("Page.captureScreenshot")).data, "base64"));
    const previousDocument = await evaluate("performance.timeOrigin");
    await send('Page.reload');
    await waitFor(`performance.timeOrigin !== ${previousDocument} && document.readyState === 'complete' && document.querySelector('[data-panel="notes"]')`);
    await click('[data-panel="notes"]');
    await waitFor(`document.querySelector('.note-source')?.value.includes('Write **draft**')`);
    expect(await evaluate(`document.querySelector('.note-preview input').checked`)).toBe(true);
    await click('button[aria-label^="Close notepad"]');
    expect(errors).toEqual([]);
  });
  it("captures an optional pause reason, retains Keep drafts, and reviews them with parked thoughts", async () => {
    await evaluate(`(async () => {
      const { timerActions } = await import('/src/state/timer.ts'); const { tasks } = await import('/src/state/tasks.ts');
      const { settings, calmFoundationReady } = await import('/src/state/settings.ts'); await calmFoundationReady; settings.set({ ...settings.get(), timer: { ...settings.get().timer, interruptionPrompt: true, alertSound: 'none', notify: false, speak: false } });
      tasks.set([{ id: 'test-task', title: 'Write draft', done: false, createdAt: Date.now() }]); timerActions.goTo('focus'); timerActions.start();
    })()`);
    await waitFor(`document.querySelector('button[aria-label^="Pause"]')`); await click('button[aria-label^="Pause"]');
    await waitFor(`document.querySelector('.interruption-capture')`);
    await button('Keep'); await button('Phone'); await setText('.interruption-capture textarea', 'Call back later');
    await delay(8200);
    expect(await evaluate(`document.querySelector('.interruption-capture textarea').value`)).toBe('Call back later');
    expect(await evaluate(`document.querySelector('.interruption-capture').textContent`)).not.toContain('Closes in');
    writeFileSync(join(shots, "notepad-interruption.png"), Buffer.from((await send("Page.captureScreenshot")).data, "base64"));
    await button('Save interruption');
    expect(await evaluate(`document.querySelector('.interruption-capture')`)).toBeNull();
    const saved = await evaluate(`import('/src/state/parked.ts').then(({getInterruptions}) => getInterruptions())`);
    expect(saved).toHaveLength(1); expect(saved[0]).toMatchObject({ kind: 'interruption', tag: 'Phone', text: 'Call back later', taskId: 'test-task' });
    await click('[data-panel="notes"]');
    expect(await evaluate(`document.querySelector('.parking-lot').textContent`)).toContain('Interruption · Phone');
    await click('.note-preference input'); await click('button[aria-label^="Close notepad"]');
    await evaluate(`import('/src/state/timer.ts').then(({timerActions}) => { timerActions.start(); timerActions.pause(); })`); await delay(80);
    expect(await evaluate(`document.querySelector('.interruption-capture')`)).toBeNull();
    // 6d37432 / 04dc28c: reminders are buttonless; optional review lives in the recovery card.
    await evaluate(`(async () => {
      const { timerActions } = await import('/src/state/timer.ts'); timerActions.goTo('short');
      const { openParkingReview } = await import('/src/state/parkingReview.ts'); openParkingReview();
    })()`);
    await waitFor(`document.querySelector('[aria-label="Review parked thoughts"]')`);
    expect(await evaluate(`document.querySelector('[aria-label="Review parked thoughts"]').textContent`)).toContain('Call back later');
    expect(errors).toEqual([]);
    await button('Review later');
  }, 16000);
  it("dismisses unsaved interruption drafts after eight seconds", async () => {
    await evaluate(`(async () => {
      const { calmFoundationReady } = await import('/src/state/settings.ts'); await calmFoundationReady;
      const { setInterruptionPrompt } = await import('/src/state/notes.ts'); setInterruptionPrompt(true);
      const { timerActions } = await import('/src/state/timer.ts'); timerActions.goTo('focus'); timerActions.start(); timerActions.pause();
    })()`);
    await waitFor(`document.querySelector('.interruption-capture')`);
    await delay(8200);
    expect(await evaluate(`document.querySelector('.interruption-capture')`)).toBeNull();
    expect(await evaluate(`import('/src/state/parked.ts').then(({getInterruptions}) => getInterruptions().length)`)).toBe(1);
    expect(errors).toEqual([]);
  }, 12000);
});
