import { chromeArgs } from "../../../scripts/browser/chrome-args.ts";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Only processes launched here, with disposable profiles, are controlled.
const electronPath = join(process.cwd(), "desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
const chromePath = [process.env.CHROME_BIN, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((path) => path && existsSync(path));

// Opt in on hosts that permit starting a loopback server and launching Chrome.
// Normal unit runs do not launch a browser.
describe.each(["Chrome", "Electron"])("session log and backups in isolated %s", runtime => {
  const macOnly = runtime === "Electron" && process.platform !== "darwin";
  describe.skipIf(!chromePath || process.env.LOG_BROWSER !== "1" || macOnly)(
    macOnly ? "skipped: Electron session-log harness requires macOS; Chrome covers browser CI" : "supported runtime", () => {
  let browser: ChildProcess, server: ViteDevServer, profile: string, socket: WebSocket;
  let origin = "", sequence = 0;
  let downloads = "";
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
  const waitForOwner = () => waitFor("import('/src/state/timer.ts').then(async t => { await t.timerHydrationReady; return (await import('/src/lib/store.ts')).canWriteClockStore('stats'); })");
  const click = async (selector: string) => {
    await waitFor(`document.querySelector(${JSON.stringify(selector)})`);
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await delay(30);
  };

  beforeAll(async () => {
    server = await createServer({ server: { host: "127.0.0.1", port: 0, hmr: false, watch: null }, clearScreen: false });
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === "string") throw new Error("No test server port");
    origin = `http://127.0.0.1:${address.port}`;
    const probe = await fetch(origin);
    expect(probe.headers.get("content-type")).toContain("text/html");
    profile = mkdtempSync(join(tmpdir(), "pomodoro-log-test-"));
    downloads = mkdtempSync(join(tmpdir(), "pomodoro-log-downloads-"));
    if (runtime === "Electron") {
      if (!existsSync(electronPath)) throw new Error("Local Electron dependency is missing");
      const main = join(profile, "test-main.cjs");
      writeFileSync(main, `const {app,BrowserWindow,session}=require('electron');
        app.setPath('userData', ${JSON.stringify(profile)});
        app.whenReady().then(() => {
          app.dock?.hide();
          session.defaultSession.on('will-download', (_event,item) => item.setSavePath(require('node:path').join(${JSON.stringify(downloads)}, item.getFilename())));
          const window = new BrowserWindow({show:false,webPreferences:{contextIsolation:true,sandbox:true}});
          window.loadURL('about:blank');
        });`);
      browser = spawn(electronPath, [main, "--mute-audio", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--disable-background-networking"], { stdio: "ignore", env: { ...process.env, ELECTRON_RUN_AS_NODE: "" } });
    } else {
      browser = spawn(chromePath!, chromeArgs(profile), { stdio: ["ignore", "ignore", "pipe"] });
    }
    let launchErrors = "";
    browser.stderr?.on("data", data => { launchErrors = (launchErrors + String(data)).slice(-8192); });
    const portFile = join(profile, "DevToolsActivePort");
    for (let n = 0; n < 150 && !existsSync(portFile); n++) await delay(50);
    if (!existsSync(portFile)) throw new Error(`Test browser launch failed: exit=${browser.exitCode}, signal=${browser.signalCode}; ${launchErrors}`);
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
    if (runtime === "Chrome") await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
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
    if (downloads) rmSync(downloads, { recursive: true, force: true });
    if (profile) rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const byText = async (text: string) => {
    await evaluate(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === ${JSON.stringify(text)}).click()`);
    await delay(40);
  };
  const setField = async (selector: string, value: string) => {
    await evaluate(`(() => { const field = document.querySelector(${JSON.stringify(selector)});
      Object.getOwnPropertyDescriptor(field.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set.call(field, ${JSON.stringify(value)});
      field.dispatchEvent(new Event('input', {bubbles:true})); field.dispatchEvent(new Event('change', {bubbles:true})); })()`);
    await delay(40);
  };
  const downloaded = async (suffix: string) => {
    for (let n = 0; n < 120; n++) {
      const file = readdirSync(downloads).find(name => name.endsWith(suffix));
      if (file) return readFileSync(join(downloads, file), 'utf8');
      await delay(50);
    }
    throw new Error(`No ${suffix} download: ${readdirSync(downloads)}`);
  };
  it("shows merged sessions and interruptions, filters dates/tasks, and downloads safe CSV and image backups", async () => {
    await waitForOwner();
    await evaluate(`(async () => {
      const {settings} = await import('/src/state/settings.ts'); await settings.ready;
      settings.set({...settings.get(), lastTab:'stats', extras:{...settings.get().extras,defaultTab:'stats',clearMode:false}});
      const {tasks} = await import('/src/state/tasks.ts'); await tasks.ready;
      tasks.set([{id:'t',title:'=SUM(1,2)\"hello\"',createdAt:Date.now(),done:false}]);
      const {stats} = await import('/src/state/stats.ts'); await stats.ready;
      const at = new Date(2026,9,24,10).getTime();
      stats.set({tasksDone:[],chunks:[
        {id:'a',segId:'session',kind:'focus',segment:'focus',start:at,ms:60000,completed:false,taskId:'t'},
        {id:'b',segId:'session',kind:'focus',segment:'focus',start:at+120000,ms:60000,completed:true,taskId:'t'},
        {id:'c',segId:'break',kind:'break',segment:'short',start:at+180000,ms:30000,completed:false}
      ]});
      const {parked} = await import('/src/state/parked.ts'); await parked.ready;
      parked.set([{id:'p',text:'Phone',kind:'interruption',tag:'Phone',segment:'focus',status:'open',segId:'session',taskId:'t',at:at+60000}]);
      const {radioStore} = await import('/src/audio/radio.ts'); await radioStore.ready;
      radioStore.set({pinned:['nightride'],lastStation:'nightride',volume:0.7});
    })()`);
    await click('button[aria-label^="Settings"]'); await byText('Log');
    await waitFor('document.querySelectorAll(".session-log tbody tr").length === 2');
    expect(await evaluate('document.querySelector(".session-log").textContent')).toContain('2m 0s focus');
    const hasSelector = await evaluate(`import('/src/state/parked.ts').then(module => typeof module.getInterruptions === 'function')`);
    expect(await evaluate('document.querySelector(".session-log").textContent')).toContain(hasSelector ? '1 interruption' : '0 interruptions');
    await setField('.session-log select', 'task:t');
    await waitFor('document.querySelectorAll(".session-log tbody tr").length === 1');
    await setField('.session-log input[type=date]', '2026-10-25');
    await waitFor('document.querySelector(".session-log").textContent.includes("No saved sessions")');
    await byText('Clear filters'); await byText('Export CSV');
    const csv = await downloaded('.csv');
    expect(csv).toContain('"Completed"'); expect(csv).toContain('"Cut short"');
    expect(csv).toContain(`"'=SUM(1,2)""hello"""`);
    expect(csv).toContain('"120","Focus"');
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
    expect(await evaluate('document.querySelector(".session-log").getBoundingClientRect().width')).toBeLessThanOrEqual(390);
    await send('Emulation.setDeviceMetricsOverride',{width:1000,height:800,deviceScaleFactor:1,mobile:false});
    await byText('Your data');
    // 081cbad / 5e5aad4: export now opens a section picker, import requires a preview.
    await byText('Export settings…');
    await waitFor('document.querySelector("#settings-export")');
    expect(await evaluate(`[...document.querySelectorAll('#settings-export label')].find(label => label.textContent.includes('Images')).querySelector('input').checked`)).toBe(false);
    for (const label of ['Sounds and mixes', 'This device’s options', 'Focus data']) {
      await evaluate(`[...document.querySelectorAll('#settings-export label')].find(el => el.textContent.includes(${JSON.stringify(label)})).querySelector('input').click()`);
    }
    await byText('Download settings file');
    const backup = JSON.parse(await downloaded('.json'));
    expect(backup.data.radio.volume).toBe(0.7); expect(backup.data.parked).toHaveLength(1); expect(backup.images).toBeUndefined();
    for (const name of readdirSync(downloads)) rmSync(join(downloads,name));
    await evaluate(`(async () => {
      const {dbSet} = await import('/src/lib/db.ts'); const {customBgs} = await import('/src/data/themes.ts'); await customBgs.ready;
      const canvas = document.createElement('canvas'); canvas.width=6000; canvas.height=3000;
      canvas.getContext('2d').fillRect(0,0,6000,3000);
      const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/png'));
      await dbSet('custom-bg:tiny',blob); customBgs.set([{id:'tiny',name:'Tiny'}]);
    })()`);
    await evaluate(`[...document.querySelectorAll('#settings-export label')].find(el => el.textContent.includes('Images')).querySelector('input').click()`);
    await byText('Download settings file');
    const withImages = JSON.parse(await downloaded('.json'));
    expect(withImages.images).toHaveLength(1); expect(withImages.images[0]).toMatchObject({id:'tiny',name:'Tiny',type:'image/png'});
    // Exercise the actual file input and atomic restoration, then confirm the reload.
    await evaluate(`(async () => {
      const {dbDel} = await import('/src/lib/db.ts'); const {customBgs} = await import('/src/data/themes.ts');
      customBgs.set([]); const {flushReadyStores} = await import('/src/lib/store.ts'); await flushReadyStores(); await dbDel('custom-bg:tiny');
      const file = new File([${JSON.stringify(JSON.stringify(withImages))}], 'restore.json', {type:'application/json'});
      const transfer = new DataTransfer(); transfer.items.add(file);
      const input = document.querySelector('input[type=file]'); input.files=transfer.files; input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await waitFor('document.querySelector("#settings-import-heading")');
    expect(await evaluate('document.querySelectorAll(".data-file-sections input:checked").length')).toBe(5);
    await byText('Import selected sections');
    await waitFor('document.body.textContent.includes("Imported. Reloading")');
    await delay(900);
    const restored = await evaluate(`(async () => {
      const {dbGet}=await import('/src/lib/db.ts'); const blob=await dbGet('custom-bg:tiny');
      const bitmap=await createImageBitmap(blob); const width=bitmap.width,height=bitmap.height; bitmap.close();
      return {images:await dbGet('customBgs'),size:blob.size,type:blob.type,width,height};
    })()`);
    expect(restored.images).toHaveLength(1); expect(restored.size).toBeGreaterThan(0);
    expect(restored).toMatchObject({type:'image/webp',width:2560,height:1280});
    expect(restored.images[0].size).toBe(restored.size);
    const invalid = await evaluate(`(async () => {
      const {backupImageEntries}=await import('/src/lib/backup.ts');
      const header=new Uint8Array(24); header.set([137,80,78,71,13,10,26,10]); header.set([73,72,68,82],12);
      const view=new DataView(header.buffer); view.setUint32(16,10000); view.setUint32(20,5000);
      try {await backupImageEntries([{id:'broken',name:'Broken PNG',type:'image/png',base64:btoa(String.fromCharCode(...header))}]); return false;}
      catch {const {dbGet}=await import('/src/lib/db.ts'); return (await dbGet('custom-bg:broken')) === undefined;}
    })()`);
    expect(invalid).toBe(true);
    expect(errors).toEqual([]);
  }, 25000);
  it("deletes merged and legacy sessions with Undo and expiry", async () => {
    await waitForOwner();
    await evaluate(`(async () => {
      const {stats} = await import('/src/state/stats.ts'); await stats.ready;
      const at = new Date(2026,9,24,10).getTime();
      stats.set({tasksDone:[],chunks:[
        {id:'delete-a',segId:'delete-run',kind:'focus',segment:'focus',start:at,ms:60000,completed:false},
        {id:'delete-b',segId:'delete-run',kind:'focus',segment:'focus',start:at+120000,ms:60000,completed:true},
        {id:'delete-legacy',kind:'break',segment:'short',start:at+180000,ms:30000,completed:false}
      ]});
    })()`);
    if (await evaluate('!!document.querySelector(".drawer")')) await click('button[aria-label^="Close settings"]');
    await click('button[aria-label^="Settings"]'); await byText('Stats'); await byText('Log');
    await waitFor('document.querySelectorAll(".session-log tbody tr").length === 2');
    await evaluate(`[...document.querySelectorAll('.session-log tbody tr')].find(row => row.textContent.includes('Completed')).querySelector('button[aria-label=Delete]').click()`);
    await waitFor('document.querySelectorAll(".session-log tbody tr").length === 1');
    expect(await evaluate('document.querySelector(".session-log-day").textContent')).toContain('0m 0s focus');
    expect(await evaluate(`import('/src/state/stats.ts').then(({stats}) => stats.get().chunks.map(c => c.id))`)).toEqual(['delete-legacy']);
    await waitFor('document.querySelector(".delete-undo-toast button")');
    await evaluate('document.querySelector(".session-log button[aria-label=Delete]").focus()');
    await send('Input.dispatchKeyEvent', {type:'keyDown', key:'Tab', code:'Tab', windowsVirtualKeyCode:9});
    await send('Input.dispatchKeyEvent', {type:'keyUp', key:'Tab', code:'Tab', windowsVirtualKeyCode:9});
    expect(await evaluate('document.activeElement.textContent')).toBe('Undo');
    await send('Input.dispatchKeyEvent', {type:'keyDown', key:'Enter', code:'Enter', windowsVirtualKeyCode:13, text:'\r'});
    await send('Input.dispatchKeyEvent', {type:'keyUp', key:'Enter', code:'Enter', windowsVirtualKeyCode:13});
    await waitFor('document.querySelectorAll(".session-log tbody tr").length === 2');
    expect(await evaluate('document.querySelector(".session-log-day").textContent')).toContain('2m 0s focus');
    await evaluate(`[...document.querySelectorAll('.session-log tbody tr')].find(row => row.textContent.includes('Short break')).querySelector('button[aria-label=Delete]').click()`);
    await waitFor('document.querySelectorAll(".session-log tbody tr").length === 1');
    await click('.delete-undo-toast button');
    await waitFor('document.querySelectorAll(".session-log tbody tr").length === 2');
    await evaluate(`[...document.querySelectorAll('.session-log tbody tr')].find(row => row.textContent.includes('Short break')).querySelector('button[aria-label=Delete]').click()`);
    await waitFor('document.querySelector(".delete-undo-toast")');
    await delay(5150);
    expect(await evaluate('!!document.querySelector(".delete-undo-toast")')).toBe(false);
    expect(await evaluate(`import('/src/state/stats.ts').then(({stats}) => stats.get().chunks.map(c => c.id))`)).toEqual(['delete-a','delete-b']);
    await click('.session-log button[aria-label=Delete]');
    await waitFor('document.querySelector(".session-log").textContent.includes("No saved sessions")');
    await click('.delete-undo-toast button');
    await waitFor('document.querySelectorAll(".session-log tbody tr").length === 1');
    expect(errors).toEqual([]);
  }, 15000);

});
});
