import { reloadReady } from "../../scripts/browser/reload";
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
describe.skipIf(!chromePath || process.env.RETURN_BROWSER !== "1")("Recovery and return in all five looks (isolated headless Chrome)", () => {
  let browser: ChildProcess, server: ViteDevServer, profile: string, socket: WebSocket;
  let origin = "", debugPort = "", sequence = 0;
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
    throw new Error(`Dashboard did not reach: ${expression}; ${JSON.stringify(errors)}; ${await evaluate("(location.href + document.body.innerText.slice(0, 2000))")}`);
  };
  const reload = () => reloadReady(send, evaluate, waitFor);
  const waitForOwner = () => waitFor("import('/src/state/timer.ts').then(async t => { await t.timerHydrationReady; return (await import('/src/lib/store.ts')).canWriteClockStore('timer'); })");
  beforeAll(async () => {
    server = await createServer({ configLoader: "runner", cacheDir: join(tmpdir(), "pomodoro-return-vite-cache"), server: { host: "127.0.0.1", port: 0, hmr: false, watch: null }, clearScreen: false });
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === "string") throw new Error("No test server port");
    origin = `http://127.0.0.1:${address.port}`;
    profile = mkdtempSync(join(tmpdir(), "pomodoro-return-test-"));
    browser = spawn(chromePath!, chromeArgs(profile), { stdio: ["ignore", "ignore", "pipe"] });
    let launchErrors = "";
    browser.stderr?.on("data", data => { launchErrors = (launchErrors + String(data)).slice(-8192); });
    const portFile = join(profile, "DevToolsActivePort");
    for (let n = 0; n < 150 && !existsSync(portFile); n++) await delay(50);
    if (!existsSync(portFile)) throw new Error(`Test browser launch failed: exit=${browser.exitCode}, signal=${browser.signalCode}; ${launchErrors}`);
    const port = readFileSync(portFile, "utf8").split("\n")[0];
    debugPort = port;
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
    expect(await evaluate(`(() => { const b = [...document.querySelectorAll('.recovery-card button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}); b?.click(); return !!b; })()`)).toBe(true);
    await delay(60);
  };
  const shot = async (name: string) => {
    const shots = process.env.SHOTS_DIR ?? ".agents/jobs/41-shots";
    mkdirSync(shots, { recursive: true });
    const png = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(shots, `${name}.png`), Buffer.from(png.data, "base64"));
  };
  it.each([false, true])("re-entry, saved expiry, gap decisions and all looks (native bridge=%s)", async native => {
    await send("Page.navigate", { url: "about:blank" });
    await send("Storage.clearDataForOrigin", { origin, storageTypes: "all" });
    const injection = await send("Page.addScriptToEvaluateOnNewDocument", { source: native ? `
      window.desktop = { armAlarm: async () => true, disarmAlarm() {}, release() {}, cancelSpeech() {}, onLifecycle(callback) {window.lifecycle = callback; return () => {}} };
    ` : "window.desktop = undefined;" });
    await send("Page.navigate", { url: origin });
    await waitFor("document.querySelector('.next-action')"); await waitForOwner();
    await evaluate(`Promise.all([import('/src/state/settings.ts'), import('/src/state/timer.ts'), import('/src/state/intent.ts'), import('/src/state/tasks.ts')]).then(async ([s,t,i,k]) => {
      await s.calmFoundationReady;
      s.settingsUpdate('dash', 'focus');
      i.updateIntent({action:'Write the opening paragraph', why:'Share a draft with the team', cue:'After tea', reward:'A cup of tea'});
      k.addTask({title:'Draft the proposal'});
      t.timerActions.start(); t.timerActions.pause();
    })`);
    await waitFor("document.querySelector('[aria-label=\"Session context\"]')");
    for (const [width, height] of [[1000, 800], [1280, 720]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    for (const look of ["classic", "glass", "sketch", "companion", "sunrise"]) {
      await evaluate(`import('/src/state/settings.ts').then(s => s.settingsUpdate('appearance', {look: '${look}'}))`);
      await waitFor(`document.documentElement.dataset.look === '${look}'`);
      await delay(100);
      // The pinned action is already on screen above the controls, so the card does not repeat it.
      expect(await evaluate("document.querySelector('.next-action').textContent")).toContain("Write the opening paragraph");
      expect(await evaluate("document.querySelector('.recovery-card').textContent")).not.toContain("Write the opening paragraph");
      expect(await evaluate("!!document.querySelector('.recovery-card svg')")).toBe(true);
      expect(await evaluate("(() => {const r = document.querySelector('.recovery-card').getBoundingClientRect(); return r.x >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight})()")).toBe(true);
      await assertFocusFit(evaluate);
      expect(await evaluate("document.querySelector('.recovery-card').textContent")).not.toContain("0 min recorded");
      if (!native) await shot(`reentry-${look}${width === 1000 ? "" : "-1280x720"}`);
    }}
    await click("Resume");
    await waitFor("!document.querySelector('.recovery-card')");
    expect(await evaluate("import('/src/state/timer.ts').then(t => t.timer.get().startedAt !== null)")).toBe(true);
    // Reloading an active session stops at departure and waits for explicit Resume.
    await evaluate("import('/src/lib/store.ts').then(s => s.flushReadyStores())");
    await reload(); await waitForOwner();
    await waitFor("document.querySelector('[aria-label=\"Session context\"]')");
    expect(await evaluate("import('/src/state/timer.ts').then(t => t.timer.get().startedAt !== null)")).toBe(false);
    await click("Resume");
    // Reopen a saved, expired run with Strong auto-run. It must wait for Continue.
    await evaluate(`Promise.all([import('/src/state/settings.ts'), import('/src/state/timer.ts'), import('/src/lib/store.ts')]).then(async ([s,t,p]) => {
      s.settingsUpdate('timer', {autoRun:'always'});
      t.timerActions.stop();
      await p.flushReadyStores();
      const db = await import('/src/lib/db.ts');
      await db.dbSet('timer', {...t.timer.get(), segId:'closed-run', startedAt:Date.now()-120000, elapsedBefore:0, creditedUpTo:0, frozen:true, frozenTotal:60000});
    })`);
    await reload(); await waitForOwner();
    await waitFor("document.querySelector('[aria-label=\"Finished block\"]')");
    expect(await evaluate("import('/src/state/timer.ts').then(t => t.timer.get().startedAt)")).toBeNull();
    expect(await evaluate("import('/src/state/stats.ts').then(s => s.stats.get().chunks.filter(c => c.segId === 'closed-run' && c.completed).length)")).toBe(0);
    expect(await evaluate("import('/src/state/stats.ts').then(s => s.stats.get().chunks.filter(c => c.segId === 'closed-run' && c.away).length)")).toBe(1);
    for (const [width, height] of [[1000, 800], [1280, 720]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    for (const look of ["classic", "glass", "sketch", "companion", "sunrise"]) {
      await evaluate(`import('/src/state/settings.ts').then(s => s.settingsUpdate('appearance', {look: '${look}'}))`);
      await waitFor(`document.documentElement.dataset.look === '${look}'`); await delay(100);
      expect(await evaluate("document.querySelector('.recovery-card').textContent")).toContain("Continue");
      await assertFocusFit(evaluate);
      if (!native) await shot(`missed-end-${look}${width === 1000 ? "" : "-1280x720"}`);
    }}
    await click("Continue");
    await waitFor("!document.querySelector('[aria-label=\"Finished block\"]')");
    expect(await evaluate("import('/src/state/timer.ts').then(t => t.timer.get().segment)")).toBe("focus");
    await evaluate("import('/src/state/timer.ts').then(t => t.timerActions.stop())");
    // A long-lived process receives a real gap, without restart or a date-string calculation.
    await evaluate(`import('/src/state/returnActivity.ts').then(a => {
      a.returnActivity.set({version:1,lastPurposefulAt:Date.now()-3*86400000,pendingGap:null,acknowledgedGap:null,uncertain:false});
      a.checkReturnActivity();
    })`);
    await waitFor("document.querySelector('[aria-label=\"Return to your next action\"]')");
    for (const [width, height] of [[1000, 800], [1280, 720]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    for (const look of ["classic", "glass", "sketch", "companion", "sunrise"]) {
      await evaluate(`import('/src/state/settings.ts').then(s => s.settingsUpdate('appearance', {look: '${look}'}))`);
      await waitFor(`document.documentElement.dataset.look === '${look}'`); await delay(100);
      expect(await evaluate("document.querySelector('.recovery-card').textContent")).not.toMatch(/lost|reset|overdue|missed|streak|score/i);
      await assertFocusFit(evaluate);
      if (!native) await shot(`gap-${look}${width === 1000 ? "" : "-1280x720"}`);
    }}
    await click("Drop");
    expect(await evaluate("import('/src/state/intent.ts').then(i => ({action:i.intent.get().action,why:i.intent.get().why,cue:i.intent.get().cue??null,reward:i.intent.get().reward??null}))")).toEqual({action:"",why:"",cue:null,reward:null});
    await click("Undo");
    expect(await evaluate("import('/src/state/intent.ts').then(i => ({why:i.intent.get().why,reward:i.intent.get().reward}))")).toEqual({why:"Share a draft with the team",reward:"A cup of tea"});
    expect(await evaluate("import('/src/state/intent.ts').then(i => i.intent.get().action)")).toBe("Write the opening paragraph");
    expect(await evaluate("import('/src/state/intent.ts').then(i => i.intent.get().cue)")).toBe("After tea");
    await evaluate("import('/src/lib/store.ts').then(s => s.flushReadyStores())");
    await reload(); await waitForOwner();
    await waitFor("document.querySelector('.next-action')"); await waitForOwner();
    expect(await evaluate("!!document.querySelector('[aria-label=\"Return to your next action\"]')")).toBe(false);
    await evaluate(`import('/src/state/returnActivity.ts').then(a => a.returnActivity.set({version:1,lastPurposefulAt:Date.now()-3*86400000,pendingGap:'gap:'+(Date.now()-3*86400000),acknowledgedGap:null,uncertain:false}))`);
    await waitFor("document.querySelector('[aria-label=\"Return to your next action\"]')");
    await click("Move");
    await waitFor("document.querySelector('[aria-label=\"Tasks\"]') || document.querySelector('.tasks-panel')");
    expect(await evaluate("import('/src/state/intent.ts').then(i => i.intent.get().action)")).toBe("");
    expect(await evaluate("import('/src/state/tasks.ts').then(t => t.tasks.get().length)")).toBe(1);
    await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: injection.identifier });
    expect(errors).toEqual([]);
  }, 60000);
  it.each([false, true])("PR2 round 2: Reset removes recovery, restores tiny start and starts the selected break (native bridge=%s)", async native => {
    await reload(); await waitForOwner();
    await waitFor("document.querySelector('.next-action')"); await waitForOwner();
    await evaluate(`Promise.all([import('/src/state/settings.ts'),import('/src/state/timer.ts')]).then(async ([s,t])=>{
      window.desktop = ${native ? "{armAlarm:async()=>true,disarmAlarm(){},release(){},cancelSpeech(){}}" : "undefined"};
      s.settingsUpdate('dash','focus');
      s.settingsUpdate('timer',{takeover:false,autoRun:'off',interruptionPrompt:false});
      t.timerActions.stop(); t.timerActions.start(); t.timerActions.pause();
    })`);
    await waitFor("document.querySelector('[aria-label=\"Session context\"]')");
    expect(await evaluate("!!document.querySelector('.tiny-start')")).toBe(false);
    await evaluate("document.querySelector('[aria-label=\"Reset this session · R\"]').click()");
    await waitFor("document.querySelector('.tiny-start') && !document.querySelector('.recovery-card')");
    await evaluate(`import('/src/state/timer.ts').then(t=>{
      t.timerActions.start();
      t.timer.set({...t.timer.get(),startedAt:Date.now()-1000,frozen:true,frozenTotal:1000});
      t.timerActions.complete(t.timer.get().segId);
    })`);
    await waitFor("document.querySelector('[aria-label=\"Finished block\"]')");
    await evaluate("document.querySelector('[aria-label=\"Reset this session · R\"]').click()");
    await waitFor("!document.querySelector('.recovery-card')");
    await evaluate("document.querySelector('[aria-label=\"Start · Space\"]').click()");
    expect(await evaluate("import('/src/state/timer.ts').then(t=>({segment:t.timer.get().segment,running:t.timer.get().startedAt!==null,boundary:!!t.timer.get().boundary}))")).toEqual({segment:"short",running:true,boundary:false});
    await evaluate("import('/src/state/timer.ts').then(t=>t.timerActions.stop())");
  }, 20000);

  it("review2 P2: foreground follower forwards recovery, tiny starts and parking with stale guards", async () => {
    await reload(); await waitForOwner();
    await waitFor("document.querySelector('.next-action')"); await waitForOwner();
    await evaluate(`Promise.all([import('/src/state/timer.ts'), import('/src/state/intent.ts'), import('/src/lib/store.ts')]).then(async ([t,i,p]) => {
      t.timerActions.stop(); i.updateIntent({action:'Follower action',cue:'After tea'});
      t.timerActions.start(); t.timerActions.pause(); await p.flushReadyStores();
    })`);
    const ownerSocket = socket;
    const target = await send("Target.createTarget", { url: origin });
    const pages = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then(r => r.json()) as { id: string; webSocketDebuggerUrl: string }[];
    const follower = new WebSocket(pages.find(p => p.id === target.targetId)!.webSocketDebuggerUrl);
    follower.addEventListener("message", ({ data }) => {
      const message = JSON.parse(String(data)), request = pending.get(message.id);
      if (message.method === "Runtime.exceptionThrown") errors.push(message.params);
      if (!request) return;
      clearTimeout(request.timer); pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
    });
    await new Promise<void>(resolve => follower.addEventListener("open", () => resolve(), { once: true }));
    socket = follower;
    try {
      await send("Runtime.enable"); await send("Page.enable");
      await waitFor("document.querySelector('[aria-label=\"Session context\"]')");
      expect(await evaluate("navigator.locks.query().then(q=>q.held.some(l=>l.name==='custom-pomodoro-leader') && q.pending.some(l=>l.name==='custom-pomodoro-leader'))")).toBe(true);
      expect(await evaluate("import('/src/state/timer.ts').then(t=>t.requestRecovery({...t.recoveryCommand(),expectedSegId:'stale'},'resume'))")).toBe(false);
      await click("Resume"); await waitFor("!document.querySelector('.recovery-card')");
      expect(await evaluate("import('/src/state/timer.ts').then(t=>t.timer.get().startedAt!==null)")).toBe(true);
      for (const control of ["play", "space"]) {
        socket = ownerSocket;
        await evaluate(`Promise.all([import('/src/state/settings.ts'),import('/src/state/timer.ts'),import('/src/lib/store.ts')]).then(async([s,t,p])=>{
          t.timerActions.stop(); s.settingsUpdate('timer',{takeover:false,autoRun:'off',interruptionPrompt:false});
          t.timerActions.start(); t.timer.set({...t.timer.get(),startedAt:Date.now()-1000,frozen:true,frozenTotal:1000});
          t.timerActions.complete(t.timer.get().segId); await p.flushReadyStores();
        })`);
        socket = follower;
        await waitFor("document.querySelector('[aria-label=\"Finished block\"]')");
        if (control === "play") await evaluate("document.querySelector('[aria-label=\"Start · Space\"]').click()");
        else {
          // This is a deliberate shortcut after the recovery card's typing guard.
          await delay(1600);
          await evaluate("document.activeElement.blur()");
          await send("Input.dispatchKeyEvent", {type:"keyDown", key:" ", code:"Space", windowsVirtualKeyCode:32});
          await send("Input.dispatchKeyEvent", {type:"keyUp", key:" ", code:"Space", windowsVirtualKeyCode:32});
        }
        await waitFor("!document.querySelector('[aria-label=\"Finished block\"]')");
        socket = ownerSocket;
        expect(await evaluate("import('/src/state/timer.ts').then(t=>({segment:t.timer.get().segment,running:t.timer.get().startedAt!==null}))")).toEqual({segment:"focus",running:true});
        socket = follower;
      }
      await evaluate("Promise.all([import('/src/state/timer.ts'),import('/src/lib/store.ts')]).then(async([t,p])=>{await t.runTimerCommand('stop');await p.flushReadyStores()})");
      await waitFor("document.querySelector('.tiny-start')"); await delay(100);
      expect(await evaluate("import('/src/state/timer.ts').then(t=>t.requestTinyBlock({...t.recoveryCommand(),expectedSegId:'stale'},10))")).toBe(false);
      await evaluate("[...document.querySelectorAll('.tiny-start button')].find(b=>b.textContent==='Start with 5 min').click()");
      await waitFor("!document.querySelector('.tiny-start')");
      socket = ownerSocket;
      expect(await evaluate("import('/src/state/timer.ts').then(t=>({tiny:t.timer.get().tinyStart,total:t.totalMs(),running:t.timer.get().startedAt!==null}))")).toEqual({tiny:true,total:300000,running:true});
      socket = follower;
      await evaluate(`Promise.all([import('/src/state/timer.ts'),import('/src/state/parked.ts'),import('/src/state/parkingReview.ts'),import('/src/lib/store.ts')]).then(async([t,p,r,s])=>{
        await t.runTimerCommand('stop'); p.parkThought('Follower thought',{segment:'focus'}); r.openParkingReview(); await s.flushReadyStores();
      })`);
      await waitFor("document.querySelector('[aria-label=\"Review parked thoughts\"]')"); await delay(100);
      await click("Make a task");
      await waitFor("document.querySelector('.stopped-card')");
      await evaluate("document.querySelector('.stopped-card [aria-label=Close]').click()");
      await waitFor("!document.querySelector('.recovery-card')");
      socket = ownerSocket;
      expect(await evaluate("import('/src/state/tasks.ts').then(t=>t.tasks.get().filter(x=>x.title==='Follower thought').length)")).toBe(1);
      socket = follower;
      await evaluate("Promise.all([import('/src/state/parked.ts'),import('/src/state/parkingReview.ts'),import('/src/lib/store.ts')]).then(async([p,r,s])=>{p.parkThought('Undo in follower',{segment:'focus'});r.openParkingReview();await s.flushReadyStores()})");
      await waitFor("document.querySelector('[aria-label=\"Review parked thoughts\"]')"); await delay(100);
      await click("Drop"); await waitFor("document.querySelector('.delete-undo-toast button')");
      await evaluate("document.querySelector('.delete-undo-toast button').click()");
      await waitFor("import('/src/state/parked.ts').then(p=>p.parked.get().some(x=>x.text==='Undo in follower'))");
      socket = ownerSocket;
      expect(await evaluate("import('/src/state/parked.ts').then(p=>p.parked.get().filter(x=>x.text==='Undo in follower').length)")).toBe(1);
      // Grok 3: the real close and accept buttons route through the owner.
      await evaluate("Promise.all([import('/src/state/timer.ts'),import('/src/state/tinyStarts.ts'),import('/src/lib/store.ts')]).then(async([t,n,p])=>{t.timerActions.stop();n.tinyStarts.set({version:1,finished:['offer-a','offer-b'],offer:'available'});await p.flushReadyStores()})");
      socket = follower;
      await waitFor("document.querySelector('[aria-label=\"Usual length offer\"]')");
      await evaluate("document.querySelector('[aria-label=\"Usual length offer\"] [aria-label=\"Close\"]').click()");
      await waitFor("!document.querySelector('[aria-label=\"Usual length offer\"]')");
      socket = ownerSocket;
      expect(await evaluate("import('/src/state/tinyStarts.ts').then(n=>n.tinyStarts.get().offer)")).toBe('dismissed');
      expect(await evaluate("import('/src/state/timer.ts').then(t=>t.timer.get().startedAt)")).toBeNull();
      await evaluate("Promise.all([import('/src/state/tinyStarts.ts'),import('/src/lib/store.ts')]).then(async([n,p])=>{n.tinyStarts.set({...n.tinyStarts.get(),offer:'available'});await p.flushReadyStores()})");
      socket = follower;
      await waitFor("document.querySelector('[aria-label=\"Usual length offer\"]')"); await click('Start usual length');
      await waitFor("!document.querySelector('[aria-label=\"Usual length offer\"]')");
      socket = ownerSocket;
      expect(await evaluate("import('/src/state/tinyStarts.ts').then(n=>n.tinyStarts.get().offer)")).toBe('accepted');
      expect(await evaluate("import('/src/state/timer.ts').then(t=>t.timer.get().startedAt!==null)")).toBe(true);
    } finally {
      socket = ownerSocket;
      await send("Target.closeTarget", { targetId: target.targetId }); follower.close();
    }
    expect(errors).toEqual([]);
  }, 30000);

  it("round4 gap Drop Undo wins over queued review and survives dashboard changes", async () => {
    await reload(); await waitForOwner(); await waitFor("document.querySelector('[data-tip]')");
    await evaluate("import('/src/state/settings.ts').then(async s=>{await s.settings.ready;s.settingsUpdate('dash','focus')})");
    await waitFor("document.querySelector('.next-action')"); await waitForOwner();
    await evaluate(`Promise.all([import('/src/state/settings.ts'),import('/src/state/timer.ts'),import('/src/state/intent.ts'),import('/src/state/parked.ts'),import('/src/state/parkingReview.ts'),import('/src/state/returnActivity.ts')]).then(([s,t,i,p,r,a])=>{
      t.timerActions.stop(); s.settingsUpdate('dash','focus'); s.settingsUpdate('timer',{interruptionPrompt:false});
      i.updateIntent({action:'Undo this action',why:'Its reason',cue:'After lunch',reward:'Tea',sufficientFinish:'One paragraph'});
      p.parked.set([]); p.parkThought('Waiting review',{segment:'focus'}); r.openParkingReview();
      a.returnActivity.set({...a.returnActivity.get(),pendingGap:'gap:undo'});
    })`);
    await waitFor("document.querySelector('[aria-label=\"Return to your next action\"]')");
    await click("Drop");
    await waitFor("document.querySelector('[aria-label=\"Next action cleared\"]')");
    expect(await evaluate("!!document.querySelector('[aria-label=\"Review parked thoughts\"]')")).toBe(false);
    for (const dash of ["home", "ambient", "focus"]) {
      await evaluate(`import('/src/state/settings.ts').then(s=>s.settingsUpdate('dash','${dash}'))`);
      await delay(60);
    }
    await click("Undo");
    expect(await evaluate("import('/src/state/intent.ts').then(i=>i.intent.get())")).toMatchObject({action:'Undo this action',why:'Its reason',cue:'After lunch',reward:'Tea',sufficientFinish:'One paragraph'});
    await waitFor("document.querySelector('[aria-label=\"Review parked thoughts\"]')");
    // The snapshot has a deadline even while the Focus tree is absent.
    await evaluate("import('/src/state/returnActivity.ts').then(a=>a.returnActivity.set({...a.returnActivity.get(),pendingGap:'gap:expire'}))");
    await click("Drop");
    await evaluate("import('/src/state/settings.ts').then(s=>s.settingsUpdate('dash','home'))");
    await delay(5200);
    await evaluate("import('/src/state/settings.ts').then(s=>s.settingsUpdate('dash','focus'))");
    await waitFor("document.querySelector('[aria-label=\"Review parked thoughts\"]')");
    expect(await evaluate("[...document.querySelectorAll('.recovery-card button')].some(b=>b.textContent==='Undo')")).toBe(false);
    await evaluate("import('/src/state/returnActivity.ts').then(a=>a.returnActivity.set({...a.returnActivity.get(),pendingGap:'gap:newer'}))");
    await click("Drop");
    await evaluate("import('/src/state/intent.ts').then(i=>i.updateIntent({action:'Newer action'}))");
    await click("Undo");
    expect(await evaluate("import('/src/state/intent.ts').then(i=>i.intent.get().action)")).toBe('Newer action');
    expect(await evaluate("document.querySelector('.recovery-card [role=status]')?.textContent")).toBe('Your next action has changed. The newer action is kept.');
    await evaluate("import('/src/lib/store.ts').then(s=>s.flushReadyStores())");
    expect(errors).toEqual([]);
  }, 20000);

  it("round5 stale follower review controls cannot rewind or replace the leader review", async () => {
    await reload(); await waitForOwner(); await waitFor("document.querySelector('[data-tip]')");
    await evaluate("import('/src/state/settings.ts').then(async s=>{await s.settings.ready;s.settingsUpdate('dash','focus')})");
    await waitFor("document.querySelector('.next-action')"); await waitForOwner();
    const ownerSocket = socket;
    const target = await send("Target.createTarget", { url: "about:blank" });
    const pages = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then(r=>r.json()) as {id:string;webSocketDebuggerUrl:string}[];
    const follower = new WebSocket(pages.find(p=>p.id===target.targetId)!.webSocketDebuggerUrl);
    follower.addEventListener("message", ({data})=>{
      const message=JSON.parse(String(data)), request=pending.get(message.id);
      if (message.method==='Runtime.exceptionThrown') errors.push(message.params);
      if (!request) return;
      clearTimeout(request.timer); pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
    });
    await new Promise<void>(resolve=>follower.addEventListener('open',()=>resolve(),{once:true}));
    try {
      socket=follower; await send('Runtime.enable'); await send('Page.enable');
      await send('Page.addScriptToEvaluateOnNewDocument',{source:`
        const listen=BroadcastChannel.prototype.addEventListener;
        BroadcastChannel.prototype.addEventListener=function(type,callback,options){
          return listen.call(this,type,type==='message'?event=>{
            if(window.holdReviewWrites && event.data?.type==='write') return;
            callback(event);
          }:callback,options);
        };
      `});
      for (const action of ['Review later','Close','Done reviewing','Open parked','Boundary']) {
        socket=ownerSocket;
        await evaluate(`Promise.all([import('/src/state/settings.ts'),import('/src/state/timer.ts'),import('/src/state/parked.ts'),import('/src/state/parkingReview.ts'),import('/src/state/returnActivity.ts'),import('/src/lib/store.ts')]).then(async([s,t,p,r,a,f])=>{
          t.timerActions.stop(); s.settingsUpdate('dash','focus'); s.settingsUpdate('timer',{interruptionPrompt:false});
          a.returnActivity.set({...a.returnActivity.get(),pendingGap:null});
          p.parked.set([{id:'one',text:'Kept thought',status:'open',at:Date.now(),segment:'focus'},{id:'two',text:'Next thought',status:'open',at:Date.now(),segment:'focus'}]);
          r.parkingReview.set({...r.parkingReview.get(),deferred:false,review:{id:'old-${action}',itemIds:${action === 'Done reviewing' ? "['missing']" : "['one','two']"},cursor:0}});
          await f.flushReadyStores();
        })`);
        socket=follower; await send('Page.navigate',{url:origin});
        await waitFor("document.querySelector('[aria-label=\"Review parked thoughts\"]')");
        await evaluate('window.holdReviewWrites=true');
        socket=ownerSocket;
        await evaluate(`Promise.all([import('/src/state/parkingReview.ts'),import('/src/lib/store.ts')]).then(async([r,f])=>{
          ${action === 'Done reviewing' ? "r.parkingReview.set({...r.parkingReview.get(),review:{id:'new-review',itemIds:['two'],cursor:0}});" : "r.answerParkingReview(r.parkingReview.get().review.id,'one','keep');"}
          await f.flushReadyStores();
        })`);
        socket=follower;
        if(action==='Open parked') await evaluate("document.querySelector('.park-chip').click()");
        else if(action==='Boundary') await evaluate("import('/src/state/parkingReview.ts').then(r=>r.chooseReviewBoundary('session'))");
        else if(action==='Close') await evaluate("document.querySelector('.recovery-card [aria-label=\"Close\"]').click()");
        else await click(action);
        await evaluate("import('/src/lib/store.ts').then(f=>f.flushReadyStores())");
        await delay(150);
        socket=ownerSocket;
        const state = await evaluate("import('/src/state/parkingReview.ts').then(r=>r.parkingReview.get())");
        expect(state).toMatchObject(action === 'Done reviewing' ? {deferred:false,review:{id:'new-review',cursor:0}} : {deferred:action==='Review later'||action==='Close',review:{id:`old-${action}`,cursor:1}});
        if(action==='Boundary') expect(state.boundary).toBe('session');
      }
      // A stale follower cannot revive a gap after the owner has answered it.
      socket=ownerSocket;
      await evaluate(`Promise.all([import('/src/state/returnActivity.ts'),import('/src/lib/store.ts')]).then(async([a,f])=>{
        const last=Date.now()-3*86400000;
        a.returnActivity.set({version:1,lastPurposefulAt:last,pendingGap:'gap:'+last,acknowledgedGap:null,uncertain:false});
        await f.flushReadyStores();
      })`);
      socket=follower; await send('Page.navigate',{url:origin});
      await waitFor("document.querySelector('[aria-label=\"Return to your next action\"]')");
      await evaluate('window.holdReviewWrites=true');
      socket=ownerSocket;
      const answered = await evaluate("Promise.all([import('/src/state/timer.ts'),import('/src/state/returnActivity.ts'),import('/src/lib/store.ts')]).then(async([t,a,f])=>{t.answerRecovery(t.recoveryCommand(),'keep');await f.flushReadyStores();return a.returnActivity.get()})");
      socket=follower;
      await evaluate("Promise.all([import('/src/state/returnActivity.ts'),import('/src/state/intent.ts'),import('/src/lib/store.ts')]).then(async([a,i,f])=>{a.checkReturnActivity();i.updateIntent({action:'Kept after a follower edit'});await f.flushReadyStores()})");
      socket=ownerSocket;
      await waitFor("import('/src/state/intent.ts').then(i=>i.intent.get().action==='Kept after a follower edit')");
      await delay(200);
      expect(await evaluate("import('/src/state/returnActivity.ts').then(a=>a.returnActivity.get())")).toMatchObject({pendingGap:null,acknowledgedGap:answered.acknowledgedGap});
    } finally {
      socket=ownerSocket; await send('Target.closeTarget',{targetId:target.targetId}); follower.close();
    }
    expect(errors).toEqual([]);
  }, 30000);

  it.each([false, true])("round3 live takeover stays reachable in Focus, Home and Ambient without a competing card (native bridge=%s)", async native => {
    await reload(); await waitForOwner(); await waitFor("document.querySelector('.next-action')"); await waitForOwner();
    for (const dash of ["focus", "home", "ambient"]) for (const autoRun of ["off", "always"]) {
      await evaluate(`Promise.all([import('/src/state/settings.ts'),import('/src/state/timer.ts'),import('/src/state/parkingReview.ts'),import('/src/state/returnActivity.ts')]).then(([s,t,r,a])=>{
        window.desktop = ${native ? "{armAlarm:async()=>true,disarmAlarm(){},release(){},cancelSpeech(){}}" : "undefined"};
        t.timerActions.stop(); r.parkingReview.set({...r.parkingReview.get(),review:null});
        a.returnActivity.set({...a.returnActivity.get(),pendingGap:null});
        s.settingsUpdate('dash','${dash}');
        s.settingsUpdate('timer',{takeover:true,autoRun:'${autoRun}',interruptionPrompt:false,speak:false,notify:false,bringToFront:false,focusDoneSound:'none',breakOverSound:'none'});
        t.timerActions.goTo('short'); t.timerActions.start();
        t.timer.set({...t.timer.get(),startedAt:Date.now()-1000,frozen:true,frozenTotal:1000});
        t.timerActions.complete(t.timer.get().segId);
      })`);
      await waitFor("document.querySelector('.transition-screen[open]')");
      expect(await evaluate("document.querySelectorAll('.recovery-card').length")).toBe(0);
      expect(await evaluate("import('/src/state/timer.ts').then(t=>t.recoveryOffer())")).toBeNull();
      if (autoRun === "off") await evaluate("import('/src/state/timer.ts').then(t=>t.timerActions.start())");
      else await evaluate("import('/src/state/timer.ts').then(t=>t.timerActions.answerTransition('dismiss'))");
      await waitFor("!document.querySelector('.transition-screen')");
      expect(await evaluate("import('/src/state/timer.ts').then(t=>t.timer.get().startedAt!==null)")).toBe(true);
      await evaluate("import('/src/state/timer.ts').then(t=>t.timerActions.stop())");
    }
    // A queued gap must not hide takeover where the recovery slot is absent.
    for (const dash of ["home", "ambient"]) {
      await evaluate(`Promise.all([import('/src/state/settings.ts'),import('/src/state/timer.ts'),import('/src/state/returnActivity.ts')]).then(([s,t,a])=>{
        s.settingsUpdate('dash','${dash}'); s.settingsUpdate('timer',{autoRun:'off'});
        t.timerActions.goTo('short'); t.timerActions.start();
        const last=Date.now()-3*86400000;
        a.returnActivity.set({version:1,lastPurposefulAt:last,pendingGap:'gap:'+last,acknowledgedGap:null,uncertain:false});
        t.timer.set({...t.timer.get(),startedAt:Date.now()-1000,frozen:true,frozenTotal:1000});
        t.timerActions.complete(t.timer.get().segId);
      })`);
      await waitFor("document.querySelector('.transition-screen[open]')");
      expect(await evaluate("document.querySelectorAll('.recovery-card').length")).toBe(0);
      await evaluate("import('/src/state/timer.ts').then(t=>{t.timerActions.start();t.timerActions.stop()})");
    }
    await evaluate("Promise.all([import('/src/state/settings.ts'),import('/src/state/returnActivity.ts'),import('/src/lib/store.ts')]).then(async([s,a,p])=>{s.settingsUpdate('dash','focus');s.settingsUpdate('timer',{takeover:false});a.returnActivity.set({...a.returnActivity.get(),pendingGap:null});await p.flushReadyStores()})");
    expect(errors).toEqual([]);
  }, 20000);

  it.each([false, true])("round5 parking review cannot postpone a live takeover (native bridge=%s)", async native => {
    await reload(); await waitForOwner(); await waitFor("document.querySelector('.next-action')"); await waitForOwner();
    for (const autoRun of ['off', 'always']) {
      await evaluate(`Promise.all([import('/src/state/settings.ts'),import('/src/state/timer.ts'),import('/src/state/parked.ts'),import('/src/state/parkingReview.ts'),import('/src/state/returnActivity.ts')]).then(([s,t,p,r,a])=>{
        window.desktop=${native ? "{armAlarm:async()=>true,disarmAlarm(){},release(){},cancelSpeech(){}}" : "undefined"};
        t.timerActions.stop(); s.settingsUpdate('dash','focus');
        s.settingsUpdate('timer',{takeover:true,autoRun:'${autoRun}',interruptionPrompt:false,speak:false,notify:false,bringToFront:false,focusDoneSound:'none',breakOverSound:'none'});
        a.returnActivity.set({...a.returnActivity.get(),pendingGap:null});
        r.parkingReview.set({...r.parkingReview.get(),review:null});
        p.parked.set([]); p.parkThought('Review after takeover',{segment:'focus'}); r.chooseReviewBoundary('block');
        t.timerActions.start(); t.timer.set({...t.timer.get(),startedAt:Date.now()-1000,frozen:true,frozenTotal:1000});
        t.timerActions.complete(t.timer.get().segId);
      })`);
      await waitFor("document.querySelector('.transition-screen[open]')");
      await evaluate("import('/src/state/timer.ts').then(t=>t.timerActions.answerTransition('dismiss'))");
      await waitFor("document.querySelector('[aria-label=\"Review parked thoughts\"]')");
      await click('Review later');
      expect(await evaluate("!!document.querySelector('.transition-screen')")).toBe(false);
    }
    await evaluate("Promise.all([import('/src/state/timer.ts'),import('/src/state/settings.ts'),import('/src/lib/store.ts')]).then(async([t,s,f])=>{t.timerActions.stop();s.settingsUpdate('timer',{takeover:false});await f.flushReadyStores()})");
  }, 20000);

  it("round5 review errors clear after success and after another tab changes the item", async () => {
    await reload(); await waitFor("document.querySelector('.next-action')"); await waitForOwner();
    await evaluate(`Promise.all([import('/src/state/timer.ts'),import('/src/state/parked.ts'),import('/src/state/parkingReview.ts'),import('/src/state/returnActivity.ts')]).then(([t,p,r,a])=>{
      t.timerActions.stop(); a.returnActivity.set({...a.returnActivity.get(),pendingGap:null});
      p.parked.set(['one','two','three'].map(id=>({id,text:id,status:'open',at:Date.now(),segment:'focus'})));
      r.parkingReview.set({...r.parkingReview.get(),deferred:false,review:{id:'errors',itemIds:['one','two','three'],cursor:0}});
    })`);
    await waitFor("document.querySelector('[aria-label=\"Review parked thoughts\"]')");
    // The rendered callback has the previous identity until React renders the new store state.
    const fail = `import('/src/state/intent.ts').then(i=>{i.updateIntent({why:'Changed '+i.intent.get().rev});[...document.querySelectorAll('.recovery-card button')].find(b=>b.textContent==='Keep').click()})`;
    await evaluate(fail);
    await waitFor("document.querySelector('.recovery-card [role=status]')");
    await click('Keep');
    await waitFor("document.querySelector('.recovery-action')?.textContent==='two'");
    expect(await evaluate("!!document.querySelector('.recovery-card [role=status]')")).toBe(false);
    await evaluate(fail); await waitFor("document.querySelector('.recovery-card [role=status]')");
    await evaluate("Promise.all([import('/src/state/parkingReview.ts'),import('/src/lib/store.ts')]).then(([r,s])=>s.applyRemote('parkingReview',{...r.parkingReview.get(),review:{...r.parkingReview.get().review,cursor:2}}))");
    await waitFor("document.querySelector('.recovery-action')?.textContent==='three'");
    expect(await evaluate("!!document.querySelector('.recovery-card [role=status]')")).toBe(false);
    await evaluate("Promise.all([import('/src/state/parkingReview.ts'),import('/src/state/parked.ts'),import('/src/lib/store.ts')]).then(async([r,p,f])=>{r.closeParkingReview(r.parkingReview.get().review.id);p.parked.set([]);await f.flushReadyStores()})");
  }, 20000);

  it("long action, why and cue stay inside scrollable focus areas in both sizes and every look", async () => {
    await reload(); await waitForOwner(); await waitFor("document.querySelector('.next-action')"); await waitForOwner();
    await evaluate(`Promise.all([import('/src/state/settings.ts'),import('/src/state/intent.ts'),import('/src/state/timer.ts')]).then(([s,i,t])=>{
      t.timerActions.stop(); s.settingsUpdate('dash','focus');
      i.updateIntent({action:'Long action '.repeat(41),why:'A reason '.repeat(55),cue:'After tea '.repeat(49)});
      t.timerActions.start(); t.timerActions.pause();
      // A newer pin makes the card show the session's own (long) context, which must scroll inside the card.
      i.updateIntent({action:'A newer action'});
    })`);
    await waitFor("document.querySelector('[aria-label=\"Session context\"]')");
    for (const [width,height] of [[1000,800],[1280,720]]) {
      await send("Emulation.setDeviceMetricsOverride", {width,height,deviceScaleFactor:1,mobile:false});
      for (const look of ["classic","glass","sketch","companion","sunrise"]) {
        await evaluate(`import('/src/state/settings.ts').then(s=>s.settingsUpdate('appearance',{look:'${look}'}))`);
        await waitFor(`document.documentElement.dataset.look === '${look}'`); await delay(60);
        const layout = await assertFocusFit(evaluate, true);
        expect(layout.scroll.content).toBeGreaterThan(layout.scroll.client);
        expect(layout.scroll.overflow).toBe('auto');
        expect(await evaluate(`(() => {
          const card=document.querySelector('.recovery-card'), pin=document.querySelector('.next-action'), copy=pin.querySelector('.next-action-copy');
          card.querySelector('.focus-card-body').scrollTop=card.querySelector('.focus-card-body').scrollHeight; copy.scrollTop=copy.scrollHeight;
          const inside=(child,parent)=>{const c=child.getBoundingClientRect(),p=parent.getBoundingClientRect();return c.top>=p.top && c.bottom<=p.bottom;};
          return inside(card.querySelector('.recovery-buttons button'),card) && inside(pin.querySelector('.next-action-buttons button'),pin);
        })()`)).toBe(true);
        await evaluate("document.querySelector('.recovery-card .focus-card-body').scrollTop=0;document.querySelector('.next-action-copy').scrollTop=0");
      }
    }
    await evaluate("document.querySelector('.recovery-card [aria-label=\"Close\"]').click()");
    await waitFor("!document.querySelector('.recovery-card')");
    expect(errors).toEqual([]);
  }, 20000);

  it.each([false, true])("PR2: interruption capture gets the first card in Focus, Home and Ambient (native bridge=%s)", async native => {
    await send("Page.navigate", { url: "about:blank" });
    await send("Storage.clearDataForOrigin", { origin, storageTypes: "all" });
    const injection = await send("Page.addScriptToEvaluateOnNewDocument", { source: native ? `
      window.desktop = { armAlarm: async () => true, disarmAlarm() {}, release() {}, cancelSpeech() {}, onLifecycle() { return () => {} } };
    ` : "window.desktop = undefined;" });
    try {
      await send("Page.navigate", { url: origin });
      await waitFor("document.querySelector('.next-action')"); await waitForOwner();
      for (const dash of ["focus", "home", "ambient"]) {
        await evaluate(`Promise.all([import('/src/state/settings.ts'), import('/src/state/timer.ts')]).then(async ([s,t]) => {
          await s.calmFoundationReady;
          t.timerActions.stop();
          s.settingsUpdate('timer', { ...s.CALM_PATCH, interruptionPrompt: true });
          s.settingsUpdate('dash', '${dash}');
          t.timerActions.start();
          await t.runTimerCommand('pause');
        })`);
        await waitFor("document.querySelector('.interruption-capture')");
        expect(await evaluate("!document.querySelector('.recovery-card, .transition-screen')")).toBe(true);
        expect(await evaluate(`(() => {
          const form = document.querySelector('.interruption-capture'), r = form.getBoundingClientRect();
          const button = form.querySelector('button'); button.focus();
          return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth && document.activeElement === button;
        })()`)).toBe(true);
        expect(await evaluate("import('/src/state/timer.ts').then(t => t.recoveryOffer())")).toBe("re-entry");
        if (dash === "focus") {
          await evaluate("[...document.querySelectorAll('.interruption-capture button')].find(b => b.textContent === 'Keep').click()");
          await waitFor("import('/src/state/parked.ts').then(p => p.interruptionPrompt.get()?.expiresAt === null)");
          expect(await evaluate("document.querySelector('.interruption-capture').textContent.includes('Closes in')")).toBe(false);
          await evaluate("[...document.querySelectorAll('.interruption-capture button')].find(b => b.textContent === 'Phone').click()");
          await waitFor("[...document.querySelectorAll('.interruption-capture button')].some(b => b.textContent === 'Phone' && b.getAttribute('aria-pressed') === 'true')");
          await evaluate("document.querySelector('.interruption-capture button[type=submit]').click()");
          await waitFor("import('/src/state/parked.ts').then(p => p.parked.get().some(item => item.kind === 'interruption' && item.tag === 'Phone'))");
        } else if (dash === "home") {
          await evaluate("[...document.querySelectorAll('.interruption-capture button')].find(b => b.textContent === 'Dismiss').click()");
        } else {
          // The entire eight-second prompt is visible, rather than expiring behind recovery.
          await delay(8200);
        }
        await waitFor("!document.querySelector('.interruption-capture')");
        await evaluate("import('/src/state/settings.ts').then(s => s.settingsUpdate('dash', 'focus'))");
        await waitFor("document.querySelector('[aria-label=\"Session context\"]')");
        expect(await evaluate("document.querySelectorAll('.recovery-card').length")).toBe(1);
        await click("Resume");
        await waitFor("!document.querySelector('.recovery-card')");
        expect(await evaluate("import('/src/state/timer.ts').then(t => t.timer.get().startedAt !== null)")).toBe(true);
      }
      expect(errors).toEqual([]);
    } finally {
      await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: injection.identifier });
    }
  }, 30000);

});
