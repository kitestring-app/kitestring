#!/usr/bin/env node
// Dev-only visual guard. Uses Vite and Node's built-in WebSocket, never a personal browser.
import { chromeArgs } from './browser/chrome-args.ts';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOOKS = ['classic', 'glass', 'sketch', 'companion', 'sunrise'];
const VIEWS = ['home', 'focus-idle', 'focus-running', 'focus-reentry', 'ambient', 'settings-themes', 'settings-clock', 'settings-timer', 'tasks-panel', 'sounds-panel'];
const SIZES = [[1280, 820], [1440, 900]];
const FIXED_TIME = Date.parse('2026-10-26T09:24:00.000Z');
const SEED = 480026;
let interruption;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const normalize = name => name.split('\\').join('/');
const usage = 'Usage: node scripts/golden.mjs capture <dir>\n       node scripts/golden.mjs compare <baselineDir> <newDir> [--allow <glob>...]';

// Small, explicit glob language. A single * stays inside a directory; ** crosses them.
export function globRegex(glob) {
  if (!glob || glob.startsWith('/') || glob.split('/').includes('..')) throw new Error(`Invalid relative glob: ${glob}`);
  let expression = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') { expression += '(?:.*/)?'; i++; }
      else expression += '.*';
    } else if (c === '*') expression += '[^/]*';
    else if (c === '?') expression += '[^/]';
    else expression += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(expression + '$');
}

