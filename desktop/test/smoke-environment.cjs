const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { bannersReady } = require('../scripts/attention-smoke.cjs');
const { startFocusPeer } = require('../scripts/focus-peer.cjs');

test('the next reminder follows the current display count after an extra display disappears', () => {
  assert.equal(bannersReady({ attentionActive: true, displayCount: 2, banners: [{ shown: true, visible: true }] }), true);
  assert.equal(bannersReady({ attentionActive: true, displayCount: 1, banners: [] }), true);
  assert.equal(bannersReady({ attentionActive: true, displayCount: 2, banners: [] }), false);
  assert.equal(bannersReady({ attentionActive: true, displayCount: 2, banners: [{ shown: false, visible: false }] }), false);
  assert.equal(bannersReady({ attentionActive: false, displayCount: 1, banners: [] }), false);
  assert.equal(bannersReady({ attentionActive: true, displayCount: 1, banners: [{ shown: true, visible: true }] }), false);
});

test('the peer makes a fresh native activation even when a panel borrowed focus from an active app', async () => {
  const app = new EventEmitter(), handlers = new Map(), windows = [];
  let active = false, borrowedFocus = false;
  app.whenReady = () => Promise.resolve();
  app.hide = () => { active = false; app.emit('did-resign-active'); };
  app.show = () => {};
  app.focus = () => {
    // Re-activating an already-active app does not recover borrowed panel focus.
    if (!active) { borrowedFocus = false; active = true; app.emit('did-become-active'); }
  };
  class Window extends EventEmitter {
    constructor() { super(); windows.push(this); }
    loadURL() { this.emit('ready-to-show'); return Promise.resolve(); }
    show() { this.visible = true; this.emit('show'); }
    setVisibleOnAllWorkspaces() {}
    setAlwaysOnTop() {}
    moveTop() {}
    focus() { if (!borrowedFocus) { this.focused = true; this.emit('focus'); } }
    isFocused() { return !!this.focused; }
    isVisible() { return !!this.visible; }
  }
  await startFocusPeer({ app, BrowserWindow: Window, ipcMain: { handle: (name, fn) => handlers.set(name, fn) } }, 'test-preload');
  const focus = handlers.get('peer:focus'), state = handlers.get('peer:state');
  await focus();
  assert.equal(state().active && state().focused, true);
  borrowedFocus = true; windows[0].focused = false;
  await focus();
  assert.equal(borrowedFocus, false);
  assert.equal(state().active && state().focused, true);
  assert.ok(state().events.some(event => event.name === 'inactive'));
});


test('the peer does not try to focus a native window before ready-to-show', async () => {
  const app = new EventEmitter(), handlers = new Map();
  let window, focused = false;
  app.whenReady = () => Promise.resolve();
  app.hide = () => app.emit('did-resign-active');
  app.show = () => {};
  app.focus = () => { focused = true; };
  class Window extends EventEmitter {
    constructor() { super(); window = this; }
    loadURL() { return Promise.resolve(); }
    show() { this.visible = true; this.emit('show'); }
    setVisibleOnAllWorkspaces() {}
    setAlwaysOnTop() {}
    moveTop() {}
    focus() {}
    isFocused() { return focused; }
    isVisible() { return !!this.visible; }
  }
  await startFocusPeer({ app, BrowserWindow: Window, ipcMain: { handle: (name, fn) => handlers.set(name, fn) } }, 'test-preload');
  const pending = handlers.get('peer:focus')();
  await Promise.resolve();
  assert.equal(focused, false);
  window.emit('ready-to-show');
  await pending;
  assert.equal(focused, true);
});


test('the peer waits for native visibility before focusing an unoccluded window', async () => {
  const app = new EventEmitter(), handlers = new Map();
  let window, focused = false;
  app.whenReady = () => Promise.resolve();
  app.hide = () => app.emit('did-resign-active');
  app.show = () => {};
  app.focus = () => { focused = true; };
  class Window extends EventEmitter {
    constructor() { super(); window = this; }
    loadURL() { this.emit('ready-to-show'); return Promise.resolve(); }
    show() {}
    setVisibleOnAllWorkspaces() {}
    setAlwaysOnTop() {}
    moveTop() {}
    focus() {}
    isFocused() { return focused; }
    isVisible() { return !!this.visible; }
  }
  await startFocusPeer({ app, BrowserWindow: Window, ipcMain: { handle: (name, fn) => handlers.set(name, fn) } }, 'test-preload');
  const pending = handlers.get('peer:focus')();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(focused, false);
  window.visible = true; window.emit('show');
  await pending;
  assert.equal(focused, true);
});


test('an occluded banner that painted and was shown is ready for renderer checks', () => {
  assert.equal(bannersReady({ attentionActive: true, displayCount: 2,
    banners: [{ shown: true, visible: false }] }), true);
});
