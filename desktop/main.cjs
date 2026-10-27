const { createTimerCommands, validTimerCommand } = require('./timer-commands.cjs');
const { app, globalShortcut, BrowserWindow, ipcMain, Menu, nativeImage, protocol, screen, session, shell, Tray, Notification, powerSaveBlocker, powerMonitor, safeStorage, nativeTheme } = require('electron');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { createCloud, registerCloud } = require('./cloud.cjs');
const CLOUD_ORIGIN = 'https://kitestring.custom-pomodoro.workers.dev';
const LEGACY_CLOUD_ORIGIN = 'https://custom-pomodoro.custom-pomodoro.workers.dev';
const { createNativeServices } = require('./native-services.cjs');
const { createParking } = require('./parking.cjs');
const { createFloating } = require('./floating.cjs');
const { createFloatingControls, registerFloatingControls } = require('./floating-controls.cjs');
const { applicationMenu, registerMenuCommands, validMenuCommand, timerMenuItems, validTimerState } = require('./menu.cjs');
const { createQuitGuard } = require('./quit.cjs');
const { createAppHandler } = require('./protocol.cjs');
const { shouldBlockYouTube, youtubeEmbedHeaders } = require('./youtube-policy.cjs');
const { APP_ORIGIN, LOGIN_ITEMS_URL, isAppURL, isExternalURL, mayGrant, statusText } = require('./security.cjs');
const { initialAttention, decideAttention, RATE_LIMIT_MS } = require('./attention.cjs');
const { createBanners, moveMainToDisplay } = require('./multi-monitor.cjs');
const { attachFullscreen } = require('./fullscreen.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true,
} }]);

const { prepareIdentity } = require('./identity.cjs');
const { createDns, registerDns } = require('./dns.cjs');
prepareIdentity(app);
app.setAppUserModelId('local.custom-pomodoro.desktop');
let window;
let fullscreen;
let tray;
let trayVisibilityVersion = 0;
let quitting = false;
let attention = initialAttention();
let releaseTimer;
let bounceId = null;
let currentStatus = '';
let timerMenuState = { segment: 'focus', running: false, hasProgress: false, ringing: false, sounding: false };
let globalStopRegistered = false;
let soundWindowTimer;
function updateTimerState(value) {
  const changed = JSON.stringify(timerMenuState) !== JSON.stringify(value);
  const wasSounding = timerMenuState.sounding;
  timerMenuState = { ...value };
  if (value.sounding && !wasSounding) {
    clearTimeout(soundWindowTimer);
    soundWindowTimer = setTimeout(() => updateTimerState({ ...timerMenuState, sounding: false }), 12_000);
    soundWindowTimer.unref?.();
  } else if (!value.sounding) clearTimeout(soundWindowTimer);
  if (value.sounding && !globalStopRegistered) {
    try { globalStopRegistered = globalShortcut.register('Command+.', () => menuCommand('stopSound', 'accelerator')); } catch { globalStopRegistered = false; }
  }
  if (!value.sounding && globalStopRegistered) { globalShortcut.unregister('Command+.'); globalStopRegistered = false; }
  floating?.send('desktop:timer-state', timerMenuState);
  if (changed && floatingControls) rebuildApplicationMenu();
}
const smokeTest = app.commandLine.hasSwitch('smoke-test');
const smokeFrames = [];
const smokeAttention = [];
let banners;
let floating;
let floatingControls;
let parking;
let native;
const quitGuard = createQuitGuard({
  requestFlush: (id) => {
    if (window && !window.isDestroyed()) window.webContents.send('desktop:flush', id);
    else quitGuard.acknowledge(id);
  },
  finish: () => app.quit(),
});
let attentionDisplay = null;
// A real banner renderer on a simulated extra display lets a one-monitor smoke
// run measure its cost. This switch is ignored outside the throwaway smoke run.
const extraSmokeDisplay = smokeTest && app.commandLine.hasSwitch('smoke-extra-display');
const singleSmokeDisplay = smokeTest && app.commandLine.hasSwitch('smoke-single-display');
const attentionDisplays = () => {
  const displays = screen.getAllDisplays();
  if (singleSmokeDisplay) return [screen.getDisplayNearestPoint(screen.getCursorScreenPoint())];
  return extraSmokeDisplay ? [...displays, { ...displays[0], id: 'smoke-extra' }] : displays;
};
const trustedSender = (event) => window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && isAppURL(event.senderFrame?.url);

