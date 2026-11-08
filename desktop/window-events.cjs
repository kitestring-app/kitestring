// Opt-in window changes when a focus block starts or ends (Settings > Extras).
// The renderer owns the preference and sends one action; this file only moves windows.
const WINDOW_EVENT_ACTIONS = Object.freeze(['minimise', 'floating', 'restore', 'full']);
const validWindowEvent = value => typeof value === 'string' && WINDOW_EVENT_ACTIONS.includes(value);

function createWindowEvents({ mainWindow, floatingControls, fullscreen, showWorkspaces }) {
  const usable = () => { const win = mainWindow(); return win && !win.isDestroyed() ? win : null; };
  // A full-screen window cannot be minimised on macOS, and a transition must finish first.
  function minimise(win) {
    if (win.isFullScreen() || fullscreen()?.isTransitioning() || !win.isVisible() || win.isMinimized()) return false;
    win.minimize();
    return true;
  }
  // Like the end-of-block reminder: bring the window back without taking the keyboard.
  function restore(win) {
    fullscreen()?.cancelHide();
    showWorkspaces?.join(win);
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.showInactive();
    win.moveTop();
    return true;
  }
  return {
    run(action) {
      if (!validWindowEvent(action)) return false;
      const win = usable();
      if (!win) return false;
      switch (action) {
        case 'minimise': return minimise(win);
        case 'floating': floatingControls().change({ floatingTimer: true }); minimise(win); return true;
        case 'restore': return restore(win);
        case 'full': floatingControls().change({ floatingTimer: false }); return restore(win);
      }
      return false;
    },
  };
}

function registerWindowEvents(ipc, { trustedMain, events }) {
  ipc.on('desktop:window-event', (event, action) => { if (trustedMain(event) && validWindowEvent(action)) events.run(action); });
}

module.exports = { WINDOW_EVENT_ACTIONS, validWindowEvent, createWindowEvents, registerWindowEvents };
