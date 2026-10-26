const path = require('node:path');
const { APP_ORIGIN } = require('./security.cjs');
const { readJSON, writeJSON } = require('./native-services.cjs');
const MINI_URL = `${APP_ORIGIN}/?mini=1`;
function fitBounds(saved, area) {
  const width = Math.min(area.width, Math.max(240, Number.isFinite(saved?.width) ? saved.width : 280));
  const height = Math.min(area.height, Math.max(150, Number.isFinite(saved?.height) ? saved.height : 170));
  return { width, height,
    x: Math.round(Math.max(area.x, Math.min(area.x + area.width - width, Number.isFinite(saved?.x) ? saved.x : area.x + area.width - width - 24))),
    y: Math.round(Math.max(area.y, Math.min(area.y + area.height - height, Number.isFinite(saved?.y) ? saved.y : area.y + 24))) };
}
function createFloating({ BrowserWindow, screen, stateFile, smokeTest = false, onChange = () => {}, nativeTheme, platform = process.platform }) {
  let window = null;
  let onTop = true;
  const glassAvailable = () => platform === 'darwin' && nativeTheme?.prefersReducedTransparency === false;
  function applyLevel() {
    if (!window || window.isDestroyed()) return;
    window.setAlwaysOnTop(onTop, onTop ? 'floating' : 'normal');
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: onTop, skipTransformProcessType: true });
  }
  function applyMaterial() {
    if (!window || window.isDestroyed()) return;
    const glass = glassAvailable();
    try {
      window.setVibrancy?.(glass ? 'under-window' : null);
      window.setBackgroundColor?.(glass ? '#00000000' : '#14121c');
    } catch {
      window.setBackgroundColor?.('#14121c');
    }
  }
  const positions = readJSON(stateFile) ?? {};
  function save() {
    if (!window || window.isDestroyed()) return;
    const bounds = window.getBounds();
    const display = screen.getDisplayMatching(bounds);
    positions[String(display.id)] = bounds;
    writeJSON(stateFile, positions);
  }
  function reconcile() {
    if (!window || window.isDestroyed()) return;
    const display = screen.getDisplayMatching(window.getBounds());
    window.setBounds(fitBounds(positions[String(display.id)] ?? window.getBounds(), display.workArea));
  }
  function close() { if (window && !window.isDestroyed()) { save(); window.destroy(); } }
  return {
    open(enabled) {
      if (!enabled) { close(); return false; }
      if (window && !window.isDestroyed()) return true;
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const created = new BrowserWindow({
        ...fitBounds(positions[String(display.id)], display.workArea), minWidth: 240, minHeight: 150,
        show: false, frame: false, roundedCorners: true,
        transparent: platform === 'darwin', visualEffectState: 'active',
        ...(glassAvailable() ? { vibrancy: 'under-window', backgroundColor: '#00000000' } : { backgroundColor: '#14121c' }),
        resizable: true, movable: true, minimizable: false, maximizable: false, fullscreenable: false,
        webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true,
          nodeIntegration: false, webSecurity: true, backgroundThrottling: false,
          additionalArguments: ['--mini-timer', ...(smokeTest ? ['--smoke-test'] : [])] },
      });
      window = created;
      applyLevel();
      applyMaterial();
      nativeTheme?.on('updated', applyMaterial);
      const guard = (event, url) => { if ((event.url ?? url) !== MINI_URL) event.preventDefault(); };
      for (const event of ['will-navigate', 'will-frame-navigate', 'will-redirect']) created.webContents.on(event, guard);
      created.webContents.on('will-attach-webview', event => event.preventDefault());
      created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      created.webContents.on('render-process-gone', () => { if (window === created) close(); });
      created.on('move', save); created.on('resize', save); created.on('close', save);
      for (const name of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(name, reconcile);
      created.on('closed', () => {
        nativeTheme?.removeListener('updated', applyMaterial);
        for (const name of ['display-added', 'display-removed', 'display-metrics-changed']) screen.removeListener(name, reconcile);
        if (window === created) { window = null; onChange(false); }
      });
      created.once('ready-to-show', () => { if (!created.isDestroyed()) created.showInactive(); });
      void created.loadURL(MINI_URL).catch(() => { if (window === created) close(); });
      onChange(true);
      return true;
    },
    close,
    setOnTop(value) { if (typeof value !== 'boolean') return false; onTop = value; applyLevel(); return true; },
    send(channel, value) { if (window && !window.isDestroyed()) window.webContents.send(channel, value); },
    trusted(event) { return window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.senderFrame?.url === MINI_URL; },
    snapshot: () => window && !window.isDestroyed() ? { bounds: window.getBounds(), visible: window.isVisible() } : null,
  };
}
module.exports = { createFloating, fitBounds, MINI_URL };
