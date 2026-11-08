// Opt-in, user-chosen global shortcuts. The renderer owns the saved choices
// (device preferences); the main process only registers them.
const HOTKEY_ACTIONS = Object.freeze(['showApp', 'toggle', 'stop', 'skip']);
const MODIFIERS = Object.freeze(['Control', 'Alt', 'Shift', 'Command']);
const NAMED_KEYS = new Set(['Space', 'Up', 'Down', 'Left', 'Right', '-', '=', '[', ']', '\\', ';', "'", ',', '.', '/', '`']);
// Kitestring's own menu and global keys (a global registration would shadow them),
// Redo, Lock Screen, the emoji picker and the macOS screenshot keys.
// Keep in sync with RESERVED_HOTKEYS in src/state/globalHotkeys.ts; test/global-hotkeys.cjs checks the menu.
const RESERVED = new Set([
  'Alt+Command+P',
  'Command+.',
  'Alt+Command+H',
  'Control+Command+F',
  'Shift+Command+F',
  'Shift+Command+M',
  'Shift+Command+N',
  'Shift+Command+R',
  'Shift+Command+T',
  'Shift+Command+Z',
  'Control+Command+Q',
  'Control+Command+Space',
  'Shift+Command+3',
  'Shift+Command+4',
  'Shift+Command+5',
  'Shift+Command+6',
]);
const isKey = key => /^[A-Z0-9]$/.test(key) || /^F([1-9]|1[0-9]|2[0-4])$/.test(key) || NAMED_KEYS.has(key);

/** Canonical "Control+Alt+Shift+Command+K" form, or null. Needs two modifiers, or one with a function key. */
function normalizeAccelerator(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return null;
  // '+' cannot be a key here, so splitting is safe; "=" covers the plus key.
  const parts = value.split('+');
  const key = parts.pop();
  if (!isKey(key) || parts.length === 0) return null;
  const mods = new Set();
  for (const part of parts) {
    const mod = part === 'Cmd' || part === 'CommandOrControl' || part === 'CmdOrCtrl' ? 'Command' : part === 'Ctrl' ? 'Control' : part === 'Option' ? 'Alt' : part;
    if (!MODIFIERS.includes(mod) || mods.has(mod)) return null;
    mods.add(mod);
  }
  const strong = ['Control', 'Alt', 'Command'].some(mod => mods.has(mod));
  const fnKey = /^F\d+$/.test(key);
  if (!strong || (mods.size < 2 && !fnKey)) return null;
  return [...MODIFIERS.filter(mod => mods.has(mod)), key].join('+');
}

/** The four actions, plus an optional `recording` flag while Settings records a new shortcut. */
function validHotkeys(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  const extra = keys.filter(key => !HOTKEY_ACTIONS.includes(key));
  if (extra.length > 1 || (extra.length === 1 && (extra[0] !== 'recording' || typeof value.recording !== 'boolean'))) return false;
  return keys.length - extra.length === HOTKEY_ACTIONS.length &&
    HOTKEY_ACTIONS.every(action => value[action] === null || (typeof value[action] === 'string' && value[action].length <= 64));
}

/**
 * sync() replaces every registration and reports per action:
 * 'off' | 'ok' | 'invalid' | 'reserved' | 'duplicate' | 'taken' (another app or macOS holds it).
 */
function createGlobalHotkeys({ globalShortcut, run }) {
  let registered = [];
  let recording = false;
  let status = Object.fromEntries(HOTKEY_ACTIONS.map(action => [action, 'off']));
  function clear() {
    for (const accelerator of registered) { try { globalShortcut.unregister(accelerator); } catch { /* already gone */ } }
    registered = [];
  }
  return {
    sync(value) {
      if (!validHotkeys(value)) return null;
      clear();
      // While recording, nothing is registered, so pressing a combination only records it.
      recording = value.recording === true;
      if (recording) return Object.fromEntries(HOTKEY_ACTIONS.map(action => [action, 'off']));
      const seen = new Set();
      const next = {};
      for (const action of HOTKEY_ACTIONS) {
        if (value[action] === null) { next[action] = 'off'; continue; }
        const accelerator = normalizeAccelerator(value[action]);
        if (!accelerator) { next[action] = 'invalid'; continue; }
        if (RESERVED.has(accelerator)) { next[action] = 'reserved'; continue; }
        if (seen.has(accelerator)) { next[action] = 'duplicate'; continue; }
        seen.add(accelerator);
        let ok = false;
        try { ok = globalShortcut.register(accelerator, () => run(action)) === true; } catch { ok = false; }
        if (ok) registered.push(accelerator);
        next[action] = ok ? 'ok' : 'taken';
      }
      status = next;
      return { ...status };
    },
    /** Settings is recording a shortcut: keyboard-triggered menu commands should wait. */
    recording: () => recording,
    snapshot: () => ({ registered: [...registered], recording, status: { ...status } }),
    dispose() { clear(); recording = false; status = Object.fromEntries(HOTKEY_ACTIONS.map(action => [action, 'off'])); },
  };
}

function registerGlobalHotkeys(ipc, { trustedMain, hotkeys }) {
  ipc.handle('desktop:global-hotkeys', (event, value) => trustedMain(event) ? hotkeys.sync(value) : null);
}

module.exports = { HOTKEY_ACTIONS, RESERVED, normalizeAccelerator, validHotkeys, createGlobalHotkeys, registerGlobalHotkeys };
