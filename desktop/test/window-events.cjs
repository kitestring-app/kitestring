const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createWindowEvents, registerWindowEvents, validWindowEvent } = require('../window-events.cjs');
const { createFloatingControls } = require('../floating-controls.cjs');

function fixture({ fullScreen = false, visible = true, minimized = false, transitioning = false, destroyed = false, floatingLoads = true, floatingTimer = false } = {}) {
  const calls = [], saved = [];
  const win = {
    isDestroyed: () => destroyed, isFullScreen: () => fullScreen, isVisible: () => visible, isMinimized: () => minimized,
    minimize: () => { calls.push('minimize'); minimized = true; },
    restore: () => { calls.push('restore'); minimized = false; },
    showInactive: () => { calls.push('showInactive'); visible = true; },
    moveTop: () => calls.push('moveTop'),
  };
  // Like floating.cjs: open() reports the window at once; a failed load closes it later.
  let floatingOpen = false, controls;
  const floating = { setOnTop: () => {}, open: value => {
    if (value === floatingOpen) return floatingOpen;
    floatingOpen = value; calls.push(['floating', value]);
    if (value && !floatingLoads) queueMicrotask(() => { floatingOpen = false; controls.opened(false); });
    return value;
  } };
  controls = createFloatingControls({ floating, tray: () => null, notify: value => saved.push(value.floatingTimer) });
  controls.sync({ floatingTimer, floatingOnTop: true, menuBarTime: true, showMenuBar: true });
  calls.length = 0;
  const fullscreen = { isTransitioning: () => transitioning, cancelHide: () => calls.push('cancelHide') };
  const showWorkspaces = { join: () => calls.push('join') };
  const events = createWindowEvents({ mainWindow: () => win, floatingControls: () => controls, fullscreen: () => fullscreen, showWorkspaces });
  return { calls, saved, events, controls, isFloatingOpen: () => floatingOpen };
}

test('only the four known actions are valid', () => {
  for (const action of ['minimise', 'floating', 'restore', 'full']) assert.equal(validWindowEvent(action), true);
  for (const action of ['nothing', 'close', '', null, 1, {}]) assert.equal(validWindowEvent(action), false);
  assert.equal(fixture().events.run('close'), false);
});

test('minimise hides the dashboard only when macOS allows it', () => {
  let h = fixture();
  assert.equal(h.events.run('minimise'), true);
  assert.deepEqual(h.calls, ['minimize']);
  assert.equal(h.events.run('minimise'), false); // already minimised
  for (const state of [{ fullScreen: true }, { transitioning: true }, { visible: false }]) {
    h = fixture(state);
    assert.equal(h.events.run('minimise'), false);
    assert.deepEqual(h.calls, []);
  }
});

test('floating opens the floating timer, then minimises the dashboard, without saving the setting', () => {
  let h = fixture();
  assert.equal(h.events.run('floating'), true);
  assert.deepEqual(h.calls, [['floating', true], 'minimize']);
  assert.deepEqual(h.saved, []);
  assert.equal(h.controls.snapshot().floatingTimer, true);
  // In full screen the floating timer still opens; the full-screen Space stays.
  h = fixture({ fullScreen: true });
  h.events.run('floating');
  assert.deepEqual(h.calls, [['floating', true]]);
});

test('a floating timer that fails to load brings the dashboard back', async () => {
  const h = fixture({ floatingLoads: false });
  h.events.run('floating');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.calls, [['floating', true], 'minimize', 'cancelHide', 'join', 'restore', 'moveTop']);
  assert.ok(h.saved.every(value => value === false));
});

test('restore brings the dashboard back without focusing it and keeps the floating timer', () => {
  let h = fixture({ minimized: true });
  h.events.run('floating');
  h.calls.length = 0;
  assert.equal(h.events.run('restore'), true);
  assert.deepEqual(h.calls, ['cancelHide', 'join', 'restore', 'moveTop']);
  assert.equal(h.isFloatingOpen(), true);
  h = fixture({ visible: false });
  h.events.run('restore');
  assert.deepEqual(h.calls, ['cancelHide', 'join', 'showInactive', 'moveTop']);
});

test('full closes the floating timer focus opened and restores the dashboard', () => {
  const h = fixture();
  h.events.run('floating');
  h.calls.length = 0;
  assert.equal(h.events.run('full'), true);
  assert.deepEqual(h.calls, [['floating', false], 'cancelHide', 'join', 'restore', 'moveTop']);
  assert.deepEqual(h.saved, []);
});

test('full leaves a floating timer the person turned on, and their setting, alone', () => {
  const h = fixture({ floatingTimer: true, minimized: true });
  h.events.run('floating'); // already open: nothing to take over
  assert.equal(h.events.run('full'), true);
  assert.equal(h.isFloatingOpen(), true);
  assert.deepEqual(h.saved, []);
});

test('other setting changes while focus owns the floating timer never save it as on', () => {
  const h = fixture();
  h.events.run('floating');
  h.controls.menu()[2].click({ checked: false }); // Show time in menu bar
  assert.deepEqual(h.saved, [false]);
  // The renderer echoes its saved "off": the focus-opened timer stays open.
  h.controls.sync({ floatingTimer: false, floatingOnTop: true, menuBarTime: false, showMenuBar: true });
  assert.equal(h.isFloatingOpen(), true);
  h.events.run('full');
  assert.equal(h.isFloatingOpen(), false);
});

test('the person closing the focus-opened floating timer takes it over', () => {
  const h = fixture();
  h.events.run('floating');
  h.controls.change({ floatingTimer: false });
  assert.deepEqual(h.saved, [false]);
  h.calls.length = 0;
  h.events.run('full');
  assert.deepEqual(h.calls, ['cancelHide', 'join', 'restore', 'moveTop']);
});

test('a closed dashboard ignores every action', () => {
  const h = fixture({ destroyed: true });
  for (const action of ['minimise', 'floating', 'restore', 'full']) assert.equal(h.events.run(action), false);
  assert.deepEqual(h.calls, []);
});

test('IPC accepts only the trusted dashboard and valid actions', () => {
  const ran = [];
  const ipc = new EventEmitter();
  registerWindowEvents(ipc, { trustedMain: event => event === 'main', events: { run: action => ran.push(action) } });
  ipc.emit('desktop:window-event', 'mini', 'minimise');
  ipc.emit('desktop:window-event', 'main', 'close');
  ipc.emit('desktop:window-event', 'main', 'full');
  assert.deepEqual(ran, ['full']);
});
