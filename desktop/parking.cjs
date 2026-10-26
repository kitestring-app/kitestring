const path = require('node:path');
const { APP_ORIGIN } = require('./security.cjs');
const CAPTURE_URL = `${APP_ORIGIN}/park.html`;
const SHORTCUT = 'Alt+Command+P';
function cleanText(value) {
  if (typeof value !== 'string' || value.length > 500) return null;
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  return text.length ? text : null;
}
function createParking({ BrowserWindow, screen, globalShortcut, deliver }) {
  let window = null;
  let registered = false;
  function close() {
    if (!window || window.isDestroyed()) return;
    const closing = window;
    window = null;
    // A nonactivating panel returns keyboard focus without hiding the dashboard.
    closing.blur();
    closing.close();
  }
  function trusted(event) {
    return !!window && !window.isDestroyed() && event.sender === window.webContents &&
      event.senderFrame === window.webContents.mainFrame && event.senderFrame?.url === CAPTURE_URL;
  }
  function open() {
    if (window && !window.isDestroyed()) { window.focus(); return; }
    const { workArea: area } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const width = Math.min(520, area.width), height = Math.min(64, area.height);
    const created = new BrowserWindow({
      title: 'Park a thought', width, height, x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + (area.height - height) / 2),
      type: 'panel', frame: false, show: false, backgroundColor: '#14121c', roundedCorners: true,
      resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true,
      webPreferences: { preload: path.join(__dirname, 'parking-preload.cjs'), sandbox: true, contextIsolation: true,
        nodeIntegration: false, webSecurity: true },
    });
    window = created;
    created.setAlwaysOnTop(true, 'floating');
    created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    const guard = (event, url) => { if ((event.url ?? url) !== CAPTURE_URL) event.preventDefault(); };
    for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect']) created.webContents.on(name, guard);
    created.webContents.on('will-attach-webview', event => event.preventDefault());
    created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    created.webContents.on('render-process-gone', () => { if (window === created) close(); });
    created.on('blur', () => { if (window === created) close(); });
    created.on('closed', () => { if (window === created) window = null; });
    created.once('ready-to-show', () => { if (!created.isDestroyed()) { created.show(); created.focus(); } });
    void created.loadURL(CAPTURE_URL).catch(() => { if (window === created) close(); });
  }
  return {
    register() { try { registered = globalShortcut.register(SHORTCUT, open); } catch { registered = false; } return registered; },
    status: () => ({ registered }),
    open, close, trusted,
    submit(event, value) {
      if (!trusted(event)) return false;
      const text = cleanText(value);
      if (!text || !deliver(text)) return false;
      close();
      return true;
    },
    dispose() { close(); if (registered) globalShortcut.unregister(SHORTCUT); registered = false; },
    snapshot: () => ({ registered, capture: window && !window.isDestroyed() ? {
      visible: window.isVisible(), focused: window.isFocused(), bounds: window.getBounds(), fullscreen: window.isFullScreen(),
      alwaysOnTop: window.isAlwaysOnTop(), allWorkspaces: window.isVisibleOnAllWorkspaces(),
    } : null }),
  };
}
module.exports = { createParking, cleanText, CAPTURE_URL, SHORTCUT };
