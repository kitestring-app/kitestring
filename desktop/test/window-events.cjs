const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createWindowEvents, registerWindowEvents, validWindowEvent } = require('../window-events.cjs');

function fixture({ fullScreen = false, visible = true, minimized = false, transitioning = false, destroyed = false } = {}) {
  const calls = [];
  const win = {
    isDestroyed: () => destroyed, isFullScreen: () => fullScreen, isVisible: () => visible, isMinimized: () => minimized,
    minimize: () => { calls.push('minimize'); minimized = true; },
    restore: () => { calls.push('restore'); minimized = false; },
    showInactive: () => { calls.push('showInactive'); visible = true; },
    moveTop: () => calls.push('moveTop'),
  };
  const controls = { change: patch => { calls.push(['floating', patch.floatingTimer]); return patch.floatingTimer; } };
  const fullscreen = { isTransitioning: () => transitioning, cancelHide: () => calls.push('cancelHide') };
  const showWorkspaces = { join: () => calls.push('join') };
  const events = createWindowEvents({ mainWindow: () => win, floatingControls: () => controls, fullscreen: () => fullscreen, showWorkspaces });
  return { calls, events };
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

test('floating opens the floating timer, then minimises the dashboard', () => {
  let h = fixture();
  assert.equal(h.events.run('floating'), true);
  assert.deepEqual(h.calls, [['floating', true], 'minimize']);
  // In full screen the floating timer still opens; the full-screen Space stays.
  h = fixture({ fullScreen: true });
  h.events.run('floating');
  assert.deepEqual(h.calls, [['floating', true]]);
});

test('restore brings the dashboard back without focusing it and keeps the floating timer', () => {
  let h = fixture({ minimized: true });
  assert.equal(h.events.run('restore'), true);
  assert.deepEqual(h.calls, ['cancelHide', 'join', 'restore', 'moveTop']);
  h = fixture({ visible: false });
  h.events.run('restore');
  assert.deepEqual(h.calls, ['cancelHide', 'join', 'showInactive', 'moveTop']);
});

test('full closes the floating timer and restores the dashboard', () => {
  const h = fixture({ minimized: true });
  assert.equal(h.events.run('full'), true);
  assert.deepEqual(h.calls, [['floating', false], 'cancelHide', 'join', 'restore', 'moveTop']);
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
