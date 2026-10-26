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
describe.skipIf(!chromePath || process.env.PARKING_BROWSER !== "1")("parking lot in the rendered dashboard (isolated headless Chrome)", () => {
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
    profile = mkdtempSync(join(tmpdir(), "pomodoro-parking-test-"));
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
  it("captures without pausing, restores focus, guards typing, and reviews in breaks and Notepad", async () => {
    await evaluate(`(async () => {
      const { settings, calmFoundationReady } = await import('/src/state/settings.ts'); await calmFoundationReady;
      settings.set({ ...settings.get(), dash: 'focus', extras: { ...settings.get().extras, clearMode: false }, timer: { ...settings.get().timer, interruptionPrompt: false, alertSound: 'none', notify: false, speak: false, bringToFront: false } });
      const { parked } = await import('/src/state/parked.ts'); await parked.ready; parked.set([]);
      const { timerActions } = await import('/src/state/timer.ts'); timerActions.start();
    })()`);
    await waitFor('document.querySelector("button[aria-label^=Pause]")');
    const before = await evaluate(`import('/src/state/timer.ts').then(({timer}) => ({ segId: timer.get().segId, startedAt: timer.get().startedAt }))`);
    await evaluate(`document.querySelector('button[aria-label^=Reset]').focus()`);
    await key("p", "KeyP", 80);
    await waitFor('document.activeElement?.id === "park-thought"');
    await send("Input.insertText", { text: "Read this after focus" });
    writeFileSync(join(shots, "parking-capture.png"), Buffer.from((await send("Page.captureScreenshot")).data, "base64"));
    await key("Enter", "Enter", 13);
    expect(await evaluate('document.querySelector("#park-thought")')).toBeNull();
    expect(await evaluate('document.activeElement?.getAttribute("aria-label")')).toBe("Reset this session · R");
    expect(await evaluate('document.body.textContent')).toContain("Parked");
    expect(await evaluate('document.body.textContent')).toContain("1 parked");
    expect(await evaluate('document.body.textContent')).not.toContain("Read this after focus");
    expect(await evaluate(`import('/src/state/timer.ts').then(({timer}) => ({ segId: timer.get().segId, startedAt: timer.get().startedAt }))`)).toEqual(before);
    await key("p", "KeyP", 80); await send("Input.insertText", { text: "discard" }); await key("Escape", "Escape", 27);
    expect(await evaluate(`import('/src/state/parked.ts').then(({parked}) => parked.get().length)`)).toBe(1);
    await click('[data-panel="notes"]');
    await evaluate('document.querySelector("textarea").focus()');
    await key("p", "KeyP", 80);
    expect(await evaluate('!!document.querySelector("#park-thought")')).toBe(false);
    expect(await evaluate('document.querySelector("textarea").value')).toBe("p");
    // Notepad can review during focus; the dashboard itself only reveals the count.
    expect(await evaluate('document.querySelector(".parking-lot").textContent')).toContain("Read this after focus");
    await click('button[aria-label^="Close notepad"]');
    await evaluate(`import('/src/state/timer.ts').then(({timerActions}) => timerActions.pause())`);
    // 04dc28c: the count opens a recovery card after the saved pause context is dismissed.
    await click('.recovery-heading button');
    await click('.park-chip');
    await waitFor('document.querySelector(".recovery-card")');
    await evaluate(`[...document.querySelectorAll('.recovery-buttons button')].find(b => b.textContent === 'Review later').click()`);
    expect(await evaluate('!!document.querySelector(".recovery-card")')).toBe(false);
    expect(await evaluate(`import('/src/state/parked.ts').then(({parked}) => parked.get()[0].status)`)).toBe("open");
    await click('.park-chip');
    await evaluate(`[...document.querySelectorAll('.recovery-buttons button')].find(b => b.textContent === 'Make a task').click()`);
    await waitFor(`import('/src/state/parked.ts').then(({parked}) => parked.get()[0].status === 'tasked')`);
    expect(await evaluate(`import('/src/state/tasks.ts').then(({tasks}) => tasks.get().some(t => t.title === 'Read this after focus' && !t.done))`)).toBe(true);
    await click('[data-panel="notes"]');
    await click('.parking-lot input[type=checkbox]');
    expect(await evaluate('document.querySelector(".parking-lot").textContent')).toContain("Made into a task");
    await click('button[aria-label^="Close notepad"]');
  });
  it("reports a failed Mac shortcut registration in Settings", async () => {
    await evaluate(`window.desktop = { parkingStatus: async () => ({ registered: false }) }`);
    await click('[aria-label="Settings (S)"]');
    await evaluate(`[...document.querySelectorAll('.drawer nav .tab')].find(button => button.textContent.includes('Extras')).click()`);
    await waitFor(`document.querySelector('.drawer').textContent.includes('Couldn’t register ⌥⌘P')`);
    expect(await evaluate(`document.querySelector('.drawer').textContent`)).toContain('You can still use P');
    await click('button[aria-label^="Close settings"]');
    await evaluate('window.desktop = undefined');
  });
  it("shows older open thoughts at break and cycle completion with keyboard reachable actions", async () => {
    // 6d37432 removed parking from the glass reminder; 04dc28c adds opt-in boundary review.
    await evaluate(`(async () => {
      const { timerActions } = await import('/src/state/timer.ts'); timerActions.reset(); timerActions.goTo('short');
      const { parkThought, parked } = await import('/src/state/parked.ts'); parked.set([]); parkThought('An older idea', { segment: 'focus', segId: 'older' });
      const { parkingReview, EMPTY_PARKING_REVIEW, chooseReviewBoundary, queueParkingReview } = await import('/src/state/parkingReview.ts');
      parkingReview.set(EMPTY_PARKING_REVIEW); chooseReviewBoundary('block'); queueParkingReview('block', 'review');
    })()`);
    await waitFor('document.querySelector(".recovery-card")');
    expect(await evaluate('document.querySelector(".recovery-card").textContent')).toContain("An older idea");
    await evaluate('document.querySelector(".recovery-buttons button").focus()');
    expect(await evaluate('document.activeElement.textContent')).toBe("Keep");
    // Keyboard navigation resumes after the card has had a quiet keyboard.
    await delay(1600);
    for (const label of ["Make a task", "Drop", "Review later"]) {
      await key("Tab", "Tab", 9);
      expect(await evaluate('document.activeElement.textContent')).toBe(label);
    }
    await evaluate('document.querySelector(".recovery-buttons button").focus()');
    await key("Enter", "Enter", 13);
    expect(await evaluate(`import('/src/state/parked.ts').then(({parked}) => parked.get()[0].status)`)).toBe("open");
    // Done remains available in Notepad history and works from the keyboard during a break.
    await click('[data-panel="notes"]');
    await evaluate(`[...document.querySelectorAll('.parked-actions button')].find(b => b.textContent === 'Done').focus()`);
    await key("Enter", "Enter", 13);
    expect(await evaluate(`import('/src/state/parked.ts').then(({parked}) => parked.get().find(p => p.text === 'An older idea').status)`)).toBe("done");
    await click('button[aria-label^="Close notepad"]');
    await evaluate(`(async () => {
      const { parkThought } = await import('/src/state/parked.ts'); parkThought('Cycle idea', { segment: 'focus' });
      const { chooseReviewBoundary, queueParkingReview } = await import('/src/state/parkingReview.ts');
      chooseReviewBoundary('session'); queueParkingReview('session', 'cycle-review');
    })()`);
    await waitFor('document.querySelector(".recovery-card").textContent.includes("Cycle idea")');
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 540, deviceScaleFactor: 1, mobile: false });
    writeFileSync(join(shots, "parking-review.png"), Buffer.from((await send("Page.captureScreenshot")).data, "base64"));
    const actions = await evaluate(`[...document.querySelectorAll('.recovery-buttons button')].map(b => { b.scrollIntoView({block:'nearest'}); const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })`);
    expect(actions).toHaveLength(4); expect(actions.every(Boolean)).toBe(true);
  });
  it("deletes the last dashboard item, done items and interruptions with five-second Undo, including break review", async () => {
    await evaluate(`(async () => {
      const {transitionStore} = await import('/src/ui/timer/TransitionStore.tsx'); transitionStore.dismiss();
      const {timerActions} = await import('/src/state/timer.ts'); timerActions.reset();
      const {parkingReview, EMPTY_PARKING_REVIEW} = await import('/src/state/parkingReview.ts'); parkingReview.set(EMPTY_PARKING_REVIEW);
      const {settings} = await import('/src/state/settings.ts'); settings.set({...settings.get(),dash:'focus'});
      const {parked} = await import('/src/state/parked.ts'); parked.set([{id:'delete-open',text:'Delete this thought',at:Date.now(),segment:'focus',status:'open'}]);
    })()`);
    await waitFor('document.querySelector(".park-chip")');
    await click('.park-chip');
    await waitFor('document.querySelector(".recovery-card")');
    await evaluate(`[...document.querySelectorAll('.recovery-buttons button')].find(b => b.textContent === 'Drop').click()`);
    await waitFor('!document.querySelector(".recovery-card") && document.querySelector(".delete-undo-toast")');
    expect(await evaluate(`import('/src/state/parked.ts').then(({parked}) => parked.get())`)).toEqual([]);
    await click('.delete-undo-toast button');
    await click('.park-chip');
    await waitFor('document.querySelector(".recovery-card").textContent.includes("Delete this thought")');
    await click('[data-panel="notes"]');
    await evaluate(`(async () => {
      const {parked,taskThought} = await import('/src/state/parked.ts');
      parked.set([...parked.get(),{id:'delete-done',text:'Finished interruption',kind:'interruption',tag:'Phone',at:Date.now(),segment:'focus',status:'done'},
        {id:'delete-tasked',text:'Converted thought',at:Date.now(),segment:'focus',status:'open'}]); taskThought('delete-tasked');
    })()`);
    await click('[aria-label=Notepad] .parking-lot input[type=checkbox]');
    await waitFor('document.querySelector("[aria-label=Notepad] .parking-lot").textContent.includes("Finished interruption")');
    await evaluate(`[...document.querySelectorAll('[aria-label=Notepad] .parked-list li')].find(li => li.textContent.includes('Finished interruption')).querySelector('button[aria-label=Delete]').click()`);
    await waitFor('!document.querySelector("[aria-label=Notepad] .parking-lot").textContent.includes("Finished interruption")');
    await click('.delete-undo-toast button');
    await waitFor('document.querySelector("[aria-label=Notepad] .parking-lot").textContent.includes("Finished interruption")');
    await click('[aria-label=Notepad] .parked-clear');
    await waitFor('!document.querySelector("[aria-label=Notepad] .parking-lot").textContent.includes("Converted thought")');
    expect(await evaluate(`import('/src/state/tasks.ts').then(({tasks}) => tasks.get().some(t => t.title === 'Converted thought'))`)).toBe(true);
    await click('.delete-undo-toast button');
    await waitFor('document.querySelector("[aria-label=Notepad] .parking-lot").textContent.includes("Converted thought")');
    await click('[aria-label=Notepad] .parked-clear');
    await waitFor('document.querySelector(".delete-undo-toast")');
    await delay(5150);
    expect(await evaluate('!!document.querySelector(".delete-undo-toast")')).toBe(false);
    expect(await evaluate(`import('/src/state/parked.ts').then(({parked}) => parked.get().length)`)).toBe(1);
    await click('button[aria-label^="Close notepad"]');
    await evaluate(`(async () => {
      const {parked} = await import('/src/state/parked.ts'); parked.set([{id:'review-delete',text:'Review interruption',kind:'interruption',tag:'Phone',at:Date.now(),segment:'focus',status:'open'}]);
      const {parkingReview, EMPTY_PARKING_REVIEW, chooseReviewBoundary, queueParkingReview} = await import('/src/state/parkingReview.ts');
      parkingReview.set(EMPTY_PARKING_REVIEW); chooseReviewBoundary('block'); queueParkingReview('block', 'delete-review');
    })()`);
    await waitFor('document.querySelector(".recovery-card").textContent.includes("Review interruption")');
    await evaluate(`[...document.querySelectorAll('.recovery-buttons button')].find(b => b.textContent === 'Drop').click()`);
    await waitFor('document.querySelector(".delete-undo-toast button")');
    await evaluate('document.querySelector(".delete-undo-toast button").focus()');
    await key('Enter','Enter',13);
    await click('.park-chip');
    await waitFor('document.querySelector(".recovery-card").textContent.includes("Review interruption")');
    expect(errors).toEqual([]);
  }, 15000);

});