export class Chrome {
  pending = new Map();
  sequence = 0;
  errors = [];
  blocked = new Set();
  async start() {
    const executable = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(path => path && existsSync(path));
    if (!executable) throw new Error('Chrome not found. Set CHROME_BIN to a Chrome/Chromium executable.');
    this.profile = await mkdtemp(join(tmpdir(), 'pomodoro-golden-chrome-'));
    this.process = spawn(executable, chromeArgs(this.profile, [
      '--disable-extensions',
      '--disable-gpu', '--disable-gpu-compositing', '--disable-skia-runtime-opts',
      '--disable-lcd-text', '--font-render-hinting=none',
      '--num-raster-threads=1', '--disable-partial-raster', '--disable-zero-copy',
      '--run-all-compositor-stages-before-draw', '--disable-threaded-animation', '--disable-threaded-scrolling',
      '--force-color-profile=srgb', '--force-device-scale-factor=1', '--lang=en-US',
      '--remote-debugging-address=127.0.0.1',
    ]), { stdio: 'ignore' });
    this.process.on('error', error => { this.launchError = error; });
    const portFile = join(this.profile, 'DevToolsActivePort');
    for (let i = 0; i < 200 && !existsSync(portFile); i++) {
      if (interruption) throw interruption;
      if (this.launchError) throw this.launchError;
      if (this.process.exitCode !== null) throw new Error(`Chrome exited (${this.process.exitCode})`);
      await delay(50);
    }
    const port = (await readFile(portFile, 'utf8')).split('\n')[0];
    const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
    const page = pages.find(p => p.type === 'page' && p.url === 'about:blank');
    if (!page) throw new Error('No throwaway Chrome page');
    this.socket = new WebSocket(page.webSocketDebuggerUrl);
    this.socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(String(data));
      if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params.exceptionDetails);
      if (message.method === 'Fetch.requestPaused') {
        const { requestId, request } = message.params;
        const local = this.origin && request.url.startsWith(this.origin + '/');
        const permitted = local || /^(data:|blob:|about:)/.test(request.url);
        if (!permitted) this.blocked.add(new URL(request.url).origin);
        void this.send(permitted ? 'Fetch.continueRequest' : 'Fetch.failRequest', permitted ? { requestId } : { requestId, errorReason: 'BlockedByClient' })
          .catch(error => { this.errors.push({ description: error.message }); });
      }
      const request = this.pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timeout);
      this.pending.delete(message.id);
      if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
      else request.resolve(message.result);
    });
    await new Promise((resolveOpen, reject) => {
      this.socket.addEventListener('open', resolveOpen, { once: true });
      this.socket.addEventListener('error', () => reject(new Error('Throwaway Chrome connection failed')), { once: true });
    });
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    this.version = (await this.send('Browser.getVersion')).product;
  }
  send(method, params = {}) {
    if (interruption) return Promise.reject(interruption);
    return new Promise((resolveRequest, reject) => {
      const id = ++this.sequence;
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 30000);
      this.pending.set(id, { resolve: resolveRequest, reject, timeout, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const reply = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (reply.exceptionDetails) throw new Error(JSON.stringify(reply.exceptionDetails));
    return reply.result.value;
  }
  async waitFor(expression) {
    for (let i = 0; i < 150; i++) {
      this.assertHealthy();
      if (await this.evaluate(`Promise.resolve(${expression}).then(Boolean)`)) return;
      await delay(50);
    }
    throw new Error(`Page did not reach: ${expression}`);
  }
  assertHealthy() {
    if (this.errors.length) throw new Error(`Browser errors: ${JSON.stringify(this.errors)}`);
  }
  async png() {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
    return Buffer.from(data, 'base64');
  }
  async close() {
    this.socket?.close();
    for (const request of this.pending.values()) { clearTimeout(request.timeout); request.reject(new Error('Chrome closed')); }
    this.pending.clear();
    if (this.process && this.process.exitCode === null && this.process.signalCode === null) {
      const exited = once(this.process, 'exit');
      this.process.kill('SIGKILL');
      await exited;
    }
    if (this.profile) await rm(this.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

// Runs before app modules on every new document. Keep real timers so React/Vite can settle.
function freezeEnvironment(now, seed) {
  const RealDate = Date;
  globalThis.Date = new Proxy(RealDate, {
    construct(target, args) { return Reflect.construct(target, args.length ? args : [now]); },
    apply() { return new RealDate(now).toString(); },
    get(target, property) { return property === 'now' ? () => now : Reflect.get(target, property); },
  });
  let random = seed;
  Math.random = () => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random / 4294967296; };
  // Project the signed-out Mac renderer without native windows, audio, IPC or account traffic.
  const off = () => () => {};
  const signedOut = async () => ({ status: 401, data: { ok: false } });
  window.desktop = {
    cloud: { status: signedOut, request: signedOut, signIn: signedOut, signOut: signedOut, openReset: async () => false },
    armAlarm: async () => true, disarmAlarm() {}, cancelSpeech() {}, release() {}, preventSleep() {},
    setStatus() {}, publishTimerState() {}, publishAudioState() {},
    floatTimer: async () => false, toggleFullScreen: async () => false,
    setFloatingPreferences: async () => true,
    onFloatingPreferences: off, onFloatTimer: off, onLifecycle: off, onFlush: off,
    onMenuCommand: off, onTimerRequest: off, onTimerAction: off, onAudioAction: off, onAudioRequest: off,
  };
}

async function seedScene(look, view) {
  const [s, t, k, i, p, engine, mixer] = await Promise.all([
    import('/src/state/settings.ts'), import('/src/state/timer.ts'), import('/src/state/tasks.ts'),
    import('/src/state/intent.ts'), import('/src/lib/store.ts'), import('/src/state/timerEngine.ts'), import('/src/audio/mixer.ts'),
  ]);
  await Promise.all([s.calmFoundationReady, s.localPreferencesReady, p.flushReadyStores()]);
  const settings = structuredClone(s.DEFAULT_SETTINGS);
  settings.appearance.look = look;
  settings.dash = view === 'home' || view === 'settings-clock' ? 'home' : view === 'ambient' ? 'ambient' : 'focus';
  settings.clock.flip = view === 'settings-clock';
  settings.clock.format = '24';
  settings.extras = { ...settings.extras, reduceMotion: true, disableAnimated: true, preventSleep: false, clearMode: false, randomizer: 'off' };
  settings.timer = { ...settings.timer, takeover: false, speak: false, notify: false, bringToFront: false, interruptionPrompt: false, ticking: 'off', alertSound: 'none', focusDoneSound: 'none', breakOverSound: 'none' };
  settings.quotes = { category: 'focus', randomCategory: true, inFocus: true, inHome: true };
  if (view.startsWith('settings-')) settings.lastTab = view.slice('settings-'.length);
  s.settings.set(settings);
  k.tasks.set([
    { id: 'golden-draft', title: 'Draft the proposal', color: '#C3B8F5', etaMin: 25, done: false, createdAt: Date.now() },
    { id: 'golden-outline', parentId: 'golden-draft', title: 'Write the opening paragraph', etaMin: 15, done: false, createdAt: Date.now() },
    { id: 'golden-check', parentId: 'golden-draft', title: 'Check the outline', etaMin: 10, done: true, createdAt: Date.now() },
    { id: 'golden-review', title: 'Review the draft', color: '#A8E5C0', etaMin: 20, done: false, createdAt: Date.now() },
    { id: 'golden-notes', title: 'Collect reference notes', color: '#A5D8F0', etaMin: 10, done: true, createdAt: Date.now() },
  ]);
  k.focusPick.set('golden-outline');
  i.updateIntent({ action: 'Write the opening paragraph', why: 'Make the first draft easy to review', cue: 'After tea, open the draft', reward: 'A short walk outside' });
  mixer.mixerStore.set({ layers: [{ id: 'rain', volume: 0.35 }, { id: 'brown', volume: 0.2 }], mixes: [], favourites: [] });
  t.timer.set({ ...engine.INITIAL_TIMER, segId: 'golden-focus', round: 2 });
  if (view === 'focus-running' || view === 'focus-reentry') {
    t.timerActions.start();
    t.timer.set({ ...t.timer.get(), startedAt: Date.now() - 258000 });
    if (view === 'focus-reentry') t.timerActions.pause();
  }
  await p.flushReadyStores();
  return { look: s.settings.get().appearance.look, dash: s.settings.get().dash, flip: s.settings.get().clock.flip,
    running: t.timer.get().startedAt !== null, reentry: !!t.timer.get().reentry, remaining: t.totalMs() - (t.timer.get().elapsedBefore + (t.timer.get().startedAt === null ? 0 : Date.now() - t.timer.get().startedAt)) };
}

async function settle(chrome, view) {
  await chrome.evaluate(`(async () => {
    if (!document.getElementById('golden-freeze')) {
      const style = document.createElement('style'); style.id = 'golden-freeze';
      style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
      document.head.append(style);
    }
    document.activeElement?.blur(); window.scrollTo(0, 0);
    for (const el of document.querySelectorAll('.drawer main, .panel-body')) el.scrollTo(0, 0);
    if (${JSON.stringify(view)} === 'settings-clock') {
      const flip = document.querySelector('.flip-palette-picker');
      if (!flip) throw new Error('Clock flip palettes are missing');
      flip.closest('.card').scrollIntoView({ block: 'start', behavior: 'instant' });
    }
    await document.fonts.ready;
    await Promise.all([...document.images].map(img => img.decode().catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`);
  // Native overlay scrollbars fade outside CSS animation control after scrollIntoView.
  // Capture their resting state, not the initially stable, still-visible interval.
  if (view === 'settings-clock') await delay(3000);
  // A settled frame must remain byte-identical for two intervals. No pixel tolerance.
  let previous = await chrome.png();
  let stable = 0;
  for (let i = 0; i < 20; i++) {
    await delay(120);
    const current = await chrome.png();
    stable = previous.equals(current) ? stable + 1 : 0;
    previous = current;
    if (stable === 2) { chrome.assertHealthy(); return current; }
  }
  throw new Error('Scene keeps changing after fonts, layout and animation freeze');
}

export async function capture(directory, { looks = LOOKS, views = VIEWS, sizes = SIZES } = {}) {
  const destination = resolve(directory);
  await mkdir(destination, { recursive: true });
  if ((await readdir(destination)).length) throw new Error('Capture directory must be empty. Use a new directory to preserve the baseline.');
  const chrome = new Chrome();
  let server, cache;
  try {
    cache = await mkdtemp(join(tmpdir(), 'pomodoro-golden-vite-'));
    const { createServer } = await import('vite');
    server = await createServer({ root: ROOT, configLoader: 'runner', cacheDir: cache, server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, clearScreen: false, logLevel: 'error' });
    await server.listen();
    const address = server.httpServer.address();
    chrome.origin = `http://127.0.0.1:${address.port}`;
    await chrome.start();
    await chrome.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    await chrome.send('Emulation.setTimezoneOverride', { timezoneId: 'UTC' });
    await chrome.send('Emulation.setLocaleOverride', { locale: 'en-US' });
    await chrome.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: 'dark' }] });
    await chrome.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${freezeEnvironment})(${FIXED_TIME}, ${SEED})` });
    const images = [];
    for (const [width, height] of sizes) for (const look of looks) for (const view of views) {
      await chrome.send('Page.navigate', { url: 'about:blank' });
      await chrome.waitFor("location.href === 'about:blank'");
      await chrome.send('Storage.clearDataForOrigin', { origin: chrome.origin, storageTypes: 'all' });
      await chrome.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      const navigation = await chrome.send('Page.navigate', { url: chrome.origin });
      if (navigation.errorText) throw new Error(navigation.errorText);
      await chrome.waitFor("document.querySelector('.next-action') && document.readyState === 'complete'");
      // Seed only after the clock owner has loaded its durable snapshot.
      await chrome.waitFor("import('/src/state/timer.ts').then(async t => { await t.timerHydrationReady; return (await import('/src/lib/store.ts')).canWriteClockStore('timer'); })");
      const fixture = await chrome.evaluate(`(${seedScene})(${JSON.stringify(look)}, ${JSON.stringify(view)})`);
      if (fixture.look !== look || fixture.running !== (view === 'focus-running') || fixture.reentry !== (view === 'focus-reentry')) throw new Error(`Invalid fixture: ${JSON.stringify(fixture)}`);
      await chrome.waitFor(`document.documentElement.dataset.look === ${JSON.stringify(look)}`);
      if (view.startsWith('settings-')) {
        await chrome.evaluate(`document.querySelector('[aria-label="Settings (S)"]').click()`);
        await chrome.waitFor(`document.querySelector('.drawer .tab[aria-current="true"]')?.textContent.trim() === ${JSON.stringify(view === 'settings-timer' ? 'Focus Timer' : view === 'settings-clock' ? 'Clock' : 'Themes')}`);
      } else if (view === 'tasks-panel' || view === 'sounds-panel') {
        const panel = view === 'tasks-panel' ? 'tasks' : 'sounds';
        await chrome.evaluate(`document.querySelector('[data-panel="${panel}"]').click()`);
        await chrome.waitFor(`document.querySelector('.${panel}-panel:not([hidden])')`);
        if (panel === 'sounds') await chrome.waitFor(`!document.querySelector('.sounds-panel').textContent.includes('Loading your mixes')`);
      } else if (view === 'focus-reentry') await chrome.waitFor(`document.querySelector('[aria-label="Session context"]')`);
      else if (view === 'focus-running') await chrome.waitFor(`document.querySelector('[aria-label="Pause · Space"]')`);
      else if (view === 'home' || view === 'ambient') await chrome.waitFor(`document.querySelector('[aria-label="Clock"]')`);
      const png = await settle(chrome, view);
      const name = `${width}x${height}/${look}/${view}.png`;
      await mkdir(dirname(join(destination, name)), { recursive: true });
      await writeFile(join(destination, name), png);
      images.push({ name, sha256: sha256(png), ...fixture });
      console.log(`CAPTURE ${name}`);
    }
    const manifest = { format: 1, browser: chrome.version, platform: process.platform, architecture: process.arch,
      viewportScale: 1, timezone: 'UTC', locale: 'en-US', fixedTime: new Date(FIXED_TIME).toISOString(), randomSeed: SEED,
      renderer: 'shared desktop renderer with inert signed-out native bridge; no native window test',
      externalAssets: 'blocked, local CSS wallpapers and bundled fonts only', blockedOrigins: [...chrome.blocked].sort(), images };
    await writeFile(join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Captured ${images.length} images. Chrome ${chrome.version}.`);
  } finally {
    await chrome.close();
    await server?.close();
    if (cache) await rm(cache, { recursive: true, force: true });
  }
}

