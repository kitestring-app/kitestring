const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');
const { once } = require('node:events');
const { connect, waitFor } = require('./cdp.cjs');
async function checkParking({ base, profile, port, evaluate, nativeState, freePort, step }) {
  step('Checking parking capture, trusted IPC, timer continuity and focus return');
  assert.equal((await nativeState()).parking.registered, true, 'The global shortcut must register');
  assert.deepEqual(await evaluate('window.desktop.parkingStatus()', true), { registered: true });
  const usage = require('node:child_process').execFileSync;
  const initialHelpers = () => usage('ps', ['-axo', 'ppid=,comm='], { encoding: 'utf8' }).split('\n').filter(line => line.includes('Kitestring Helper')).length;
  const helperCount = initialHelpers();
  const captures = async () => (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter(page => page.url === 'app://custom-pomodoro/park.html');
  const open = async () => {
    await evaluate('window.__desktopSmokePark()');
    await waitFor('A focused native capture field', async () => {
      const state = await nativeState();
      return state.parking.capture?.visible && state.parking.capture?.focused;
    });
    const state = await nativeState();
    const capture = state.parking.capture;
    assert.equal(capture.fullscreen, false); assert.equal(capture.alwaysOnTop, true); assert.equal(capture.allWorkspaces, true);
    assert.equal(capture.bounds.width, 520); assert.equal(capture.bounds.height, 64);
    const socket = await connect((await captures())[0].webSocketDebuggerUrl);
    await waitFor('The capture page input', async () => (await socket.send('Runtime.evaluate', { expression: 'document.activeElement?.id === "thought"', returnByValue: true })).result.value);
    assert.deepEqual((await socket.send('Runtime.evaluate', { expression: '({ keys: Object.keys(window.parking).sort(), desktop: typeof window.desktop, node: typeof window.require })', returnByValue: true })).result.value,
      { keys: ['close', 'save'], desktop: 'undefined', node: 'undefined' });
    return socket;
  };
  let capture;
  // A second app that we launch ourselves proves native focus return without
  // inspecting or driving any of the user's apps, browser tabs or profiles.
  const peerPort = await freePort();
  const peerScript = path.join(profile, 'focus-peer.cjs');
  const peerPreload = path.join(profile, 'focus-peer-preload.cjs');
  const peerExecutable = path.join(base, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
  assert.ok(require('node:fs').existsSync(peerExecutable), 'The focus test needs the existing local Electron binary');
  await writeFile(peerPreload, `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('peerFocus',()=>ipcRenderer.invoke('peer:focus'));contextBridge.exposeInMainWorld('peerState',()=>ipcRenderer.invoke('peer:state'));`);
  await writeFile(peerScript, `require(${JSON.stringify(path.join(__dirname, 'focus-peer.cjs'))}).startFocusPeer(require('electron'), ${JSON.stringify(peerPreload)}).catch(error => { console.error(error); process.exitCode = 1; });`);
  const peer = spawn(peerExecutable, [peerScript, `--user-data-dir=${path.join(profile, 'peer-data')}`, `--remote-debugging-port=${peerPort}`, '--remote-debugging-address=127.0.0.1'], { stdio: 'ignore' });
  let peerCDP;
  try {
    const page = await waitFor('The separate focus test app', async () => (await (await fetch(`http://127.0.0.1:${peerPort}/json`)).json()).find(page => page.url.startsWith('data:text/html,')));
    peerCDP = await connect(page.webSocketDebuggerUrl);
    const peerEval = async expression => (await peerCDP.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
    const peerFocused = async () => {
      const state = await peerEval('window.peerState()');
      return state.active && state.focused;
    };
    const focusPeer = async () => {
      await peerEval('window.peerFocus()');
      await waitFor('Native focus on the test app', peerFocused);
    };
    // Establish a known native foreground app before the first capture too.
    // Previously that capture raced whatever app the user was working in.
    await focusPeer();
    capture = await open();
    try {
      assert.equal((await nativeState()).visible, false, 'Capture must not raise a hidden dashboard');
      assert.equal(await evaluate('!!document.querySelector("button[aria-label^=Pause]")'), true);
      await capture.send('Input.insertText', { text: 'Review this after focus' });
      await writeFile(path.join(base, 'dist', 'job20-native-capture.png'), Buffer.from((await capture.send('Page.captureScreenshot')).data, 'base64'));
      // Saving destroys the sender; it may close before the input acknowledgement arrives.
      void capture.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 }).catch(() => {});
      await waitFor('Capture destroyed and text delivered while the timer keeps running', async () => {
        const state = await nativeState();
        return !state.parking.capture && (await captures()).length === 0 && evaluate('!!document.querySelector("button[aria-label^=Pause]") && document.body.textContent.includes("1 parked")');
      });
      assert.equal((await nativeState()).visible, false);
      assert.equal(await evaluate('document.body.textContent.includes("Review this after focus")'), false);
    } finally { capture.socket.close(); }
    for (const visible of [false, true]) {
      if (visible) { await evaluate('window.__desktopSmokeFocus()'); await waitFor('Visible dashboard', async () => (await nativeState()).visible); }
      await focusPeer();
      capture = await open();
      try {
        assert.equal((await nativeState()).visible, visible, 'Capture must preserve main window visibility');
        assert.equal((await nativeState()).focused, false, 'The main window must not take focus');
        void capture.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => {});
        await waitFor('Escape destroys capture', async () => !(await nativeState()).parking.capture && !(await captures()).length);
        await waitFor('Keyboard focus returned to the previous app', peerFocused);
        assert.equal((await nativeState()).visible, visible, 'Closing capture must not hide the main window');
      } finally { capture.socket.close(); }
      await focusPeer(); capture = await open();
      try {
        await capture.send('Input.insertText', { text: visible ? 'Visible dashboard idea' : 'Hidden dashboard idea' });
        void capture.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 }).catch(() => {});
        await waitFor('Enter destroys capture', async () => !(await nativeState()).parking.capture);
        await waitFor('Saving returns focus to the previous app', peerFocused);
        assert.equal((await nativeState()).visible, visible);
      } finally { capture.socket.close(); }
    }
    await focusPeer(); capture = await open();
    try { await focusPeer(); await waitFor('Blur destroys capture', async () => !(await nativeState()).parking.capture); }
    finally { capture.socket.close(); }
    await waitFor('Capture renderers released', () => initialHelpers() === helperCount);
    await evaluate('document.querySelector("[data-panel=notes]").click()');
    await waitFor('IPC text visible in Notepad review', () => evaluate('document.querySelector(".parking-lot")?.textContent.includes("Review this after focus")'));
    assert.equal(await evaluate('!!document.querySelector("button[aria-label^=Pause]")'), true);
    await evaluate(`document.querySelector('button[aria-label^="Close notepad"]').click()`);
    console.log('Parking capture passed: shortcut registered, Enter delivered text without pausing, Escape and blur destroyed capture, and focus returned to a separate test app with the dashboard both hidden and visible.');
  } catch (error) {
    try {
      if (peerCDP) console.error('Native peer state at failure:', JSON.stringify((await peerCDP.send('Runtime.evaluate', {
        expression: 'window.peerState()', returnByValue: true, awaitPromise: true })).result.value));
    } catch { /* Keep the original failure if the fixture already exited. */ }
    throw error;
  } finally {
    peerCDP?.socket.close();
    if (peer.exitCode === null) { const exited = once(peer, 'exit'); peer.kill('SIGTERM'); const force = setTimeout(() => peer.kill('SIGKILL'), 5000); try { await exited; } finally { clearTimeout(force); } }
  }
}
module.exports = { checkParking };
