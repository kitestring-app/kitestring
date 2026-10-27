const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const { once } = require('node:events');
const net = require('node:net');
const path = require('node:path');
const { connect, waitFor } = require('./cdp.cjs');
const { bannersReady } = require('./attention-smoke.cjs');

function checkCSP(csp) {
  const directives = new Map(csp.split(';').map((part) => {
    const [name, ...values] = part.trim().split(/\s+/);
    return [name, values];
  }));
  for (const [name, hosts] of [
    ['script-src', ["'self'"]],
    ['frame-src', ['https://www.youtube.com', 'https://open.spotify.com', 'https://embed.music.apple.com', 'https://music.amazon.com']],
    ['media-src', ["'self'", 'blob:', 'https://stream.nightride.fm', 'https://stream.radioparadise.com', 'https://media01.gamingnow.net:8010']],
    ['connect-src', ["'self'", 'https://stream.nightride.fm', 'https://stream.radioparadise.com', 'https://media01.gamingnow.net:8010', 'https://nightride.fm', 'https://api.radioparadise.com']],
  ]) {
    for (const host of hosts) assert.ok(directives.get(name)?.includes(host), `The packaged CSP must allow ${host} in ${name}`);
  }
}
function processUsage(rootPid) {
  const tree = execFileSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' }).trim().split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number));
  const ids = new Set([rootPid]);
  let previous;
  do {
    previous = ids.size;
    for (const [pid, parent] of tree) if (ids.has(parent)) ids.add(pid);
  } while (ids.size !== previous);
  const processes = execFileSync('ps', ['-o', 'pid=,rss=,%cpu=', '-p', [...ids].join(',')], { encoding: 'utf8' })
    .trim().split('\n').map((line) => {
      const [pid, rssKiB, cpuPercent] = line.trim().split(/\s+/).map(Number);
      return { pid, rssKiB, cpuPercent };
    });
  return { count: processes.length, rssMiB: +(processes.reduce((sum, p) => sum + p.rssKiB, 0) / 1024).toFixed(2),
    cpuPercent: +processes.reduce((sum, p) => sum + p.cpuPercent, 0).toFixed(1), processes };
}
const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function main() {
  const base = path.join(__dirname, '..');
  const appPath = path.join(base, 'out', 'mac-arm64', 'Kitestring.app', 'Contents');
  const bundle = path.dirname(appPath);
  execFileSync('codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'inherit' });
  const { getCurrentFuseWire, FuseV1Options } = await import('@electron/fuses');
  const { FuseState } = require('@electron/fuses/dist/constants.js');
  const fuses = await getCurrentFuseWire(bundle);
  for (const key of ['RunAsNode', 'EnableNodeOptionsEnvironmentVariable', 'EnableNodeCliInspectArguments']) {
    assert.equal(fuses[FuseV1Options[key]], FuseState.DISABLE, `${key} must be disabled`);
  }
  for (const key of ['OnlyLoadAppFromAsar', 'EnableEmbeddedAsarIntegrityValidation']) {
    assert.equal(fuses[FuseV1Options[key]], FuseState.ENABLE, `${key} must be enabled`);
  }
  console.log('The packaged signature verifies and all five requested fuses are set.');
  const packagedHeaders = await readFile(path.join(appPath, 'Resources', 'web', '_headers'), 'utf8');
  const packagedCSP = packagedHeaders.match(/^\s*Content-Security-Policy:\s*(.+)$/mi)?.[1];
  assert.ok(packagedCSP, 'The packaged _headers file must contain a CSP');
  checkCSP(packagedCSP);
  console.log('The packaged CSP allows the YouTube embeds and radio hosts.');
  await mkdir(path.join(base, 'dist'), { recursive: true });
  const profile = await mkdtemp(path.join(base, 'dist', 'smoke-profile-'));
  const freePort = async () => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = server.address().port;
    await new Promise((resolve) => server.close(resolve));
    return port;
  };
  const port = await freePort();
  const child = spawn(path.join(appPath, 'MacOS', 'Kitestring'), [
    '--smoke-test', `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    ...(process.argv.includes('--banner-test') ? ['--smoke-extra-display'] : []),
    ...(process.argv.includes('--single-display-test') ? ['--smoke-single-display'] : []),
    ...(process.argv.includes('--no-sandbox') ? ['--no-sandbox'] : []),
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  let launchError;
  child.on('error', (error) => { launchError = error; });
  const record = (data) => { logs = (logs + data).slice(-24000); };
  child.stdout.on('data', record);
  child.stderr.on('data', record);
  let cdp;
  let stage = 'launching the packaged app';
  let watchdogExpired = false;
  const watchdog = setTimeout(() => { watchdogExpired = true; child.kill('SIGTERM'); }, 180000);
  const alive = () => {
    if (launchError) throw launchError;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`The app exited with ${child.exitCode ?? child.signalCode}`);
  };
  const step = (label) => { alive(); stage = label; console.log(`${label}.`); };
  try {
    const page = await waitFor('The local app page', async () => {
      alive();
      const pages = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1500) })).json();
      return pages.find((item) => item.type === 'page' && item.url === 'app://custom-pomodoro/');
    }, { timeoutMs: 30000 });
    step('Connecting to the temporary app renderer');
    cdp = await connect(page.webSocketDebuggerUrl);
    let mainContext;
    const evaluate = async (expression, awaitPromise = false) => {
      alive();
      const result = await cdp.send('Runtime.evaluate', { expression, contextId: mainContext, returnByValue: true, awaitPromise });
      assert.equal(result.exceptionDetails, undefined, `Renderer evaluation failed: ${JSON.stringify(result.exceptionDetails)}`);
      return result.result.value;
    };
    step('Waiting for the page to load');
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Runtime.runIfWaitingForDebugger');
    const mainFrameId = (await cdp.send('Page.getFrameTree')).frameTree.frame.id;
    mainContext = (await waitFor('The main page JavaScript context', () => cdp.events.find((event) =>
      event.method === 'Runtime.executionContextCreated' && event.params.context.auxData?.isDefault && event.params.context.auxData.frameId === mainFrameId))).params.context.id;
    await waitFor('The loaded dashboard and desktop bridge', async () => {
      alive();
      return evaluate('document.readyState === "complete" && document.querySelector("#root")?.children.length > 0 && !!window.desktop');
    });
    console.log(`The dashboard loaded${cdp.events.some((event) => event.method === 'Page.loadEventFired') ? ' (page load event received)' : ' (confirmed by readiness polling)'}.`);
    const nativeState = () => evaluate('window.__desktopSmokeState()');
    step('Checking the local page, bridge and security headers');
    const info = await evaluate(`(async () => {
      const response = await fetch('/index.html');
      return { href: location.href, secure: isSecureContext, rendered: document.querySelector('#root')?.children.length > 0,
        bridge: Object.keys(window.desktop || {}).sort(), frozen: Object.isFrozen(window.desktop), node: typeof window.require,
        status: response.status, csp: response.headers.get('Content-Security-Policy'),
        nosniff: response.headers.get('X-Content-Type-Options'), html: (await response.text()).includes('<div id="root">'),
        notifications: Notification.permission };
    })()`, true);
    assert.equal(info.href, 'app://custom-pomodoro/');
    assert.equal(info.secure, true);
    assert.equal(info.rendered, true);
    assert.deepEqual(info.bridge, ['armAlarm', 'attention', 'cancelSpeech', 'cloud', 'consumeSuspension', 'disarmAlarm', 'floatTimer',
      'getFullScreen', 'getSecureDns', 'notificationStatus', 'onAudioAction', 'onAudioRequest', 'onFloatTimer',
      'onFloatingPreferences', 'onFlush', 'onFullScreenChange', 'onFullScreenTransition', 'onLifecycle', 'onMenuCommand',
      'onParked', 'onTimerAction', 'onTimerRequest', 'parkingStatus', 'platform', 'preventSleep', 'publishAudioState',
      'publishTimerState', 'release', 'setFloatingPreferences', 'setSecureDns', 'setStatus', 'speak', 'testReminder',
      'toggleFullScreen']);
    assert.equal(info.frozen, true);
    assert.equal(info.node, 'undefined');
    assert.equal(info.status, 200);
    assert.equal(info.nosniff, 'nosniff');
    assert.equal(info.csp, packagedCSP, 'The served CSP must match the packaged _headers');
    assert.equal(info.html, true);
    assert.equal(info.notifications, 'granted');
    const assets = await evaluate(`(async () => {
      const script = await fetch(document.querySelector('script[type="module"]').src);
      const audio = await fetch('/sounds/cafe.ogg', { headers: { Range: 'bytes=0-15' } });
      const spa = await fetch('/focus/today');
      const traversal = await fetch('/..%2f..%2fetc/passwd');
      const nul = await fetch('/%00');
      return { script: script.status, audio: audio.status, mime: audio.headers.get('Content-Type'), bytes: (await audio.arrayBuffer()).byteLength,
        spa: spa.status, traversal: traversal.status, nul: nul.status };
    })()`, true);
    assert.deepEqual(assets, { script: 200, audio: 206, mime: 'audio/ogg', bytes: 16, spa: 200, traversal: 403, nul: 403 });
    step('Checking the packaged alert sounds and native selection');
    for (const alertSound of ['signature', 'bell', 'chime', 'digital', 'wood', 'none']) {
      for (const kind of ['focus-done', 'break-over']) {
        const filename = `${alertSound}-${kind}.wav`;
        const shipped = await readFile(path.join(appPath, 'Resources', 'web', 'alerts', filename));
        const source = await readFile(path.join(base, '..', 'public', 'alerts', filename));
        assert.ok(shipped.equals(source), `${filename} must match the generated WAV`);
        assert.equal(shipped.toString('ascii', 0, 4), 'RIFF');
        assert.equal(await evaluate(`window.desktop.armAlarm({ at: Date.now() + 60000, kind: ${JSON.stringify(kind)}, alertSound: ${JSON.stringify(alertSound)}, volume: 0, speak: false, notify: false, attention: false })`, true), true);
        assert.equal((await nativeState()).native.pending.alertSound, alertSound);
      }
    }
    assert.equal(await evaluate('window.desktop.armAlarm({ at: Date.now() + 60000, kind: "focus-done", alertSound: "../../evil", volume: 0, speak: false })', true), false);
    await evaluate('window.desktop.disarmAlarm()');
    await waitFor('The test alarm cleared', async () => !(await nativeState()).native.pending);
    step('Checking attention and release against the native window');
    await settle(3000);
    const idleUsage = processUsage(child.pid);
    const initial = await nativeState();
    assert.deepEqual(initial.banners, []);
    if (process.argv.includes('--single-display-test')) {
      assert.equal(initial.displayCount, 1);
      assert.equal(initial.simulatedSingleDisplay, true);
    }
    if (process.argv.includes('--banner-test')) assert.equal(initial.simulatedDisplay, true);
    assert.equal(initial.status.startsWith('🎯 '), true, 'Focus tray text must retain its emoji prefix');
    assert.equal(initial.visible, false, 'The smoke window must start hidden');
    await evaluate('window.desktop.attention("bogus")');
    assert.deepEqual(await nativeState(), initial, 'Invalid attention must have no native effect');
    // Main-process attention must work while the renderer is paused.
    await evaluate('window.desktop.armAlarm({ at: Date.now() + 500, kind: "focus-done", alertSound: "none", volume: 0, speak: false, notify: false, attention: true })', true);
    await cdp.send('Debugger.enable');
    await cdp.send('Debugger.pause');
    await settle(900);
    await cdp.send('Debugger.resume');
    await cdp.send('Debugger.disable');
    const diagnostics = () => evaluate('window.__desktopSmokeDiagnostics()', true);
    const acceptedAttention = (await diagnostics()).attention;
    const raised = await waitFor('The raised window', async () => {
      const state = await nativeState();
      return state.visible && state.alwaysOnTop && state.allWorkspaces && state.attentionActive &&
        bannersReady(state) ? state : false;
    }, { timeoutMs: 10000 });
    assert.equal(raised.fullscreen, false);
    const { centeredRect } = require('../multi-monitor.cjs');
    assert.deepEqual(raised.bounds, centeredRect(raised.attentionWorkArea, raised.bounds));
    assert.equal(raised.banners.length, raised.displayCount - 1, 'One banner per extra display, zero on a single display');
    let bannerCDP;
    if (raised.banners.length) {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const bannerPage = pages.find((page) => page.url === 'app://custom-pomodoro/banner.html?kind=focus-done');
      assert.ok(bannerPage, 'The static banner page must load');
      bannerCDP = await connect(bannerPage.webSocketDebuggerUrl);
      try {
        const bannerInfo = (await bannerCDP.send('Runtime.evaluate', { returnByValue: true, expression: `({
          text: document.querySelector('button').textContent, bridge: Object.keys(window.banner), frozen: Object.isFrozen(window.banner),
          desktop: typeof window.desktop, node: typeof window.require, scripts: document.scripts.length,
          animation: getComputedStyle(document.querySelector('button')).animationDuration
        })` })).result.value;
        assert.deepEqual(bannerInfo, { text: 'Break time · click to open', bridge: ['open'], frozen: true,
          desktop: 'undefined', node: 'undefined', scripts: 1, animation: '2.4s' });
        await bannerCDP.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        assert.equal((await bannerCDP.send('Runtime.evaluate', { returnByValue: true,
          expression: 'getComputedStyle(document.querySelector("button")).animationName' })).result.value, 'none');
      } finally { bannerCDP.socket.close(); }
    }
    await settle(3500); // Sample after the single pulse has ended.
    const bannerUsage = processUsage(child.pid);
    await evaluate('window.desktop.attention("break-over")');
    // User activity can hide or resize this window during the pulse sample.
    // Check the native cooldown decision rather than comparing the entire desktop snapshot.
    assert.equal((await diagnostics()).attention.lastAcceptedAt, acceptedAttention.lastAcceptedAt, 'An immediate repeat must be rate limited');
    await evaluate('window.desktop.release()');
    const released = await waitFor('The released window', async () => {
      const state = await nativeState();
      return !state.alwaysOnTop && !state.allWorkspaces && !state.attentionActive && !state.bounceActive && state.banners.length === 0 ? state : false;
    }, { timeoutMs: 10000 });
    await evaluate('window.desktop.attention("break-over")');
    assert.equal((await diagnostics()).attention.lastAcceptedAt, acceptedAttention.lastAcceptedAt, 'Release must not bypass the forty-five-second cooldown');
    await settle(3000);
    const releasedUsage = await waitFor('The app process count to return to baseline after destroying banners', () => {
      const usage = processUsage(child.pid);
      return usage.count === idleUsage.count ? usage : false;
    }, { timeoutMs: 15000 });
    console.log(`Resource measurements (ps RSS and %CPU; CPU is the ps lifetime average): ${JSON.stringify({
      simulatedExtraDisplay: raised.simulatedDisplay, simulatedSingleDisplay: raised.simulatedSingleDisplay, displayCount: raised.displayCount,
      bannersShown: raised.banners.length, idle: idleUsage, showing: bannerUsage, released: releasedUsage,
    })}`);
    if (raised.banners.length) {
      step('Checking a real banner click');
      await waitFor('The main-process attention cooldown', async () => (await diagnostics()).cooldownRemainingMs === 0);
      await evaluate('window.desktop.attention("break-over")');
      const nextAttention = await diagnostics();
      assert.ok(nextAttention.attention.lastAcceptedAt > acceptedAttention.lastAcceptedAt, `The next reminder must be accepted: ${JSON.stringify(nextAttention)}`);
      const clickable = await waitFor('The next segment banner', async () => {
        const state = await nativeState();
        return bannersReady(state) ? state : false;
      });
      if (!clickable.banners.length) {
        console.log('The extra display disconnected; the accepted reminder correctly has no banner.');
      } else {
        const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
        const bannerPage = pages.find((page) => page.url === 'app://custom-pomodoro/banner.html?kind=break-over');
        assert.ok(bannerPage, 'The accepted reminder must expose its banner page');
        const clickCDP = await connect(bannerPage.webSocketDebuggerUrl);
        try {
          assert.equal((await clickCDP.send('Runtime.evaluate', { returnByValue: true,
            expression: 'document.querySelector("button").textContent' })).result.value, 'Back to focus · click to open');
          await clickCDP.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 40, y: 32, button: 'left', clickCount: 1 });
          // The renderer can be destroyed before the release command replies.
          void clickCDP.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 40, y: 32, button: 'left', clickCount: 1 }).catch(() => {});
          await waitFor('Clicking the banner to destroy every banner', async () => {
            const state = await nativeState();
            return state.visible && state.banners.length === 0 && clickable.banners.some((banner) =>
              Object.entries(centeredRect(banner.workArea, state.bounds)).every(([key, value]) => state.bounds[key] === value));
          });
        } finally { clickCDP.socket.close(); }
      }
      await evaluate('window.desktop.release()');
    }
    step('Checking native floating timer, shared state and follower leadership');
    const floatingPages = async () => (await (await fetch(`http://127.0.0.1:${port}/json`)).json())
      .filter(page => page.url === 'app://custom-pomodoro/?mini=1');
    const pipButton = 'button[aria-label="Floating timer"]';
    await evaluate(`document.querySelector('${pipButton}').click()`);
    await waitFor('The native mini window', async () => (await nativeState()).floating?.visible);
    await evaluate('window.desktop.floatTimer(true)', true);
    assert.equal((await floatingPages()).length, 1, 'Opening twice must reuse one mini window');
    let miniCDP;
    const miniEvaluate = async (expression) => {
      const result = await miniCDP.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    try {
      miniCDP = await connect((await floatingPages())[0].webSocketDebuggerUrl);
      await waitFor('Mini timer controls', () => miniEvaluate('!!document.querySelector(".mini-digits")'));
      assert.deepEqual(await miniEvaluate('Object.keys(window.desktop).sort()'), ['floatTimer', 'mini', 'showMain', 'timerControl']);
      assert.equal(await miniEvaluate('typeof window.require'), 'undefined');
      await writeFile(path.join(base, 'dist', 'job16-mini.png'), Buffer.from((await miniCDP.send('Page.captureScreenshot')).data, 'base64'));
      const locks = await miniEvaluate('navigator.locks.query()');
      assert.equal(locks.held.filter(lock => lock.name === 'custom-pomodoro-leader').length, 1);
      assert.equal(locks.pending.filter(lock => lock.name === 'custom-pomodoro-leader').length, 0, 'Mini must never request leadership');
      assert.equal(await miniEvaluate('document.querySelector(".mini-digits").textContent'), '25:00');
      await miniEvaluate('document.querySelector("button[aria-label=Start]").click()');
      await waitFor('Main timer started by the mini', () => evaluate('!!document.querySelector("button[aria-label^=Pause]")'));
      await waitFor('Mini timer running from the shared store', () => miniEvaluate('!!document.querySelector("button[aria-label=Pause]")'));
      assert.ok((await nativeState()).native.pending, 'Main arms the native alarm');
      await miniEvaluate('document.querySelector("button[aria-label=Pause]").click()');
      await waitFor('Paused main timer', () => evaluate('!!document.querySelector("button[aria-label^=Start]")'));
      await waitFor('Paused mini timer', () => miniEvaluate('!!document.querySelector("button[aria-label=Start]")'));
      assert.equal((await nativeState()).native.pending, null);
      await miniEvaluate('document.querySelector("button[aria-label=Skip]").click()');
      await waitFor('Short break shared to mini', () => miniEvaluate('document.querySelector(".mini-segment").textContent === "Short break"'));
      await evaluate('window.__desktopSmokeClose()');
      await waitFor('Hidden dashboard', async () => !(await nativeState()).visible);
      await miniEvaluate('document.querySelector(".mini-digits").click()');
      await waitFor('Mini digits raise dashboard', async () => (await nativeState()).visible);
      // Closing through the dashboard button destroys the window, not just hides it.
      await evaluate(`document.querySelector('${pipButton}').click()`);
      await waitFor('Mini window destroyed', async () => !(await nativeState()).floating && (await floatingPages()).length === 0);
    } finally { miniCDP?.socket.close(); }
    await evaluate(`document.querySelector('${pipButton}').click()`);
    const reopened = await waitFor('Reopened mini', async () =>
      (await nativeState()).floating?.visible && (await floatingPages())[0]);
    const closingCDP = await connect(reopened.webSocketDebuggerUrl);
    try {
      await waitFor('Mini close control', async () => (await closingCDP.send('Runtime.evaluate', { expression: '!!document.querySelector(".mini-close")', returnByValue: true })).result.value);
      // Closing can destroy the renderer before its evaluate response arrives.
      void closingCDP.send('Runtime.evaluate', { expression: 'document.querySelector(".mini-close").click()' }).catch(() => {});
      await waitFor('Mini close destroys its renderer', async () => !(await nativeState()).floating && (await floatingPages()).length === 0);
    } finally { closingCDP.socket.close(); }
    await waitFor('No floating renderer left in the process tree', () => processUsage(child.pid).count === idleUsage.count);
    await evaluate('document.querySelectorAll(".tabs button")[0].click(); document.querySelector("button[aria-label^=Reset]").click()');
    await evaluate('window.desktop.preventSleep(true)');
    await waitFor('Native sleep blocker enabled', async () => (await nativeState()).native.powerActive);
    await evaluate('window.desktop.preventSleep(false)');
    await waitFor('Native sleep blocker released', async () => !(await nativeState()).native.powerActive);
    step('Checking short-window takeover layout');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 540, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.querySelector('button[aria-label="Settings (S)"]').click()`);
    await evaluate(`([...document.querySelectorAll('.drawer nav .tab')].find(b => b.textContent.includes('Focus Timer')))?.click()`);
    const alertCopy = await evaluate('document.body.textContent');
    assert.ok(alertCopy.includes('Mac app alarms: on (rings even when the window is closed)'));
    assert.ok(!alertCopy.includes('companion only runs at localhost'));
    await evaluate(`document.querySelector('button[aria-label^="Close settings"]').click()`);
    // A short native alarm deadline lets the real timer render its takeover without waiting a full session.
    await evaluate(`(async () => {
      const req = indexedDB.open('custom-pomodoro', 1);
      await new Promise((resolve, reject) => { req.onsuccess = resolve; req.onerror = reject; });
      const db = req.result;
      const read = key => new Promise(resolve => { const r = db.transaction('kv').objectStore('kv').get(key); r.onsuccess = () => resolve(r.result); });
      const [state, prefs] = await Promise.all([read('timer'), read('settings')]);
      const quiet = { ...prefs, timer: { ...prefs?.timer, alertSound: 'none', speak: false, notify: false, bringToFront: false, autoRun: 'off' } };
      const next = { ...state, segment: 'focus', segId: 'smoke-short-layout', startedAt: Date.now(), elapsedBefore: 0, creditedUpTo: 0, frozen: true, frozenTotal: 500 };
      const channel = new BroadcastChannel('custom-pomodoro'); channel.postMessage({ type: 'write', entries: [['settings', quiet], ['timer', next]] }); channel.close(); db.close();
    })()`, true);
    await waitFor('Takeover in a short window', () => evaluate('!!document.querySelector(".transition-screen[open]")'));
    const layout = await evaluate(`(() => {
      const box = document.querySelector('.transition-screen').getBoundingClientRect();
      const icon = document.querySelector('.transition-ring').getBoundingClientRect();
      const buttons = [...document.querySelectorAll('.transition-actions button')].map(b => { const r = b.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
      return { top: box.top, bottom: box.bottom, iconTop: icon.top, iconBottom: icon.bottom, buttons };
    })()`);
    assert.ok(layout.iconTop >= layout.top && layout.iconBottom <= layout.bottom, JSON.stringify(layout));
    assert.ok(layout.buttons.every(b => b.top >= layout.top && b.bottom <= layout.bottom), JSON.stringify(layout));
    await writeFile(path.join(base, 'dist', 'job16-takeover-1280x540.png'), Buffer.from((await cdp.send('Page.captureScreenshot')).data, 'base64'));
    await evaluate(`document.querySelectorAll('.transition-actions button')[1].click()`);
    await waitFor('Takeover dismissed', () => evaluate('!document.querySelector(".transition-screen")'));
    await evaluate(`document.querySelector('button[aria-label^="Pause"]')?.click()`);
    await evaluate(`document.querySelector('button[aria-label^="Reset"]').click()`);
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    step('Checking YouTube frame filtering');
    const watch = 'https://www.youtube.com/watch?v=jfKfPfyJRdk';
    const embed = 'https://www.youtube.com/embed/jfKfPfyJRdk';
    const bypasses = [
      `${embed}?playlist=dQw4w9WgXcQ`,
      `${embed}?list=PLabcdefghij&listType=playlist`,
      `${embed}?enablejsapi=1`,
      'https://www.youtube.com/embed/live_stream?channel=UCV03SRZXJEz-hchIAogeJOg&playlist=dQw4w9WgXcQ',
    ];
    const testFrames = [['smoke-watch', watch], ['smoke-embed', embed], ...bypasses.map((url, index) => [`smoke-bypass-${index}`, url])];
    await cdp.send('Network.enable');
    await evaluate(`(() => {
      for (const [id, url] of ${JSON.stringify(testFrames)}) {
        const frame = document.createElement('iframe'); frame.id = id; frame.src = url; document.body.append(frame);
      }
    })()`);
    const frameDecisions = await waitFor('All six iframe requests at the native filter', async () => {
      const { frames } = await nativeState();
      return testFrames.every(([, url]) => frames.some((frame) => frame.url === url)) ? frames : false;
    }, { timeoutMs: 15000 });
    assert.equal(frameDecisions.find((frame) => frame.url === watch).blocked, true, 'A YouTube watch iframe must be blocked');
    assert.equal(frameDecisions.find((frame) => frame.url === embed).blocked, false, 'The allowlisted embed must pass the native filter');
    for (const url of bypasses) assert.equal(frameDecisions.find((frame) => frame.url === url).blocked, true, url);
    await waitFor('The blocked watch request failure', () => {
      const request = cdp.events.find((event) => event.method === 'Network.requestWillBeSent' && event.params.request.url === watch);
      return request && cdp.events.find((event) => event.method === 'Network.loadingFailed' && event.params.requestId === request.params.requestId && /BLOCKED_BY_CLIENT/.test(event.params.errorText));
    }, { timeoutMs: 10000 });
    await evaluate(`for (const [id] of ${JSON.stringify(testFrames)}) document.getElementById(id).remove()`);
    step('Checking that closing hides the window and the timer keeps ticking');
    await evaluate('document.activeElement?.blur?.()');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
    await waitFor('The running timer', () => evaluate('!!document.querySelector(\'button[aria-label^="Pause"]\')'), { timeoutMs: 10000 });
    // Use the smoke-only trusted IPC because production fuses disable Node's inspector.
    // Page.close/window.close bypass Electron's cancellable native close event.
    await evaluate('window.__desktopSmokeClose()');
    await waitFor('The hidden native window', async () => !(await nativeState()).visible, { timeoutMs: 10000 });
    const title = await evaluate('document.title');
    const nextTitle = await waitFor('The hidden timer tick', async () => {
      assert.equal((await nativeState()).visible, false, 'The timer tick must be observed while the native window is hidden');
      const next = await evaluate('document.title');
      return next !== title && /\d+:\d+/.test(next) ? next : false;
    }, { timeoutMs: 10000 });
    await require('./parking-smoke.cjs').checkParking({ base, profile, port, evaluate, nativeState, freePort, step });
    alive();
    assert.equal(await evaluate('location.href'), 'app://custom-pomodoro/');
    console.log(`Smoke check passed. Native alarms raise the app while the renderer is paused; mini controls share one leader and closing destroys their renderer; sleep blocking and short-window takeover pass. The bridge and native attention work, unsafe paths and YouTube watch frames are blocked, the allowed embed passes the filter, and closing keeps the app alive with its timer ticking (${title} → ${nextTitle}).`);
    console.log(`Native attention: ${JSON.stringify(raised)}; after release: ${JSON.stringify(released)}.`);
  } catch (error) {
    console.error(`Smoke check failed while ${stage}${watchdogExpired ? ' (the three-minute overall deadline expired)' : ''}.`);
    if (cdp) {
      try {
        const snapshot = await cdp.send('Runtime.evaluate', {
          expression: '(async () => ({ state: window.__desktopSmokeState(), diagnostics: await window.__desktopSmokeDiagnostics() }))()',
          returnByValue: true, awaitPromise: true,
        });
        console.error('Native state at failure:', JSON.stringify(snapshot.result.value));
      } catch { /* Keep the original failure if the app already exited. */ }
    }
    if (cdp) console.error(`Recent renderer events: ${JSON.stringify(cdp.events.slice(-8))}`);
    if (logs) console.error(logs);
    throw error;
  } finally {
    clearTimeout(watchdog);
    cdp?.socket.close();
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      const force = setTimeout(() => child.kill('SIGKILL'), 5000);
      try { await exited; } finally { clearTimeout(force); }
    }
    await rm(profile, { recursive: true, force: true });
  }
}
main().then(() => require('./restore-smoke.cjs').checkRestore()).catch((error) => { console.error(error); process.exitCode = 1; });