async function pngFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    if (!prefix && entry.name === 'diffs') continue;
    const name = normalize(join(prefix, entry.name));
    if (entry.isDirectory()) files.push(...await pngFiles(directory, name));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) files.push(name);
  }
  return files.sort();
}

// Invoked in Chrome. Canvas decodes both PNGs and compares all four channels exactly.
export async function diffPng(before, after) {
  const decode = async data => {
    if (data === null) return { width: 0, height: 0, pixels: [] };
    const image = new Image(); image.src = 'data:image/png;base64,' + data; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0);
    return { width: canvas.width, height: canvas.height, pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
  };
  const a = await decode(before), b = await decode(after);
  const width = Math.max(a.width, b.width), height = Math.max(a.height, b.height);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d'), overlay = ctx.createImageData(width, height);
  let changedPixels = 0, left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const inA = x < a.width && y < a.height, inB = x < b.width && y < b.height;
    const ai = (y * a.width + x) * 4, bi = (y * b.width + x) * 4, oi = (y * width + x) * 4;
    let changed = inA !== inB;
    for (let c = 0; c < 4 && !changed; c++) changed = a.pixels[ai + c] !== b.pixels[bi + c];
    if (changed) {
      changedPixels++; left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
    for (let c = 0; c < 3; c++) {
      const value = inB ? b.pixels[bi + c] : inA ? a.pixels[ai + c] : 0;
      overlay.data[oi + c] = changed ? Math.round(value * 0.35 + (c === 0 ? 255 : 0) * 0.65) : value;
    }
    overlay.data[oi + 3] = 255;
  }
  ctx.putImageData(overlay, 0, 0);
  return { changedPixels, boundingBox: changedPixels ? { x: left, y: top, width: right - left + 1, height: bottom - top + 1 } : null,
    beforeSize: [a.width, a.height], afterSize: [b.width, b.height], diff: changedPixels ? canvas.toDataURL('image/png').split(',')[1] : null };
}

