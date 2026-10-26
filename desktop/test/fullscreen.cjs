const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { attachFullscreen } = require('../fullscreen.cjs');

function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const window = new EventEmitter();
  let full = false;
  const calls = [], messages = [], sizes = [];
  Object.assign(window, {
    isDestroyed: () => false, isFullScreen: () => full,
    setFullScreen: next => { calls.push(next); },
    getBounds: () => ({ x: -1600, y: 100, width: 1280, height: 820 }),
    getSize: () => [1280, 820], setSize: (...size) => sizes.push(size),
    webContents: { send: (...message) => messages.push(message), invalidate: () => messages.push(['invalidate']) },
  });
  const controller = attachFullscreen(window);
  const complete = next => { full = next; window.emit(next ? 'enter-full-screen' : 'leave-full-screen'); t.mock.timers.tick(60); };
  return { window, controller, calls, messages, sizes, complete, nativeState: next => { full = next; } };
}

test('start/end messages cover native entry and exit, with exit viewport repair', t => {
  const h = fixture(t);
  for (const next of [true, false]) {
    h.window.emit(next ? 'will-enter-full-screen' : 'will-leave-full-screen');
    assert.deepEqual(h.messages.at(-1), ['desktop:fullscreen-transition', 'start']);
    h.complete(next);
    assert.deepEqual(h.messages.slice(-2), [['invalidate'], ['desktop:fullscreen-transition', 'end']]);
  }
  assert.deepEqual(h.sizes, [[1280, 821], [1280, 820]]);
});

test('repeat bridge toggles return current state without stacking setFullScreen', t => {
  const h = fixture(t);
  assert.equal(h.controller.toggle(), true);
  assert.equal(h.controller.toggle(), false, 'native state is still windowed');
  h.window.emit('will-enter-full-screen');
  assert.equal(h.controller.toggle(), false);
  h.complete(true);
  assert.equal(h.controller.toggle(), false);
  assert.equal(h.controller.toggle(), true, 'native state is still fullscreen');
  h.window.emit('will-leave-full-screen');
  h.complete(false);
  assert.deepEqual(h.calls, [true, false]);
});

test('native menu/traffic-light transition also blocks the bridge until repair ends', t => {
  const h = fixture(t);
  h.window.emit('will-enter-full-screen');
  h.window.emit('enter-full-screen');
  t.mock.timers.tick(59);
  h.controller.toggle();
  assert.deepEqual(h.calls, []);
  t.mock.timers.tick(1);
  h.controller.toggle();
  assert.equal(h.calls.length, 1);
});

test('Electron 45 native resize detects fullscreen changes without will-full-screen events', t => {
  const h = fixture(t);
  h.window.emit('resize');
  assert.deepEqual(h.messages, [], 'ordinary resize does not fade');
  for (const next of [true, false]) {
    h.nativeState(next);
    h.window.emit(next ? 'resize' : 'will-resize');
    assert.deepEqual(h.messages.at(-1), ['desktop:fullscreen-transition', 'start']);
    assert.equal(h.controller.toggle(), next);
    h.complete(next);
  }
  assert.deepEqual(h.calls, [], 'native transitions never stack bridge calls');
});

test('toggle and repair leave the window on its original display', t => {
  const h = fixture(t);
  const screen = { getDisplayMatching: bounds => ({ id: bounds.x < 0 ? 2 : 1 }) };
  const before = screen.getDisplayMatching(h.window.getBounds()).id;
  for (const next of [true, false]) {
    h.controller.toggle();
    h.window.emit(next ? 'will-enter-full-screen' : 'will-leave-full-screen');
    h.complete(next);
    assert.equal(screen.getDisplayMatching(h.window.getBounds()).id, before);
  }
});

test('closing a window cancels a pending repair and end message', t => {
  const h = fixture(t);
  h.window.emit('leave-full-screen');
  h.window.emit('closed');
  t.mock.timers.tick(60);
  assert.deepEqual(h.messages, []);
});


test('native completion followed by resize cannot cancel its pending end', t => {
  const h = fixture(t);
  for (const next of [true, false]) {
    h.nativeState(next);
    h.window.emit(next ? 'enter-full-screen' : 'leave-full-screen');
    h.window.emit('will-resize'); h.window.emit('resize');
    t.mock.timers.tick(60);
    assert.deepEqual(h.messages.at(-1), ['desktop:fullscreen-transition', 'end']);
  }
  h.controller.toggle();
  assert.equal(h.calls.length, 1, 'bridge unlocked after repair');
});

test('a cancelled native transition reveals content and unlocks the bridge', t => {
  const h = fixture(t);
  h.nativeState(true); h.window.emit('resize');
  h.nativeState(false); h.window.emit('resize');
  assert.deepEqual(h.messages.at(-1), ['desktop:fullscreen-transition', 'end']);
  h.controller.toggle();
  assert.deepEqual(h.calls, [true]);
});

test('a transition with no native events times out and allows another toggle', t => {
  const h = fixture(t);
  h.controller.toggle();
  t.mock.timers.tick(2499);
  assert.deepEqual(h.messages.at(-1), ['desktop:fullscreen-transition', 'start']);
  t.mock.timers.tick(1);
  assert.deepEqual(h.messages.at(-1), ['desktop:fullscreen-transition', 'end']);
  h.controller.toggle();
  assert.deepEqual(h.calls, [true, true]);
});