function changeAttention(type, kind) {
  const now = performance.now();
  const next = decideAttention(attention, { type, kind, now });
  if (smokeTest) {
    smokeAttention.push({ type, kind, now, wall: Date.now(), before: attention, after: next });
    if (smokeAttention.length > 40) smokeAttention.shift();
  }
  if (next === attention) {
    if (type === 'timeout' && attention.releaseAt !== null) scheduleRelease(now);
    return;
  }
  attention = next;
  banners?.stop();
  clearTimeout(releaseTimer);
  if (bounceId !== null) { app.dock?.cancelBounce(bounceId); bounceId = null; }
  if (window && !window.isDestroyed()) {
    const active = attention.releaseAt !== null;
    if (active) {
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      attentionDisplay = display;
      const requestedWindow = window;
      const requestedAttention = attention;
      moveMainToDisplay(window, display, () => {
        if (window !== requestedWindow || attention !== requestedAttention || window.isDestroyed()) return;
        window.setAlwaysOnTop(true, 'floating');
        window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
        // Bring the reminder in front without taking the keyboard: typing keeps going to the app in use.
        if (window.isMinimized()) window.restore();
        if (!window.isVisible()) window.showInactive();
        window.moveTop();
        banners?.start(kind, display.id);
        bounceId = app.dock?.bounce('critical') ?? null;
      });
    } else {
      window.setAlwaysOnTop(false);
      window.setVisibleOnAllWorkspaces(false, { skipTransformProcessType: true });
    }
  }
  if (attention.releaseAt !== null) scheduleRelease(now);
}
function scheduleRelease(now) {
  clearTimeout(releaseTimer);
  releaseTimer = setTimeout(() => changeAttention('timeout'), Math.max(1, Math.ceil(attention.releaseAt - now)));
  releaseTimer.unref?.();
}
function showWindow() {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
function createWindow() {
  if (quitting || (window && !window.isDestroyed())) return;
  window = new BrowserWindow({
    title: 'Kitestring', width: 1280, height: 820, minWidth: 720, minHeight: 540,
    show: false, backgroundColor: '#14121c',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true,
      sandbox: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false,
      additionalArguments: smokeTest ? ['--smoke-test'] : [],
    },
  });
  const createdWindow = window;
  fullscreen = attachFullscreen(createdWindow);
  window.on('close', (event) => {
    if (smokeTest) console.log('Smoke window close event; quitting:', quitting);
    if (!quitting) { event.preventDefault(); window.hide(); }
  });
  window.on('hide', () => changeAttention('hide'));
  window.on('closed', () => { if (window !== createdWindow) return; if (smokeTest) console.log('Smoke window closed'); changeAttention('release'); window = null; });
  if (smokeTest) window.webContents.on('destroyed', () => console.log('Smoke web contents destroyed'));
  window.webContents.on('render-process-gone', () => {
    if (window !== createdWindow) return;
    native?.releasePower();
    floating?.close(); parking?.close();
    changeAttention('release');
    createdWindow.destroy();
    if (!quitting) createWindow();
  });
  window.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) { native?.releasePower(); }
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppURL(event.url ?? url)) event.preventDefault();
  });
  window.webContents.on('will-redirect', (event, url) => {
    if (event.isMainFrame && !isAppURL(event.url ?? url)) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalURL(url)) void shell.openExternal(url).catch(() => console.error('Unable to open external link'));
    return { action: 'deny' };
  });
  window.once('ready-to-show', () => {
    if (!smokeTest && window === createdWindow) showWindow();
  });
  void window.loadURL(`${APP_ORIGIN}/`).catch(() => {
    if (window !== createdWindow || createdWindow.isDestroyed()) return;
    console.error('Unable to load the packaged web app');
    app.quit();
  });
}
function createTray() {
  const image = nativeImage.createFromPath(path.join(__dirname, 'build', 'trayTemplate.png'));
  image.setTemplateImage(true);
  tray = new Tray(image);
  floatingControls.setStatus(currentStatus);
  // An attached macOS context menu can open before click handlers refresh it.
  // Build it ourselves immediately before each popup instead.
  const createdTray = tray;
  const openMenu = () => createdTray.popUpContextMenu(rebuildTrayMenu());
  tray.on('click', openMenu);
  tray.on('right-click', openMenu);
  tray.on('double-click', showWindow);
}
const timerCommands = createTimerCommands({ send: payload => {
  if (!window || window.isDestroyed() || window.webContents.isLoadingMainFrame()) return false;
  window.webContents.send('desktop:timer-request', payload);
  return true;
} });
function menuCommand(command, origin) {
  if ((!validMenuCommand(command) && !validTimerCommand(command)) || quitting) return Promise.resolve({ ok: false, reason: 'invalid-command' });
  if (command === 'stopSound') {
    native?.disarm();
    updateTimerState({ ...timerMenuState, ringing: false, sounding: false });
  }
  if (validTimerCommand(command)) return timerCommands.request(command, origin);
  if (!window || window.isDestroyed() || window.webContents.isLoadingMainFrame()) return Promise.resolve({ ok: false, reason: 'unavailable' });
  if (!['toggle', 'skip', 'reset', 'stop', 'stopSound', 'stopAndPause'].includes(command)) showWindow();
  window.webContents.send('desktop:menu-command', command);
  return Promise.resolve({ ok: true });
}
function rebuildApplicationMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate(applicationMenu({
    command: menuCommand, showWindow, closeWindow: () => { if (window && !window.isDestroyed()) window.close(); },
    toggleTimer: origin => menuCommand('toggle', origin), timerState: timerMenuState, globalStopRegistered, floatingControls, park: () => parking?.open(),
    openGitHub: () => { void shell.openExternal('https://github.com/kitestring-app/kitestring').catch(() => console.error('Unable to open GitHub')); },
  })));
}

