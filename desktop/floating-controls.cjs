const { readJSON, writeJSON } = require('./native-services.cjs');

// Main-process projections of renderer-owned, persisted settings.
const DEFAULT_FLOATING_PREFERENCES = Object.freeze({ floatingTimer: false, floatingOnTop: true, menuBarTime: true, showMenuBar: true });
const preferenceKeys = Object.keys(DEFAULT_FLOATING_PREFERENCES);
function validPreferences(value) {
  const valid = !!(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === preferenceKeys.length && preferenceKeys.every(key => typeof value[key] === 'boolean'));
  if (!valid) console.warn('Rejected invalid floating preferences');
  return valid;
}
function validAudioCommand(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    (value.action === 'volume' ? Object.keys(value).length === 2 && Number.isFinite(value.value) && value.value >= 0 && value.value <= 1 :
      Object.keys(value).length === 1 && ['mute', 'toggle'].includes(value.action));
}
function validAudioState(value) {
  return value && typeof value === 'object' && Object.keys(value).length === 4 &&
    Number.isFinite(value.volume) && value.volume >= 0 && value.volume <= 1 &&
    ['muted', 'playing', 'available'].every(key => typeof value[key] === 'boolean');
}
function createFloatingControls({ floating, tray, notify, stateFile, setMenuBarVisible = () => {} }) {
  // A startup mirror avoids briefly creating a hidden tray before IndexedDB loads.
  // The renderer remains the settings source once it connects.
  const saved = readJSON(stateFile);
  let state = { ...DEFAULT_FLOATING_PREFERENCES,
    showMenuBar: typeof saved?.showMenuBar === 'boolean' ? saved.showMenuBar : true };
  let pendingShowMenuBar = null;
  let ready = false, status = 'Kitestring';
  const refreshTray = () => { tray()?.setTitle(state.menuBarTime ? status : ''); tray()?.setToolTip(status); };
  function apply(next, publish) {
    const changed = preferenceKeys.some(key => next[key] !== state[key]);
    state = { ...next };
    floating.setOnTop(state.floatingOnTop);
    const open = floating.open(state.floatingTimer);
    state.floatingTimer = open;
    if (stateFile) {
      try { writeJSON(stateFile, { showMenuBar: state.showMenuBar }); }
      catch { console.error('Unable to save menu bar visibility'); }
    }
    setMenuBarVisible(state.showMenuBar);
    refreshTray();
    if (publish && changed) notify({ ...state });
    return open;
  }
  return {
    restoreMenuBar() { setMenuBarVisible(state.showMenuBar); },
    sync(value) {
      if (!validPreferences(value)) return false;
      const pending = pendingShowMenuBar;
      pendingShowMenuBar = null;
      ready = true;
      apply(pending === null ? value : { ...value, showMenuBar: pending }, false);
      // Preserve an app-menu action made before the renderer subscribed.
      if (pending !== null) notify({ ...state });
      return true;
    },
    appMenuItem() {
      return { label: 'Show in Menu Bar', type: 'checkbox', checked: state.showMenuBar,
        click: item => {
          if (typeof item.checked !== 'boolean') return;
          if (!ready) pendingShowMenuBar = item.checked;
          apply({ ...state, showMenuBar: item.checked }, true);
        } };
    },
    change(patch) { return apply({ ...state, ...patch }, true); },
    opened(open) { if (state.floatingTimer !== open) { state = { ...state, floatingTimer: open }; notify({ ...state }); } },
    setStatus(value) { status = value; refreshTray(); },
    refreshTray,
    snapshot: () => ({ ...state }),
    menu() {
      return [
        ['Floating timer', 'floatingTimer'], ['Keep floating timer on top', 'floatingOnTop'], ['Show time in menu bar', 'menuBarTime'],
      ].map(([label, key]) => ({ label, type: 'checkbox', checked: state[key], enabled: ready && (key !== 'menuBarTime' || state.showMenuBar),
        click: item => { if (ready && (key !== 'menuBarTime' || state.showMenuBar) && typeof item.checked === 'boolean') apply({ ...state, [key]: item.checked }, true); } }));
    },
  };
}
function registerFloatingControls(ipc, { trustedMain, floating, controls, sendMain }) {
  ipc.handle('desktop:floating-preferences', (event, value) => trustedMain(event) ? controls.sync(value) : false);
  ipc.on('desktop:audio-control', (event, value) => { if (floating.trusted(event) && validAudioCommand(value)) sendMain('desktop:audio-action', value); });
  ipc.on('desktop:audio-state', (event, value) => { if (trustedMain(event) && validAudioState(value)) floating.send('desktop:audio-state', value); });
  ipc.on('desktop:audio-request', event => { if (floating.trusted(event)) sendMain('desktop:audio-request'); });
}
module.exports = { DEFAULT_FLOATING_PREFERENCES, validPreferences, validAudioCommand, validAudioState, createFloatingControls, registerFloatingControls };
