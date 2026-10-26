const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createFloating, fitBounds, MINI_URL } = require('../floating.cjs');

function fixture(saved = {}, options = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pomodoro-float-'));
  const stateFile = path.join(dir, 'positions.json');
  writeFileSync(stateFile, JSON.stringify(saved));
  const created = [], changes = [];
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options;
      this.bounds = Object.fromEntries(['x', 'y', 'width', 'height'].map(k => [k, options[k]]));
      this.webContents = new EventEmitter();
      this.webContents.mainFrame = {};
      this.webContents.setWindowOpenHandler = handler => { this.openHandler = handler; };
      created.push(this);
    }
    setVibrancy(value) { this.vibrancy = value; }
    setBackgroundColor(value) { this.backgroundColor = value; }
    setAlwaysOnTop(...args) { this.top = args; }
    setVisibleOnAllWorkspaces(...args) { this.workspaces = args; }
    loadURL(url) { this.webContents.mainFrame.url = url; return Promise.resolve(); }
    setBounds(bounds) { this.bounds = bounds; }
    getBounds() { return this.bounds; }
    isDestroyed() { return !!this.destroyed; }
    isVisible() { return !!this.visible; }
    showInactive() { this.visible = true; }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  const screen = new EventEmitter();
  screen.display = { id: 1, workArea: { x: 0, y: 25, width: 1440, height: 875 } };
  screen.getCursorScreenPoint = () => ({ x: 10, y: 40 });
  screen.getDisplayNearestPoint = screen.getDisplayMatching = () => screen.display;
  const floating = createFloating({ BrowserWindow: Window, screen, stateFile, ...options, onChange: value => changes.push(value) });
  return { floating, screen, created, changes, saved: () => JSON.parse(readFileSync(stateFile, 'utf8')),
    cleanup() { floating.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('bounds clamp to a display work area, including offscreen saved positions', () => {
  assert.deepEqual(fitBounds({ x: 5000, y: -5000, width: 300, height: 180 }, { x: -1920, y: 30, width: 1920, height: 1080 }),
    { x: -300, y: 30, width: 300, height: 180 });
  assert.deepEqual(fitBounds(null, { x: 0, y: 0, width: 200, height: 100 }), { x: 0, y: 0, width: 200, height: 100 });
});

test('one hardened floating window is destroyed on close and removes every display listener', () => {
  const h = fixture();
  try {
    assert.equal(h.floating.snapshot(), null);
    h.floating.open(true); h.floating.open(true);
    assert.equal(h.created.length, 1);
    const w = h.created[0];
    for (const key of ['roundedCorners', 'resizable', 'movable']) assert.equal(w.options[key], true);
    assert.equal(w.options.frame, false);
    for (const key of ['sandbox', 'contextIsolation', 'webSecurity']) assert.equal(w.options.webPreferences[key], true);
    assert.equal(w.options.webPreferences.nodeIntegration, false);
    assert.deepEqual(w.top, [true, 'floating']);
    assert.deepEqual(w.workspaces, [true, { visibleOnFullScreen: true, skipTransformProcessType: true }]);
    assert.equal(w.webContents.mainFrame.url, MINI_URL);
    w.emit('ready-to-show');
    assert.equal(h.floating.snapshot().visible, true);
    h.floating.open(false);
    assert.equal(w.isDestroyed(), true);
    assert.equal(h.floating.snapshot(), null);
    assert.deepEqual(h.screen.eventNames(), []);
    assert.deepEqual(h.changes, [true, false]);
    h.floating.open(true);
    assert.equal(h.created.length, 2);
  } finally { h.cleanup(); }
});

test('positions are remembered separately per display and clamped after a display change', () => {
  const h = fixture();
  try {
    h.floating.open(true);
    const w = h.created[0];
    w.bounds = { x: 80, y: 70, width: 300, height: 180 }; w.emit('move');
    h.screen.display = { id: 2, workArea: { x: -1920, y: 25, width: 1920, height: 1055 } };
    w.bounds = { x: -800, y: 60, width: 280, height: 170 }; w.emit('move');
    h.floating.close();
    assert.equal(h.saved()['1'].x, 80);
    assert.equal(h.saved()['2'].x, -800);
    h.floating.open(true);
    assert.deepEqual(h.created[1].bounds, h.saved()['2']);
    h.screen.display.workArea = { x: -500, y: 0, width: 500, height: 400 };
    h.screen.emit('display-metrics-changed');
    assert.equal(h.created[1].bounds.x, -500);
  } finally { h.cleanup(); }
});

test('navigation, webviews, popups and forged frames cannot gain mini window trust', () => {
  const h = fixture();
  try {
    h.floating.open(true);
    const w = h.created[0];
    const valid = { sender: w.webContents, senderFrame: w.webContents.mainFrame };
    assert.equal(h.floating.trusted(valid), true);
    assert.equal(h.floating.trusted({ sender: w.webContents, senderFrame: { url: MINI_URL } }), false);
    for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect']) {
      for (const url of ['https://evil.test', 'app://custom-pomodoro/', MINI_URL + '&extra=1']) {
        let prevented = false;
        w.webContents.emit(name, { url, preventDefault() { prevented = true; } });
        assert.equal(prevented, true);
      }
    }
    let prevented = false;
    w.webContents.emit('will-attach-webview', { preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.deepEqual(w.openHandler({ url: 'https://example.org' }), { action: 'deny' });
    w.webContents.emit('render-process-gone');
    assert.equal(w.isDestroyed(), true);
    assert.ok(!h.floating.trusted(valid));
    assert.deepEqual(h.screen.eventNames(), []);
  } finally { h.cleanup(); }
});

test('a late crash event from a destroyed mini cannot close its replacement', () => {
  const h = fixture();
  try {
    h.floating.open(true);
    const old = h.created[0];
    h.floating.close();
    h.floating.open(true);
    const current = h.created[1];
    old.webContents.emit('render-process-gone');
    assert.equal(current.isDestroyed(), false);
    assert.ok(h.floating.snapshot());
  } finally { h.cleanup(); }
});


test('on-top changes apply live without reopening and retain every Space', () => {
  const h = fixture();
  try {
    h.floating.open(true);
    h.floating.setOnTop(false);
    assert.equal(h.created.length, 1);
    assert.deepEqual(h.created[0].top, [false, 'normal']);
    assert.deepEqual(h.created[0].workspaces, [true, { visibleOnFullScreen: false, skipTransformProcessType: true }]);
    assert.equal(h.floating.setOnTop('true'), false);
    h.floating.setOnTop(true);
    assert.deepEqual(h.created[0].top, [true, 'floating']);
    h.floating.close();
    h.floating.setOnTop(false);
    h.floating.open(true);
    assert.deepEqual(h.created[1].top, [false, 'normal']);
  } finally { h.cleanup(); }
});

test('native glass honors OS transparency changes and removes its listener on close', () => {
  const nativeTheme = new EventEmitter();
  nativeTheme.prefersReducedTransparency = false;
  const h = fixture({}, { nativeTheme, platform: 'darwin' });
  try {
    h.floating.open(true);
    const w = h.created[0];
    assert.equal(w.options.transparent, true);
    assert.equal(w.options.vibrancy, 'under-window');
    assert.equal(w.options.visualEffectState, 'active');
    assert.equal(w.options.backgroundColor, '#00000000');
    nativeTheme.prefersReducedTransparency = true;
    nativeTheme.emit('updated');
    assert.equal(w.vibrancy, null);
    assert.equal(w.backgroundColor, '#14121c');
    nativeTheme.prefersReducedTransparency = false;
    nativeTheme.emit('updated');
    assert.equal(w.vibrancy, 'under-window');
    assert.equal(w.backgroundColor, '#00000000');
    h.floating.close();
    assert.equal(nativeTheme.listenerCount('updated'), 0);
    nativeTheme.prefersReducedTransparency = true;
    h.floating.open(true);
    assert.equal(h.created[1].options.backgroundColor, '#14121c');
    assert.equal(h.created[1].options.vibrancy, undefined);
  } finally { h.cleanup(); }
});

test('missing vibrancy capability uses the existing solid color', () => {
  const h = fixture({}, { platform: 'darwin' });
  try {
    h.floating.open(true);
    assert.equal(h.created[0].options.vibrancy, undefined);
    assert.equal(h.created[0].options.backgroundColor, '#14121c');
  } finally { h.cleanup(); }
});