function setMenuBarVisible(visible) {
  const version = ++trayVisibilityVersion;
  if (visible) {
    if (!tray) createTray();
  } else {
    // Dock.show() is asynchronous. Retain the tray until a recovery surface exists.
    const destroyTray = () => {
      if (version !== trayVisibilityVersion || quitting) return;
      tray?.destroy();
      tray = null;
    };
    try {
      const shown = app.dock?.show();
      if (shown?.then) void shown.then(destroyTray).catch(() => showWindow());
      else destroyTray();
    } catch { showWindow(); }
  }
  rebuildApplicationMenu();
}
function rebuildTrayMenu() {
  const login = app.getLoginItemSettings();
  const enabled = login.status === undefined ? login.openAtLogin : login.status === 'enabled';
  return Menu.buildFromTemplate([
    ...timerMenuItems(timerMenuState, menuCommand),
    { label: 'Show Kitestring', click: showWindow },
    ...floatingControls.menu(),
    { type: 'separator' },
    { label: 'Open at login', type: 'checkbox', checked: enabled,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }) },
    ...(login.status === 'requires-approval' ? [
      { label: 'Approve in System Settings → General → Login Items', enabled: false },
      { label: 'Open Login Items Settings', click: () => {
        if (isExternalURL(LOGIN_ITEMS_URL)) void shell.openExternal(LOGIN_ITEMS_URL).catch(() => console.error('Unable to open Login Items settings'));
      } },
    ] : []),
    { type: 'separator' },
    { label: 'Quit', accelerator: 'Command+Q', click: () => app.quit() },
  ]);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.on('before-quit', (event) => {
    quitting = true; changeAttention('release');
    floating?.close(); parking?.dispose(); native?.releasePower();
    quitGuard.beforeQuit(event);
  });
  app.on('will-quit', () => { clearTimeout(soundWindowTimer); if (globalStopRegistered) globalShortcut.unregister('Command+.'); parking?.dispose(); native?.dispose(); });
  app.on('activate', () => { if (window && !window.isDestroyed()) window.webContents.send('desktop:lifecycle', 'activate'); if (parking?.snapshot().capture) return; if (window && !window.isDestroyed()) showWindow(); else if (floatingControls && !quitting) createWindow(); });
  app.on('window-all-closed', () => { /* The tray or Dock keeps the app reachable. */ });
  app.whenReady().then(async () => {
    app.setName('Kitestring');
    const dns = createDns({ app, userData: app.getPath('userData') });
    await dns.apply();
    registerDns(ipcMain, trustedSender, dns);
    const ses = session.defaultSession;
    ses.protocol.handle('app', await createAppHandler(app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..', 'dist')));
    ses.webRequest.onBeforeRequest((details, callback) => {
      const foreignMainFrame = details.resourceType === 'mainFrame' && !isAppURL(details.url);
      const cancel = foreignMainFrame || shouldBlockYouTube(details.url, details.resourceType);
      if (smokeTest && details.resourceType === 'subFrame') {
        smokeFrames.push({ url: details.url, blocked: cancel });
        if (smokeFrames.length > 20) smokeFrames.shift();
      }
      callback({ cancel });
    });
    ses.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube.com/embed/*', 'https://youtube.com/embed/*'] }, (details, callback) => {
      callback({ requestHeaders: youtubeEmbedHeaders(details) });
    });
    ses.setPermissionRequestHandler((contents, permission, callback, details) => {
      callback(contents === window?.webContents && mayGrant(permission, details?.requestingUrl));
    });
    ses.setPermissionCheckHandler((contents, permission, origin, details) => {
      return (!contents || contents === window?.webContents) && mayGrant(permission, details?.requestingUrl || origin);
    });
    ses.setDevicePermissionHandler(() => false);
    banners = createBanners({ BrowserWindow, screen, getDisplays: attentionDisplays, onOpen: (display) => {
      attentionDisplay = display;
      const requestedWindow = window;
      const requestedAttention = attention;
      moveMainToDisplay(window, display, () => {
        if (window !== requestedWindow || attention !== requestedAttention || window.isDestroyed()) return;
        showWindow();
        app.focus({ steal: true });
        window.moveTop();
      });
    } });
    native = createNativeServices({ Notification, powerSaveBlocker, execFile,
      stateFile: path.join(app.getPath('userData'), 'pending-alarm.json'),
      alertsDir: app.isPackaged ? path.join(process.resourcesPath, 'web', 'alerts') : path.join(__dirname, '..', 'public', 'alerts'),
      attention: (kind) => changeAttention('attention', kind), showWindow,
      onRing: (alarm) => {
        if ((alarm.alertSound !== 'none' && alarm.volume > 0) || alarm.speak) updateTimerState({ ...timerMenuState, ringing: true, sounding: true });
      },
      onStopSound: () => menuCommand('stopSound') });
    floating = createFloating({ BrowserWindow, screen, smokeTest, nativeTheme, stateFile: path.join(app.getPath('userData'), 'floating-positions.json'),
      onChange: (open) => {
        if (quitting) return;
        if (!open && timerMenuState.hardLocked) void timerCommands.request("cancelEndHold");
        floatingControls?.opened(open);
        if (window && !window.isDestroyed()) window.webContents.send('desktop:floating-state', open);
      } });
    const sendMain = (channel, value) => { if (window && !window.isDestroyed()) window.webContents.send(channel, value); };
    floatingControls = createFloatingControls({ floating, tray: () => tray, notify: value => sendMain('desktop:floating-preferences', value),
      stateFile: path.join(app.getPath('userData'), 'menu-bar.json'), setMenuBarVisible });
    registerMenuCommands(ipcMain, trustedSender, menuCommand);
    registerFloatingControls(ipcMain, { trustedMain: trustedSender, floating, controls: floatingControls, sendMain });
    parking = createParking({ BrowserWindow, screen, globalShortcut, deliver: text => {
      if (!window || window.isDestroyed() || window.webContents.isLoadingMainFrame()) return false;
      window.webContents.send('desktop:parked', text);
      return true;
    } });
    parking.register();
    ipcMain.handle('desktop:parking-status', event => trustedSender(event) ? parking.status() : null);
    // The page's own Fullscreen API is refused by the permission handler; use the native macOS full-screen Space instead.
    ipcMain.handle('desktop:get-fullscreen', event => trustedSender(event) ? window.isFullScreen() : null);
    ipcMain.handle('desktop:toggle-fullscreen', event => {
      if (!trustedSender(event)) return null;
      return fullscreen.toggle();
    });
    ipcMain.handle('desktop:park-save', (event, text) => parking.submit(event, text));
    ipcMain.on('desktop:park-close', event => { if (parking.trusted(event)) parking.close(); });
    let suspended = false, suspensionPending = false;
    // A synchronous read sees sleep even if the overdue renderer tick beats resume IPC.
    // Keep the latch through pre-sleep reads, then consume it once after wake.
    ipcMain.on('desktop:consume-suspension', event => {
      event.returnValue = false;
      if (!trustedSender(event)) return;
      event.returnValue = suspensionPending;
      if (!suspended) suspensionPending = false;
    });
    powerMonitor.on('suspend', () => { suspended = true; suspensionPending = true; native.suspend(); });
    powerMonitor.on('resume', () => { suspended = false; native.resume(); if (window && !window.isDestroyed()) window.webContents.send('desktop:lifecycle', 'resume'); });
    const cloud = createCloud({ origin: CLOUD_ORIGIN, fallbackOrigin: LEGACY_CLOUD_ORIGIN, userData: app.getPath('userData'), safeStorage });
    registerCloud(ipcMain, trustedSender, cloud, () => shell.openExternal(CLOUD_ORIGIN + '/account/reset/').then(() => true).catch(() => false));
    ipcMain.handle('desktop:arm-alarm', (event, alarm) => trustedSender(event) ? native.arm(alarm) : false);
    ipcMain.on('desktop:disarm-alarm', (event) => { if (trustedSender(event)) { native.disarm(); updateTimerState({ ...timerMenuState, sounding: false }); } });
    ipcMain.on('desktop:cancel-speech', (event) => { if (trustedSender(event)) native.cancelSpeech(); });
    ipcMain.handle('desktop:speak', (event, input) => trustedSender(event) ? native.speak(input) : false);
    ipcMain.handle('desktop:notification-status', (event) => trustedSender(event) ? native.notificationStatus() : null);
    ipcMain.on('desktop:prevent-sleep', (event, enabled) => { if (trustedSender(event) && typeof enabled === 'boolean') native.preventSleep(enabled); });
    ipcMain.handle('desktop:float-timer', (event, enabled) => {
      if (typeof enabled !== 'boolean' || !(trustedSender(event) || (enabled === false && floating.trusted(event)))) return false;
      return floatingControls.change({ floatingTimer: enabled });
    });
    ipcMain.on('desktop:show-main', (event) => { if (floating.trusted(event)) { showWindow(); app.focus({ steal: true }); window.moveTop(); } });
    ipcMain.handle('desktop:timer-control', (event, action) => {
      if (!floating.trusted(event) || !(validTimerCommand(action) || action === 'endSession')) return { ok: false, reason: 'invalid-command' };
      return menuCommand(action);
    });
    ipcMain.on('desktop:timer-result', (event, id, result) => { if (trustedSender(event)) timerCommands.reply(id, result); });
    ipcMain.on('desktop:timer-state', (event, value) => {
      if (trustedSender(event) && validTimerState(value)) updateTimerState(value);
    });
    ipcMain.on('desktop:timer-state-request', event => {
      if (floating.trusted(event)) floating.send('desktop:timer-state', timerMenuState);
    });
    ipcMain.on('desktop:flushed', (event, id) => { if (trustedSender(event)) quitGuard.acknowledge(id); });
    ipcMain.on('desktop:banner-open', (event) => banners.open(event));
    ipcMain.on('desktop:status', (event, text) => {
      if (!trustedSender(event)) return;
      const status = statusText(text);
      if (status !== null) { currentStatus = status; floatingControls.setStatus(status); }
    });
    ipcMain.on('desktop:attention', (event, kind) => {
      if (trustedSender(event)) changeAttention('attention', kind);
    });
    ipcMain.on('desktop:release', (event) => {
      if (trustedSender(event)) changeAttention('release');
    });
    // Settings > Alerts: fire the real notification and the banners on other displays, then let go after 6 s.
    let testRelease = null;
    ipcMain.handle('desktop:test-reminder', (event) => {
      if (!trustedSender(event)) return null;
      // Its own path: no alarm, no attention state, no rate limit, so it can never swallow or release a real reminder.
      const status = native.notificationStatus();
      native.testReminder('focus-done');
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      if (attention.releaseAt === null) {
        banners?.start('focus-done', display.id);
        clearTimeout(testRelease);
        testRelease = setTimeout(() => { if (attention.releaseAt === null) banners?.stop(); }, 6000);
      }
      return { ...status, displays: screen.getAllDisplays().length };
    });
    if (smokeTest) ipcMain.handle('desktop:smoke-diagnostics', event => {
      if (!trustedSender(event)) return null;
      const now = performance.now();
      return { now, attention, cooldownRemainingMs: attention.lastAcceptedAt === null ? 0 :
        Math.max(0, RATE_LIMIT_MS - (now - attention.lastAcceptedAt)), events: [...smokeAttention] };
    });
    if (smokeTest) ipcMain.on('desktop:smoke-focus', event => { if (trustedSender(event)) showWindow(); });
    if (smokeTest) ipcMain.on('desktop:smoke-park', event => { if (trustedSender(event)) parking.open(); });
    if (smokeTest) ipcMain.on('desktop:smoke-quit', (event) => {
      if (trustedSender(event)) app.quit();
    });
    if (smokeTest) ipcMain.on('desktop:smoke-close', (event) => {
      if (trustedSender(event)) window.close();
    });
    if (smokeTest) ipcMain.on('desktop:smoke-state', (event) => {
      if (!trustedSender(event)) { event.returnValue = null; return; }
      event.returnValue = { visible: window.isVisible(), alwaysOnTop: window.isAlwaysOnTop(),
        allWorkspaces: window.isVisibleOnAllWorkspaces(), attentionActive: attention.releaseAt !== null,
        bounceActive: bounceId !== null, displayCount: attentionDisplays().length,
        simulatedDisplay: extraSmokeDisplay, simulatedSingleDisplay: singleSmokeDisplay, bounds: window.getBounds(),
        attentionWorkArea: attentionDisplay?.workArea ?? null,
        focused: window.isFocused(), parking: parking.snapshot(), floating: floating.snapshot(), native: native.snapshot(), fullscreen: window.isFullScreen(), status: currentStatus, banners: banners.snapshot(), frames: [...smokeFrames] };
    });
    floatingControls.restoreMenuBar();
    createWindow();
    native.restore();
  }).catch((error) => { console.error(error); app.quit(); });
}
