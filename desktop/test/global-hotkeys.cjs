const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGlobalHotkeys, normalizeAccelerator, validHotkeys, registerGlobalHotkeys } = require('../global-hotkeys.cjs');

function fixture(refuse = new Set()) {
  const shortcuts = new Map(), runs = [];
  const globalShortcut = {
    register: (key, fn) => { if (refuse.has(key)) return false; shortcuts.set(key, fn); return true; },
    unregister: key => shortcuts.delete(key),
  };
  return { shortcuts, runs, hotkeys: createGlobalHotkeys({ globalShortcut, run: action => runs.push(action) }) };
}
const off = { showApp: null, toggle: null, stop: null, skip: null };

test('normalizes accelerators and refuses ones that would hijack typing', () => {
  assert.equal(normalizeAccelerator('Command+Alt+K'), 'Alt+Command+K');
  assert.equal(normalizeAccelerator('Shift+Ctrl+Space'), 'Control+Shift+Space');
  assert.equal(normalizeAccelerator('Option+F5'), 'Alt+F5');
  assert.equal(normalizeAccelerator('Command+F12'), 'Command+F12');
  for (const bad of ['K', 'Command+K', 'Shift+K', 'Shift+Alt', 'Command+Command+K', 'Hyper+Alt+K', 'Alt+Command+k', 'Alt+Command+Enter', 'Shift+F5', '', 42, null, 'Alt+Command+'.padEnd(80, 'K')]) {
    assert.equal(normalizeAccelerator(bad), null, String(bad));
  }
});

test('opt-in: nothing registers until an action has a shortcut', () => {
  const h = fixture();
  assert.deepEqual(h.hotkeys.sync(off), { showApp: 'off', toggle: 'off', stop: 'off', skip: 'off' });
  assert.equal(h.shortcuts.size, 0);
});

test('registers each action, runs it, and replaces registrations on every sync', () => {
  const h = fixture();
  const status = h.hotkeys.sync({ showApp: 'Control+Alt+K', toggle: 'Control+Alt+Space', stop: 'Control+Alt+S', skip: 'Control+Alt+N' });
  assert.deepEqual(status, { showApp: 'ok', toggle: 'ok', stop: 'ok', skip: 'ok' });
  for (const key of ['Control+Alt+K', 'Control+Alt+Space', 'Control+Alt+S', 'Control+Alt+N']) h.shortcuts.get(key)();
  assert.deepEqual(h.runs, ['showApp', 'toggle', 'stop', 'skip']);
  h.hotkeys.sync({ ...off, toggle: 'Control+Alt+T' });
  assert.deepEqual([...h.shortcuts.keys()], ['Control+Alt+T']);
  h.hotkeys.dispose();
  assert.equal(h.shortcuts.size, 0);
  assert.deepEqual(h.hotkeys.snapshot().registered, []);
});

test('reports reserved, duplicate, invalid and taken shortcuts without registering them', () => {
  const h = fixture(new Set(['Control+Alt+X']));
  const status = h.hotkeys.sync({ showApp: 'Alt+Command+P', toggle: 'Control+Alt+K', stop: 'Alt+Control+K', skip: 'Control+Alt+X' });
  assert.deepEqual(status, { showApp: 'reserved', toggle: 'ok', stop: 'duplicate', skip: 'taken' });
  assert.deepEqual([...h.shortcuts.keys()], ['Control+Alt+K']);
  assert.deepEqual(h.hotkeys.sync({ ...off, showApp: 'Command+K' }).showApp, 'invalid');
  assert.deepEqual(h.hotkeys.sync({ ...off, showApp: 'Shift+Command+4' }).showApp, 'reserved');
});

test('a register that throws counts as taken', () => {
  const hotkeys = createGlobalHotkeys({ globalShortcut: { register: () => { throw new Error('bad'); }, unregister: () => {} }, run: () => {} });
  assert.equal(hotkeys.sync({ ...off, stop: 'Control+Alt+S' }).stop, 'taken');
});

test('rejects malformed payloads, leaving current registrations alone', () => {
  const h = fixture();
  h.hotkeys.sync({ ...off, toggle: 'Control+Alt+T' });
  for (const bad of [null, [], {}, { ...off, extra: null }, { ...off, toggle: 5 }, { showApp: null, toggle: null, stop: null }]) {
    assert.equal(validHotkeys(bad), false);
    assert.equal(h.hotkeys.sync(bad), null);
  }
  assert.deepEqual([...h.shortcuts.keys()], ['Control+Alt+T']);
});

test('IPC only accepts the trusted main renderer', async () => {
  const h = fixture();
  const handlers = new Map();
  registerGlobalHotkeys({ handle: (channel, fn) => handlers.set(channel, fn) }, { trustedMain: event => event.trusted, hotkeys: h.hotkeys });
  const handler = handlers.get('desktop:global-hotkeys');
  assert.equal(handler({ trusted: false }, { ...off, toggle: 'Control+Alt+T' }), null);
  assert.equal(h.shortcuts.size, 0);
  assert.equal(handler({ trusted: true }, { ...off, toggle: 'Control+Alt+T' }).toggle, 'ok');
});

test('every multi-modifier menu accelerator is reserved, and both reserved lists match', () => {
  const { applicationMenu } = require('../menu.cjs');
  const { RESERVED } = require('../global-hotkeys.cjs');
  const controls = { appMenuItem: () => ({ label: 'Show in Menu Bar' }), menu: () => [{ label: 'Floating timer' }, { label: 'On top' }, { label: 'Time' }] };
  const accelerators = [];
  const walk = items => { for (const item of items) { if (item.accelerator) accelerators.push(item.accelerator); if (Array.isArray(item.submenu)) walk(item.submenu); } };
  for (const timerState of [{ segment: 'focus', running: false, hasProgress: false, ringing: true, sounding: true }]) {
    walk(applicationMenu({ command() {}, showWindow() {}, closeWindow() {}, toggleTimer() {}, floatingControls: controls, park() {}, openGitHub() {}, timerState }));
  }
  assert.ok(accelerators.includes('Command+Shift+R'));
  for (const accelerator of accelerators) {
    const canonical = normalizeAccelerator(accelerator);
    if (canonical) assert.ok(RESERVED.has(canonical), `${accelerator} must be reserved`);
  }
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'src', 'state', 'globalHotkeys.ts'), 'utf8');
  const start = source.indexOf('RESERVED_HOTKEYS = new Set([');
  const list = source.slice(start, source.indexOf(']);', start));
  assert.deepEqual([...list.matchAll(/"([^"]+)"/g)].map(m => m[1]).sort(), [...RESERVED].sort());
});

test('own menu keys, Redo and Lock Screen are refused', () => {
  const h = fixture();
  const status = h.hotkeys.sync({ showApp: 'Shift+Command+R', toggle: 'Shift+Command+Z', stop: 'Control+Command+Q', skip: 'Command+Shift+T' });
  assert.deepEqual(status, { showApp: 'reserved', toggle: 'reserved', stop: 'reserved', skip: 'reserved' });
  assert.equal(h.shortcuts.size, 0);
});
