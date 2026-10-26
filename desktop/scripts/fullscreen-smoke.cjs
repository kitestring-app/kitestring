// Runs this checkout in its own Electron process and temporary profile.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { mkdir, mkdtemp, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const shots = path.resolve(__dirname, '../../.agents/jobs/52-shots');

async function launch() {
  const profile = await mkdtemp(path.join(tmpdir(), 'pomodoro-fullscreen-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [__filename, '--smoke-test', '--force-device-scale-factor=1', `--user-data-dir=${profile}`], { env, stdio: 'inherit' });
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 60000);
  try {
    const [code, signal] = await once(child, 'exit');
    if (code !== 0) throw new Error(`Isolated Electron smoke failed: ${code ?? signal}`);
  } finally {
    clearTimeout(watchdog);
    await rm(profile, { recursive: true, force: true });
  }
}

async function smoke() {
  const { app, BrowserWindow, screen } = require('electron');
  require('../main.cjs');
  await app.whenReady();
  let window;
  for (let i = 0; i < 200; i++) {
    window = BrowserWindow.getAllWindows().find(w => w.webContents.getURL() === 'app://custom-pomodoro/');
    if (window && !window.webContents.isLoadingMainFrame() && await window.webContents.executeJavaScript('!!document.querySelector(".app") && !!window.desktop')) break;
    await delay(50);
  }
  assert.ok(window && !window.webContents.isLoadingMainFrame(), 'Checkout dashboard loaded');
  await mkdir(shots, { recursive: true });
  const evaluate = source => window.webContents.executeJavaScript(source);
  // A fresh Calm profile keeps this check silent and independent of saved data.
  window.showInactive();
  await delay(500);
  const report = { electron: process.versions.electron, platform: process.platform, displays: screen.getAllDisplays().map(d => ({ id: d.id, bounds: d.bounds })), transitions: [] };
  const sample = async (label, index, started) => {
    const at = Date.now() - started;
    const image = await window.webContents.capturePage();
    const foreground = await evaluate(`({ opacity: getComputedStyle(document.querySelector('.app')).opacity, classes: document.documentElement.className, viewport: [innerWidth, innerHeight], wallpaperOpacity: getComputedStyle(document.querySelector('.bg, .look-bg')).opacity })`);
    const file = `${label}-${String(index).padStart(3, '0')}.png`;
    return { file, at, size: image.getSize(), ...foreground, image };
  };
  try {
    for (const route of ['bridge', 'native', 'reduced']) {
      await evaluate(`document.documentElement.classList.toggle('reduce-motion', ${route === 'reduced'})`);
      if (route === 'native' && screen.getAllDisplays()[1]) {
        const { x, y } = screen.getAllDisplays()[1].workArea;
        window.setPosition(x + 40, y + 40);
        await delay(250);
      }
      for (const target of [true, false]) {
      const label = `${route}-${target ? 'enter' : 'leave'}`;
      const before = screen.getDisplayMatching(window.getBounds()).id;
      const events = [];
      const listeners = ['will-enter-full-screen', 'enter-full-screen', 'will-leave-full-screen', 'leave-full-screen', 'will-resize', 'resize', 'resized'].map(name => {
        const listener = () => events.push({ name, at: Date.now() - started, full: window.isFullScreen(), bounds: window.getBounds() });
        window.on(name, listener); return [name, listener];
      });
      const started = Date.now();
      const frames = [await sample(label, 0, started)];
      const pending = [];
      let index = 1;
      const interval = setInterval(() => pending.push(sample(label, index++, started)), 50);
      try {
        if (route === 'native') window.setFullScreen(target);
        else {
          assert.equal(await evaluate('window.desktop.toggleFullScreen()'), target);
          // Requests during the native animation must not start a second transition.
          await evaluate('window.desktop.toggleFullScreen()');
        }
        const name = target ? 'enter-full-screen' : 'leave-full-screen';
        for (let i = 0; i < 160 && !events.some(e => e.name === name); i++) await delay(50);
        assert.ok(events.some(e => e.name === name), `${label} native completion`);
        await delay(450);
      } finally {
        clearInterval(interval);
        frames.push(...await Promise.all(pending));
        for (const [name, listener] of listeners) window.removeListener(name, listener);
      }
      // PNG encoding is synchronous. Keep it outside the 50ms capture loop.
      for (const frame of frames) {
        await writeFile(path.join(shots, frame.file), frame.image.toPNG());
        delete frame.image;
      }
      const after = screen.getDisplayMatching(window.getBounds()).id;
      report.transitions.push({ label, before, after, events, frames });
      assert.equal(window.isFullScreen(), target);
      assert.equal(events.filter(e => e.name.endsWith('-full-screen')).length, 1, 'No stacked native transition');
      assert.equal(after, before, 'Fullscreen must stay on the current display');
      if (route === 'reduced') assert.ok(frames.every(f => f.opacity === '1'), 'Reduced motion skips fades');
      else assert.ok(frames.some(f => Number(f.opacity) === 0), `${label} foreground fully hidden`);
      assert.equal(Number(frames.at(-1).opacity), 1, `${label} foreground restored`);
      assert.ok(frames.every(f => f.wallpaperOpacity === '1'), 'Wallpaper stays visible');
      console.log(`${label}: ${frames.length} capturePage frames, display ${before} -> ${after}`);
      }
    }
    await writeFile(path.join(shots, 'frames.json'), JSON.stringify(report, null, 2) + '\n');
    app.exit(0);
  } catch (error) {
    report.error = error.stack;
    await writeFile(path.join(shots, 'frames.json'), JSON.stringify(report, null, 2) + '\n');
    console.error(error);
    app.exit(1);
  }
}

(process.versions.electron ? smoke() : launch()).catch(error => { console.error(error); process.exit(1); });
