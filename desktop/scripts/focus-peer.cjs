// This fixture runs only in a disposable Electron process launched by the smoke test.
async function startFocusPeer({ app, BrowserWindow, ipcMain }, preload) {
  let active = false;
  const events = [];
  const record = name => {
    events.push({ name, at: performance.now() });
    if (events.length > 40) events.shift();
  };
  app.on('did-become-active', () => { active = true; record('active'); });
  app.on('did-resign-active', () => { active = false; record('inactive'); });
  await app.whenReady();
  const window = new BrowserWindow({ width: 480, height: 180, show: false,
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false } });
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  window.setAlwaysOnTop(true, 'floating');
  const ready = new Promise(resolve => window.once('ready-to-show', () => { record('ready'); resolve(); }));
  for (const name of ['focus', 'blur', 'show', 'hide']) window.on(name, () => record(name));
  ipcMain.handle('peer:state', () => ({ active, focused: window.isFocused(), visible: window.isVisible(), events: [...events] }));
  ipcMain.handle('peer:focus', async () => {
    await ready;
    // The nonactivating capture can borrow key focus while this app stays active.
    // A fresh activation is a real focus transition; app.focus() alone can be a no-op.
    if (active) await new Promise(resolve => { app.once('did-resign-active', resolve); app.hide(); });
    // On macOS focus() returns early while the window is still occluded.
    const shown = window.isVisible() ? Promise.resolve() : new Promise(resolve => window.once('show', resolve));
    app.show(); window.show();
    await shown;
    app.focus({ steal: true }); window.moveTop(); window.focus();
  });
  await window.loadURL('data:text/html,<title>Focus peer</title><input autofocus aria-label="Focus peer">');
}
module.exports = { startFocusPeer };