export async function compare(baseline, candidate, allows = []) {
  const base = resolve(baseline), next = resolve(candidate);
  if (base === next) throw new Error('Baseline and candidate must be different directories.');
  const matchers = allows.map(globRegex);
  const [baseNames, nextNames] = await Promise.all([pngFiles(base), pngFiles(next)]);
  if (!baseNames.length || !nextNames.length) throw new Error('Both directories must contain PNG images.');
  const baseSet = new Set(baseNames), nextSet = new Set(nextNames);
  const names = [...new Set([...baseNames, ...nextNames])].sort();
  const chrome = new Chrome();
  let failures = 0, changedImages = 0, allowedImages = 0, totalChangedPixels = 0;
  const results = [];
  const diffRoot = join(next, 'diffs');
  try {
    await chrome.start();
    // Do not discard prior reports/diffs or write into either input PNG tree.
    await mkdir(diffRoot, { recursive: true });
    for (const name of names) {
      const allowed = matchers.some(regex => regex.test(name));
      const present = baseSet.has(name) && nextSet.has(name);
      const [a, b] = await Promise.all([
        baseSet.has(name) ? readFile(join(base, name)) : null,
        nextSet.has(name) ? readFile(join(next, name)) : null,
      ]);
      const result = await chrome.evaluate(`(${diffPng})(${JSON.stringify(a?.toString('base64') ?? null)}, ${JSON.stringify(b?.toString('base64') ?? null)})`);
      if (result.changedPixels) {
        const diffFile = join(diffRoot, name);
        await mkdir(dirname(diffFile), { recursive: true });
        await writeFile(diffFile, Buffer.from(result.diff, 'base64'));
      } else await rm(join(diffRoot, name), { force: true });
      delete result.diff;
      totalChangedPixels += result.changedPixels;
      if (!present) result.error = baseSet.has(name) ? 'missing candidate image' : 'extra candidate image';
      const changed = !present || result.changedPixels > 0;
      if (changed) { changedImages++; if (allowed) allowedImages++; else failures++; }
      const status = changed ? (allowed ? 'ALLOW' : 'FAIL') : 'PASS';
      console.log(`${status} ${name}: ${result.changedPixels} changed pixels, bbox ${JSON.stringify(result.boundingBox)}${result.error ? `, ${result.error}` : ''}`);
      results.push({ name, allowed, status, ...result });
    }
    const summary = { images: names.length, changedImages, allowedImages, failures, totalChangedPixels };
    await writeFile(join(diffRoot, 'report.json'), JSON.stringify({ ...summary, results }, null, 2) + '\n');
    console.log(`Compared ${names.length} images: ${changedImages} changed, ${allowedImages} allowed, ${failures} failures, ${totalChangedPixels} changed pixels.`);
    return summary;
  } finally { await chrome.close(); }
}

export async function main(args = process.argv.slice(2)) {
  const [mode, first, second, ...rest] = args;
  if (mode === 'capture' && first && !second) return capture(first);
  if (mode === 'compare' && first && second) {
    const allows = [];
    for (let i = 0; i < rest.length; i += 2) {
      if (rest[i] !== '--allow' || !rest[i + 1]) throw new Error(usage);
      allows.push(rest[i + 1]);
    }
    const summary = await compare(first, second, allows);
    if (summary.failures) process.exitCode = 1;
    return summary;
  }
  throw new Error(usage);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // A controlled interruption still tears down only the processes this script started.
  const interrupted = signal => { interruption = new Error(`Interrupted by ${signal}`); };
  process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
  main().catch(error => { console.error(error.stack ?? error); process.exitCode = 1; })
    .finally(() => { process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted); });
}
