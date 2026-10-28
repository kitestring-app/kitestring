const path = require('node:path');
const { APP_ORIGIN, isAppURL } = require('./security.cjs');

// Electron's work areas and window bounds are both in device-independent pixels.
function centeredRect(workArea, size) {
  const width = Math.min(size.width, workArea.width);
  const height = Math.min(size.height, workArea.height);
  return { x: workArea.x + Math.floor((workArea.width - width) / 2),
    y: workArea.y + Math.floor((workArea.height - height) / 2), width, height };
}
function bannerRects(displays, mainDisplayId, allDisplays = false) {
  return displays.filter((display) => allDisplays || display.id !== mainDisplayId).map(({ id, workArea }) => ({
    displayId: id, x: workArea.x, y: workArea.y, width: workArea.width, height: Math.min(64, workArea.height),
  }));
}
function isBannerURL(value) {
  if (!isAppURL(value)) return false;
  const url = new URL(value);
  return url.pathname === '/banner.html' && !url.hash &&
    [...url.searchParams.keys()].length === 1 &&
    ['focus-done', 'break-over'].includes(url.searchParams.get('kind'));
}
function moveMainToDisplay(window, display, onPlaced = () => {}) {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  if (window.isMaximized()) window.unmaximize();
  const place = () => {
    if (window.isDestroyed()) return;
    window.setMinimumSize(Math.min(720, display.workArea.width), Math.min(540, display.workArea.height));
    window.setBounds(centeredRect(display.workArea, window.getNormalBounds()));
    onPlaced();
  };
  if (window.isFullScreen()) {
    window.once('leave-full-screen', place);
    window.setFullScreen(false);
  } else place();
}

function createBanners({ BrowserWindow, screen, onOpen, onAction = async () => false, getDisplays = () => screen.getAllDisplays() }) {
  const windows = new Map();
  const shown = new WeakSet();
  let active = null;
  const events = ['display-added', 'display-removed', 'display-metrics-changed'];
  function stop() {
    active = null;
    for (const event of events) screen.removeListener(event, reconcile);
    const previous = [...windows.values()];
    windows.clear(); // Revoke trust before destroying renderers.
    for (const window of previous) if (!window.isDestroyed()) window.destroy();
  }
  function reconcile() {
    if (!active) return;
    const displays = getDisplays();
    if (!displays.some((display) => display.id === active.mainDisplayId)) {
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      active.mainDisplayId = display.id;
      if (!active.allDisplays) onOpen(display);
    }
    const rects = bannerRects(displays, active.mainDisplayId, active.allDisplays);
    const wanted = new Set(rects.map((rect) => rect.displayId));
    for (const [id, window] of windows) {
      if (!wanted.has(id)) { windows.delete(id); if (!window.isDestroyed()) window.destroy(); }
    }
    for (const { displayId, ...bounds } of rects) {
      if (windows.has(displayId)) { windows.get(displayId).setBounds(bounds); continue; }
      const url = `${APP_ORIGIN}/banner.html?kind=${active.kind}`;
      const window = new BrowserWindow({
        ...bounds, type: 'panel', show: false, frame: false, transparent: false, backgroundColor: '#14121c',
        focusable: false, skipTaskbar: true, hasShadow: true, resizable: false,
        minimizable: false, maximizable: false, fullscreenable: false,
        webPreferences: { preload: path.join(__dirname, 'banner-preload.cjs'), sandbox: true,
          contextIsolation: true, nodeIntegration: false, webSecurity: true },
      });
      windows.set(displayId, window);
      window.setAlwaysOnTop(true, 'screen-saver');
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
      const preventNavigation = (event, legacyURL) => {
        if ((event.url ?? legacyURL) !== url) event.preventDefault();
      };
      window.webContents.on('will-navigate', preventNavigation);
      window.webContents.on('will-frame-navigate', preventNavigation);
      window.webContents.on('will-redirect', preventNavigation);
      window.webContents.on('will-attach-webview', (event) => event.preventDefault());
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('render-process-gone', () => { if (!window.isDestroyed()) window.destroy(); });
      window.once('closed', () => { if (windows.get(displayId) === window) windows.delete(displayId); });
      window.once('ready-to-show', () => {
        if (active && windows.get(displayId) === window && !window.isDestroyed()) {
          window.showInactive();
          shown.add(window);
        }
      });
      void window.loadURL(url).catch(() => { if (!window.isDestroyed()) window.destroy(); });
    }
  }
  return {
    start(kind, mainDisplayId, { allDisplays = false } = {}) {
      stop();
      if (!['focus-done', 'break-over'].includes(kind)) return;
      active = { kind, mainDisplayId, allDisplays, busy: false };
      for (const event of events) screen.on(event, reconcile);
      reconcile();
    },
    stop,
    async open(event, action = 'open') {
      if (!['open', 'continue', 'stop', 'dismiss'].includes(action) || !active || active.busy) return;
      for (const [id, window] of windows) {
        if (!window.isDestroyed() && event.sender === window.webContents &&
            event.senderFrame === window.webContents.mainFrame && isBannerURL(event.senderFrame?.url)) {
          const display = getDisplays().find((item) => item.id === id);
          if (!display) return;
          if (action === 'open') { onOpen(display); stop(); return; }
          const request = active;
          request.busy = true;
          try {
            if (await onAction(action) && active === request) stop();
          } finally { request.busy = false; }
          return;
        }
      }
    },
    snapshot: () => [...windows].map(([displayId, window]) => ({ displayId, visible: window.isVisible(), shown: shown.has(window),
      workArea: getDisplays().find((display) => display.id === displayId)?.workArea })),
  };
}
module.exports = { centeredRect, bannerRects, isBannerURL, moveMainToDisplay, createBanners };
