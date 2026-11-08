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
  // If the floating timer it opened never loads, or is closed, nothing would show the time: restore.
  let watching = false;
  function watchFloating() {
    if (watching) return;
    watching = true;
    floatingControls().onFocusWindowLost(() => { const win = usable(); if (win) restore(win); });
  }
  return {
    run(action) {
      if (!validWindowEvent(action)) return false;
      const win = usable();
      if (!win) return false;
      switch (action) {
        case 'minimise': return minimise(win);
        // Never leave the person with no visible timer: minimise only once the floating timer is open.
        case 'floating':
          watchFloating();
          return floatingControls().openForFocus() ? (minimise(win), true) : false;
        case 'restore': return restore(win);
        // Closes only a floating timer that focus start opened; one the person turned on stays.
        case 'full': floatingControls().closeForFocus(); return restore(win);
      }
      return false;
    },
  };
}

function registerWindowEvents(ipc, { trustedMain, events }) {
  ipc.on('desktop:window-event', (event, action) => { if (trustedMain(event) && validWindowEvent(action)) events.run(action); });
}

module.exports = { WINDOW_EVENT_ACTIONS, validWindowEvent, createWindowEvents, registerWindowEvents };
