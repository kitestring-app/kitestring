const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createFloatingControls, registerFloatingControls, DEFAULT_FLOATING_PREFERENCES } = require('../floating-controls.cjs');
function fixture() {
  const calls = [], notifications = [];
  const tray = { setTitle: value => calls.push(['title', value]), setToolTip: value => calls.push(['tooltip', value]) };
  const floating = { setOnTop: value => calls.push(['top', value]), open: value => { calls.push(['open', value]); return value; }, trusted: event => event === 'mini', send: (...args) => calls.push(['mini', ...args]) };
  const controls = createFloatingControls({ floating, tray: () => tray, notify: value => notifications.push(value) });
  const ipc = new EventEmitter(); const handlers = {};
  ipc.handle = (channel, fn) => { handlers[channel] = fn; };
  registerFloatingControls(ipc, { trustedMain: e => e === 'main', floating, controls, sendMain: (...args) => calls.push(['main', ...args]) });
  return { calls, notifications, controls, ipc, handlers };
}
test('tray contains exactly the three checkboxes, checked from settings and mirrored live', () => {
  const h = fixture();
  assert.deepEqual(h.controls.menu().map(item => [item.label, item.type, item.checked]), [
    ['Floating timer', 'checkbox', false], ['Keep floating timer on top', 'checkbox', true], ['Show time in menu bar', 'checkbox', true],
  ]);
  assert.ok(h.controls.menu().every(item => !item.enabled));
  h.controls.sync({ floatingTimer: true, floatingOnTop: false, menuBarTime: false, showMenuBar: true });
  assert.deepEqual(h.controls.menu().map(item => item.checked), [true, false, false]);
  assert.ok(h.controls.menu().every(item => item.enabled));
  h.controls.menu()[1].click({ checked: true });
  assert.deepEqual(h.notifications.at(-1), { floatingTimer: true, floatingOnTop: true, menuBarTime: false, showMenuBar: true });
  h.controls.opened(false);
  assert.equal(h.notifications.at(-1).floatingTimer, false);
  h.controls.setStatus('25:00');
  assert.deepEqual(h.calls.slice(-2), [['title', ''], ['tooltip', '25:00']]);
  h.controls.menu()[2].click({ checked: true });
  assert.deepEqual(h.calls.slice(-2), [['title', '25:00'], ['tooltip', '25:00']]);
});
test('preferences accept only exact boolean fields from the trusted dashboard', () => {
  const h = fixture(), handler = h.handlers['desktop:floating-preferences'];
  for (const sender of ['mini', 'foreign']) assert.equal(handler(sender, DEFAULT_FLOATING_PREFERENCES), false);
  for (const value of [null, true, {}, [], { ...DEFAULT_FLOATING_PREFERENCES, menuBarTime: 'true' }, { ...DEFAULT_FLOATING_PREFERENCES, extra: true }]) assert.equal(handler('main', value), false);
  assert.deepEqual(h.calls, []);
  assert.equal(handler('main', DEFAULT_FLOATING_PREFERENCES), true);
});
test('audio relay validates source, shape and ranges without creating audio in mini', () => {
  const h = fixture();
  for (const value of [null, {}, 'toggle', { action: 'volume', value: NaN }, { action: 'volume', value: -1 }, { action: 'volume', value: 2 }, { action: 'mute', value: 1 }, { action: 'play' }]) h.ipc.emit('desktop:audio-control', 'mini', value);
  h.ipc.emit('desktop:audio-control', 'main', { action: 'mute' });
  const state = { volume: 0.4, muted: false, playing: true, available: true };
  h.ipc.emit('desktop:audio-state', 'mini', state);
  h.ipc.emit('desktop:audio-state', 'main', { ...state, playing: 'yes' });
  h.ipc.emit('desktop:audio-request', 'foreign');
  assert.deepEqual(h.calls, []);
  for (const command of [{ action: 'volume', value: 0 }, { action: 'volume', value: 1 }, { action: 'mute' }, { action: 'toggle' }]) {
    h.ipc.emit('desktop:audio-control', 'mini', command);
    assert.deepEqual(h.calls.at(-1), ['main', 'desktop:audio-action', command]);
  }
  h.ipc.emit('desktop:audio-state', 'main', state);
  assert.deepEqual(h.calls.at(-1), ['mini', 'desktop:audio-state', state]);
  h.ipc.emit('desktop:audio-request', 'mini');
  assert.deepEqual(h.calls.at(-1), ['main', 'desktop:audio-request']);
});

test('hidden menu bar disables time control without losing its saved value', () => {
  const h = fixture();
  h.controls.sync({ ...DEFAULT_FLOATING_PREFERENCES, showMenuBar: false });
  const item = h.controls.menu()[2];
  assert.equal(item.enabled, false);
  item.click({ checked: false });
  assert.equal(h.controls.snapshot().menuBarTime, true);
  h.controls.appMenuItem().click({ checked: true });
  assert.equal(h.controls.menu()[2].enabled, true);
  assert.equal(h.notifications.at(-1).showMenuBar, true);
});
test('relaunch restores hidden state before the renderer connects and app menu remains a way back', () => {
  const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
  const path = require('node:path');
  const directory = mkdtempSync(path.join(require('node:os').tmpdir(), 'menu-bar-'));
  const stateFile = path.join(directory, 'menu-bar.json');
  const visibility = [], notifications = [];
  const options = { stateFile, floating: { setOnTop() {}, open: value => value }, tray: () => null,
    notify: value => notifications.push(value), setMenuBarVisible: value => visibility.push(value) };
  try {
    const first = createFloatingControls(options);
    first.sync(DEFAULT_FLOATING_PREFERENCES);
    first.appMenuItem().click({ checked: false });
    const relaunched = createFloatingControls(options);
    relaunched.restoreMenuBar();
    assert.equal(visibility.at(-1), false);
    assert.equal(relaunched.appMenuItem().checked, false);
    relaunched.appMenuItem().click({ checked: true });
    assert.equal(visibility.at(-1), true);
    // A startup menu click wins over the renderer's still-hidden setting.
    relaunched.sync({ ...DEFAULT_FLOATING_PREFERENCES, showMenuBar: false });
    assert.equal(relaunched.snapshot().showMenuBar, true);
    assert.equal(notifications.at(-1).showMenuBar, true);
    assert.equal(createFloatingControls(options).snapshot().showMenuBar, true);
    writeFileSync(stateFile, '{broken');
    assert.equal(createFloatingControls(options).snapshot().showMenuBar, true);
    writeFileSync(stateFile, JSON.stringify({ showMenuBar: 'false' }));
    assert.equal(createFloatingControls(options).snapshot().showMenuBar, true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
