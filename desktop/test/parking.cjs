const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createParking, cleanText, SHORTCUT, CAPTURE_URL } = require('../parking.cjs');
function fixture(registered = true) {
  const windows = [], delivered = [], unregistered = [];
  let trigger;
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.webContents = new EventEmitter(); this.webContents.mainFrame = {};
      this.webContents.setWindowOpenHandler = fn => { this.openHandler = fn; }; windows.push(this); }
    loadURL(url) { this.webContents.mainFrame.url = url; return Promise.resolve(); }
    setAlwaysOnTop(...args) { this.top = args; }
    setVisibleOnAllWorkspaces(...args) { this.workspaces = args; }
    isDestroyed() { return !!this.destroyed; }
    isVisible() { return !!this.visible; }
    isFocused() { return !!this.focused; }
    isFullScreen() { return false; }
    isAlwaysOnTop() { return this.top[0]; }
    isVisibleOnAllWorkspaces() { return this.workspaces[0]; }
    getBounds() { return Object.fromEntries(['x', 'y', 'width', 'height'].map(k => [k, this.options[k]])); }
    show() { this.visible = true; }
    focus() { this.focused = true; }
    blur() { this.focused = false; this.blurred = true; this.emit('blur'); }
    close() { this.destroyed = true; this.emit('closed'); }
  }
  const parking = createParking({ BrowserWindow: Window,
    screen: { getCursorScreenPoint: () => ({ x: -10, y: 50 }), getDisplayNearestPoint: point => { assert.equal(point.x, -10); return { workArea: { x: -1000, y: 30, width: 1000, height: 800 } }; } },
    globalShortcut: { register: (key, fn) => { assert.equal(key, SHORTCUT); trigger = fn; return registered; }, unregister: key => unregistered.push(key) },
    deliver: text => { delivered.push(text); return true; },
  });
  return { parking, windows, delivered, unregistered, trigger: () => trigger(), event: () => { const w = windows.at(-1); return { sender: w.webContents, senderFrame: w.webContents.mainFrame }; } };
}
test('registers once, opens a hardened nonactivating capture on the cursor display, closes without hiding the app', () => {
  const h = fixture();
  assert.equal(h.parking.register(), true);
  h.trigger(); h.trigger();
  assert.equal(h.windows.length, 1);
  const w = h.windows[0]; w.emit('ready-to-show');
  assert.equal(w.options.type, 'panel'); assert.equal(w.options.frame, false); assert.equal(w.options.fullscreenable, false);
  assert.deepEqual(h.parking.snapshot().capture.bounds, { x: -760, y: 398, width: 520, height: 64 });
  assert.equal(w.options.webPreferences.nodeIntegration, false);
  for (const flag of ['sandbox', 'contextIsolation', 'webSecurity']) assert.equal(w.options.webPreferences[flag], true);
  assert.deepEqual(w.workspaces, [true, { visibleOnFullScreen: true, skipTransformProcessType: true }]);
  assert.equal(h.parking.submit(h.event(), '  read\u0000 later  '), true);
  assert.deepEqual(h.delivered, ['read later']); assert.equal(w.blurred, true); assert.equal(w.destroyed, true);
  assert.equal(h.parking.snapshot().capture, null);
  h.parking.dispose(); assert.deepEqual(h.unregistered, [SHORTCUT]);
});
test('rejects foreign senders, subframes, wrong URLs, non-text and oversized input', () => {
  const h = fixture(); h.parking.open(); const event = h.event();
  for (const bad of [{ ...event, sender: {} }, { ...event, senderFrame: { url: CAPTURE_URL } }, {}]) assert.equal(h.parking.submit(bad, 'secret'), false);
  event.senderFrame.url = 'https://example.invalid'; assert.equal(h.parking.submit(event, 'secret'), false);
  event.senderFrame.url = CAPTURE_URL;
  for (const value of [null, {}, 1, '', '\n\t ', 'x'.repeat(501)]) assert.equal(h.parking.submit(event, value), false);
  assert.deepEqual(h.delivered, []); assert.ok(h.parking.snapshot().capture); h.parking.close();
  assert.equal(cleanText('x'.repeat(500)).length, 500);
});
test('blur and crashes destroy the capture, stale callbacks cannot destroy a replacement, navigation is restricted', () => {
  const h = fixture(); h.parking.open(); const old = h.windows[0];
  let prevented = false; old.webContents.emit('will-navigate', { preventDefault() { prevented = true; } }, 'https://example.invalid');
  assert.equal(prevented, true); assert.deepEqual(old.openHandler(), { action: 'deny' });
  old.emit('blur'); assert.equal(h.parking.snapshot().capture, null);
  h.parking.open(); old.webContents.emit('render-process-gone'); old.emit('blur');
  assert.equal(h.windows[1].isDestroyed(), false);
  h.windows[1].webContents.emit('render-process-gone'); assert.equal(h.parking.snapshot().capture, null);
});
test('reports registration failure and does not unregister a shortcut it never owned', () => {
  const h = fixture(false); assert.equal(h.parking.register(), false); assert.deepEqual(h.parking.status(), { registered: false });
  h.parking.dispose(); assert.deepEqual(h.unregistered, []);
});
test('capture preload exposes only bounded save and close operations', async () => {
  let bridge; const sent = [], invoked = [];
  vm.runInNewContext(readFileSync(path.join(__dirname, '..', 'parking-preload.cjs'), 'utf8'), { require: () => ({
    contextBridge: { exposeInMainWorld: (name, value) => { assert.equal(name, 'parking'); bridge = value; } },
    ipcRenderer: { invoke: (...args) => { invoked.push(args); return Promise.resolve(true); }, send: (...args) => sent.push(args) },
  }) });
  assert.deepEqual(Object.keys(bridge).sort(), ['close', 'save']); assert.equal(Object.isFrozen(bridge), true);
  assert.equal(await bridge.save({}), false); assert.equal(await bridge.save('x'.repeat(501)), false);
  await bridge.save('idea'); bridge.close(); assert.deepEqual(invoked, [['desktop:park-save', 'idea']]); assert.deepEqual(sent, [['desktop:park-close']]);
});
