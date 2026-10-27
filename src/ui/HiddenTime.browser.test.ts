// Only the disposable Chrome launched by this harness is controlled.
// @ts-expect-error Shared JavaScript harness has no declaration file.
import { Chrome } from "../../scripts/golden.mjs";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe.skipIf(process.env.AMBIENT_BROWSER !== "1")("hidden time on shared web and native surfaces", () => {
  const chrome = new Chrome();
  let server: ViteDevServer;
  const shots = process.env.SHOTS_DIR ?? join(tmpdir(), "71-hidden-time-shots");
  const page = (body: string) => chrome.evaluate(`(async () => {
    const s = await import('/src/state/settings.ts'), t = await import('/src/state/timer.ts');
    ${body}
  })()`);
  beforeAll(async () => {
    await mkdir(shots, { recursive: true });
    server = await createServer({ configLoader: "runner", server: { host: "127.0.0.1", port: 0, hmr: false, watch: null }, logLevel: "error" });
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === "string") throw new Error("No test server");
    chrome.origin = `http://127.0.0.1:${address.port}`;
    await chrome.start();
    await chrome.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    await chrome.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false });
    await chrome.send("Page.navigate", { url: chrome.origin });
    await chrome.waitFor("document.querySelector('.focus-center')");
    await chrome.waitFor("import('/src/state/timer.ts').then(async t => { await t.timerHydrationReady; return (import('/src/lib/store.ts')).then(s => s.canWriteClockStore('timer')); })");
    await page(`await s.calmFoundationReady; s.settingsUpdate('timer', {...s.CALM_PATCH, progressBar: true});
      window.desktop = {setStatus: value => {window.testTray = value}};
      t.timerActions.start(); t.timerActions.pause();
      t.timer.set({...t.timer.get(), elapsedBefore: 65000});`);
  }, 30000);
  afterAll(async () => { await chrome.close(); await server?.close(); });

  it("cycles with one tap, keeps manual time accessible and hides every face in all five looks", async () => {
    for (const look of ["classic", "glass", "sketch", "companion", "sunrise"]) {
      await page(`s.settingsUpdate('appearance', {look: '${look}'}); s.settingsUpdate('timer', {display: 'remaining', style: 'default'});`);
      await chrome.waitFor("document.querySelector('[aria-label^=\"Time display: Remaining\"]')");
      await chrome.evaluate("document.querySelector('[aria-label^=\"Time display:\"]').click()");
      await chrome.waitFor("document.querySelector('.focus-center .timer')?.textContent === '01:05'");
      expect(await chrome.evaluate("document.title")).toBe("01:05 · Focus (paused)");
      await chrome.evaluate("document.querySelector('[aria-label^=\"Time display:\"]').click()");
      await chrome.waitFor("document.querySelector('.timer-hidden')?.textContent === 'Focus · Paused'");
      for (const style of ["default", "flip", "bar", "gauge", "dots", "pie"]) {
        await page(`s.settingsUpdate('timer', {style: '${style}'});`);
        expect(await chrome.evaluate("!!document.querySelector('.focus-center .progress-line, .focus-center .timer, .focus-center .flip-clock')")).toBe(false);
      }
      expect(await chrome.evaluate("document.title")).toBe("Focus · Paused");
      expect(await chrome.evaluate("window.testTray")).toBe("Focus · Paused");
      expect(await chrome.evaluate("document.querySelector('.focus-center [role=timer]').getAttribute('aria-live')")).toBe("off");
      expect(await chrome.evaluate("document.querySelector('.focus-center [role=timer]').textContent")).toContain("minutes left");
      await writeFile(join(shots, `${look}-hidden.png`), await chrome.png());
    }
  }, 30000);

  it("hides Ambient and both floating renderers, updates an open float and survives reload", async () => {
    await page(`s.settingsUpdate('timer', {display: 'hidden'}); s.settingsUpdate('dash', 'ambient');`);
    await chrome.waitFor("document.querySelector('.ambient-timer-time')?.textContent === 'Paused'");
    expect(await chrome.evaluate("document.querySelector('.ambient-timer [role=timer]').getAttribute('aria-live')")).toBe("off");
    await page(`s.settingsUpdate('dash', 'focus');
      (await import('/src/ui/HiddenTime.browser-fixture.tsx')).mountMinis();`);
    await chrome.waitFor("document.querySelectorAll('.mini-timer').length === 2");
    expect(await chrome.evaluate("document.querySelectorAll('.mini-digits, .mini-progress').length")).toBe(0);
    await page(`s.settingsUpdate('timer', {display: 'elapsed'});`);
    await chrome.waitFor("[...document.querySelectorAll('.mini-digits')].every(el => el.textContent === '01:05') && document.querySelectorAll('.mini-digits').length === 2");
    await page(`s.settingsUpdate('timer', {display: 'hidden'}); await (await import('/src/lib/store.ts')).flushReadyStores();`);
    await chrome.waitFor("document.querySelectorAll('.mini-digits, .mini-progress').length === 0");
    await chrome.send("Page.reload");
    await chrome.waitFor("document.querySelector('.timer-hidden')");
    expect(await page("return s.settings.get().timer.display")).toBe("hidden");
    // The actual Settings choice, rather than just the state setter.
    await chrome.evaluate("document.querySelector('[aria-label=\"Settings (S)\"]').click()");
    await chrome.waitFor("document.querySelector('.drawer')");
    await chrome.evaluate("[...document.querySelectorAll('.drawer button')].find(b => b.textContent.trim() === 'Focus Timer').click()");
    await chrome.waitFor("document.querySelector('[aria-label=\"Time display\"]')");
    await chrome.evaluate("[...document.querySelectorAll('[aria-label=\"Time display\"] button')].find(b => b.textContent.trim() === 'Remaining').click()");
    await chrome.waitFor("import('/src/state/settings.ts').then(s => s.settings.get().timer.display === 'remaining')");
    chrome.assertHealthy();
  }, 30000);
  it("keeps keyboard switching, reduced motion, narrow layouts and end choices usable", async () => {
    await chrome.evaluate("document.querySelector('.settings-close')?.click()");
    await page(`s.settingsUpdate('timer', {display: 'hidden'});`);
    await chrome.waitFor("document.querySelector('.timer-hidden')");
    await chrome.waitFor("!document.querySelector('.drawer')");
    await chrome.waitFor("import('/src/lib/alertTypingGuard.ts').then(g => !g.alertTypingGuard.pending())");
    await chrome.evaluate("document.querySelector('.time-display-toggle').focus()");
    expect(await chrome.evaluate("document.activeElement.matches('.time-display-toggle')")).toBe(true);
    await chrome.send("Input.dispatchKeyEvent", {type: "keyDown", key: "Enter", code: "Enter", text: "\r", windowsVirtualKeyCode: 13});
    await chrome.send("Input.dispatchKeyEvent", {type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13});
    await chrome.waitFor("import('/src/state/settings.ts').then(s => s.settings.get().timer.display === 'remaining')");
    for (const appMotion of [false, true]) {
      await chrome.send("Emulation.setEmulatedMedia", {features: [{name: "prefers-reduced-motion", value: appMotion ? "no-preference" : "reduce"}]});
      await page(`s.settingsUpdate('extras', {reduceMotion: ${appMotion}}); s.settingsUpdate('timer', {display: 'hidden'});`);
      for (const [width, height, scale] of [[320, 540, 1], [640, 540, 2]]) {
        await chrome.send("Emulation.setDeviceMetricsOverride", {width, height, deviceScaleFactor: scale, mobile: false});
        await chrome.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
        const layout = await chrome.evaluate("({width: innerWidth, scroll: document.documentElement.scrollWidth, offenders: [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth+1).slice(0,8).map(el => [el.tagName, el.className])})");
        if (layout.scroll > layout.width) { console.log(layout); await writeFile(join(shots, 'narrow-failure.png'), await chrome.png()); }
        expect(layout.scroll).toBeLessThanOrEqual(layout.width);
        const button = await chrome.evaluate("(() => {const b = document.querySelector('.time-display-toggle'); b.scrollIntoView(); const r = b.getBoundingClientRect(); return {width:r.width, height:r.height, bottom:r.bottom};})()");
        expect(button.width).toBeGreaterThan(0); expect(button.height).toBeGreaterThan(0); expect(button.bottom).toBeLessThanOrEqual(height);
        expect(await chrome.evaluate("document.querySelector('.flip-fold, .focus-center .progress-line')")).toBe(null);
      }
    }
    for (const display of ['remaining', 'elapsed', 'hidden']) for (const action of ['Continue', 'Take a break', 'Stop']) {
      await page(`s.settingsUpdate('timer', {display: '${display}'});
        const e = await import('/src/state/timerEngine.ts');
        t.timer.set({...e.INITIAL_TIMER, segId: 'end-${display}-${action}', startedAt: Date.now()-60000, frozen: true, frozenTotal: 60000});
        t.timerActions.complete('end-${display}-${action}', true);`);
      await chrome.waitFor("document.querySelector('[aria-label=\"Finished block\"]')");
      expect(await chrome.evaluate("[...document.querySelectorAll('.recovery-card button')].map(b => b.textContent.trim())")).toEqual(expect.arrayContaining(['Continue', 'Take a break', 'Stop']));
      await chrome.evaluate(`(() => {const b = [...document.querySelectorAll('.recovery-card button')].find(b => b.textContent.trim() === ${JSON.stringify(action)}); b.scrollIntoView(); b.click();})()`);
      await chrome.waitFor("!document.querySelector('[aria-label=\"Finished block\"]')");
      expect(await page("return {running: t.timer.get().startedAt !== null, segment: t.timer.get().segment}")).toMatchObject({running: action !== 'Stop', segment: action === 'Take a break' ? 'short' : 'focus'});
    }
    chrome.assertHealthy();
  }, 30000);

  it("S1 keeps hidden-time recovery choices scrollable at 540px with the action editor open", async () => {
    await chrome.send("Emulation.setDeviceMetricsOverride", {width: 900, height: 820, deviceScaleFactor: 1, mobile: false});
    await page(`s.settingsUpdate('timer', {display: 'remaining', style: 'default'});`);
    await chrome.waitFor("document.querySelector('.focus-center').dataset.fitScroll === 'false' && document.querySelector('.focus-center .timer')");
    await page(`s.settingsUpdate('timer', {display: 'hidden'}); s.settingsUpdate('appearance', {look: 'classic'});
      const i = await import('/src/state/intent.ts'); i.updateIntent({action: 'Write the first paragraph', why: 'Send a draft', cue: 'After tea'});
      t.timerActions.start(); t.timerActions.pause();`);
    await chrome.waitFor("document.querySelector('[aria-label=\"Session context\"]')");
    await chrome.evaluate("document.querySelector('.next-action-buttons button').click()");
    await chrome.waitFor("document.querySelector('.next-action input')");
    await chrome.send("Emulation.setDeviceMetricsOverride", {width: 900, height: 540, deviceScaleFactor: 1, mobile: false});
    await chrome.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    const layout = await chrome.evaluate("(() => {const c = document.querySelector('.focus-center'); return {overflows: c.scrollHeight > c.clientHeight, scrolls: getComputedStyle(c).overflowY, measured: c.dataset.fitScroll};})()");
    expect(layout.overflows).toBe(true); expect(layout.measured).toBe('true'); expect(layout.scrolls).toBe('auto');
    await chrome.evaluate("[...document.querySelectorAll('.recovery-card button')].find(b => b.textContent.trim() === 'Resume').scrollIntoView()");
    const visible = await chrome.evaluate("(() => {const c = document.querySelector('.focus-center').getBoundingClientRect(); const b = [...document.querySelectorAll('.recovery-card button')].find(b => b.textContent.trim() === 'Resume').getBoundingClientRect(); return b.top >= c.top && b.bottom <= c.bottom;})()");
    expect(visible).toBe(true);
  }, 30000);

});
