const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
let window;
let tray;
let applicationMenu;
let finishDockShow;
let app;
let session;
let ipc;
let schemes;
let resolver;
let external;
let screen;
let userData;
let profileRoot;
let powerMonitor;
const shortcuts = new Map();
const activePower = new Set();
const powerStarts = [];
const powerStops = [];
const nativeProcesses = [];
const nativeNotifications = [];
const bannerWindows = [];
const miniWindows = [];
const mainDisplay = { id: 1, workArea: { x: 0, y: 25, width: 1440, height: 875 } };
const extraDisplay = { id: 2, workArea: { x: -1920, y: -1080, width: 1920, height: 1040 } };
let now = 0;
let loginAtStartup = false;
let loginStatus;
const timers = new Map();
let nextTimer = 0;
class FakeWindow extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.bounds = { x: options.x ?? 0, y: options.y ?? 0, width: options.width, height: options.height };
    this.visible = false;
    this.webContents = new EventEmitter();
    Object.assign(this.webContents, {
      mainFrame: { url: 'app://custom-pomodoro/' },
      isLoadingMainFrame: () => false,
      setWindowOpenHandler: (handler) => { this.openHandler = handler; },
      send: (channel, ...args) => { this.sent = channel; this.sentArgs = args; },
      sendInputEvent: (event) => { (this.keys ||= []).push(event); },
      focus: () => { (this.presentationCalls ||= []).push('webContents.focus'); },
    });
    if (options.webPreferences.additionalArguments?.includes('--mini-timer')) miniWindows.push(this);
    else if (options.frame === false) bannerWindows.push(this);
    else window = this;
  }
  loadURL(url) { this.url = url; this.webContents.mainFrame.url = url; return Promise.resolve(); }
  destroy() { this.destroyed = true; this.emit('closed'); }
  close() {
    let prevented = false;
    this.emit('close', { preventDefault: () => { prevented = true; } });
    if (!prevented) this.destroy();
  }
  isDestroyed() { return !!this.destroyed; }
  isVisible() { return this.visible; }
  showInactive() { this.visible = true; (this.presentationCalls ||= []).push('showInactive'); }
  isMaximized() { return false; }
  isFullScreen() { return !!this.fullscreen; }
  setFullScreen(value) { this.fullscreen = value; }
  getNormalBounds() { return { width: 1280, height: 820 }; }
  getBounds() { return { ...this.bounds }; }
  setMinimumSize() {}
  setBounds(bounds) { this.bounds = bounds; }
  isMinimized() { return !!this.minimized; }
  restore() { this.minimized = false; (this.presentationCalls ||= []).push('restore'); }
  show() { this.visible = true; (this.presentationCalls ||= []).push('show'); }
  hide() { this.visible = false; this.emit('hide'); }
  setAlwaysOnTop(value, level) { this.onTop = value; this.level = level; }
  setVisibleOnAllWorkspaces(value, options) { this.allWorkspaces = value; this.workspaceOptions = options; }
  moveTop() { this.movedTop = true; (this.presentationCalls ||= []).push('moveTop'); }
  focus() { (this.presentationCalls ||= []).push('focus'); }
}
class FakeTray extends EventEmitter {
  constructor() { super(); tray = this; }
  setTitle(text) { this.title = text; }
  setToolTip(value) { this.tooltip = value; }
  destroy() { assert.equal(app.dockVisible, true); this.destroyed = true; }
  popUpContextMenu(menu) { this.menu = menu; this.popups = (this.popups || 0) + 1; }
}
before(async () => {
  profileRoot = mkdtempSync(path.join(tmpdir(), 'pomodoro-lifecycle-'));
  userData = path.join(profileRoot, 'Kitestring');
  app = new EventEmitter();
  Object.assign(app, {
    commandLine: { hasSwitch: () => false }, setAppUserModelId: () => {},
    setName: name => { app.name = name; }, setPath: (name, value) => { assert.equal(name, 'userData'); userData = value; },
    requestSingleInstanceLock: () => true, whenReady: () => {
      app.emit('activate');
      assert.equal(window, undefined, 'Activation before startup must not create a main window');
      return Promise.resolve();
    },
    configureHostResolver: (options) => { assert.equal(window, undefined); resolver = options; },
    getLoginItemSettings: () => ({ openAtLogin: loginAtStartup, status: loginStatus }),
    getPath: (name) => name === 'appData' ? profileRoot : userData,
    focus: (options) => { app.focusOptions = options; app.focusCalls = (app.focusCalls ?? 0) + 1; },
    dock: { show: () => { app.dockShows = (app.dockShows ?? 0) + 1; if (finishDockShow) return finishDockShow(); app.dockVisible = true; return Promise.resolve(); }, bounce: (kind) => { app.bounceKind = kind; return ++app.bounces; }, cancelBounce: (id) => { app.cancelledBounce = id; } },
    bounces: 0,
    setLoginItemSettings: (options) => { app.login = options; },
    quit: () => {
      app.quitAttempts = (app.quitAttempts ?? 0) + 1;
      let prevented = false;
      app.emit('before-quit', { preventDefault: () => { prevented = true; } });
      app.lastQuitPrevented = prevented;
      if (!prevented) { app.quitCalled = true; app.emit('will-quit'); }
    },
  });
  session = {
    protocol: { handle: () => {} }, webRequest: {
      onBeforeRequest: (fn) => { session.request = fn; },
      onBeforeSendHeaders: (filter, fn) => { session.headerFilter = filter; session.headers = fn; },
    },
    setPermissionRequestHandler: (fn) => { session.permission = fn; },
    setPermissionCheckHandler: (fn) => { session.check = fn; }, setDevicePermissionHandler: () => {},
  };
  ipc = new EventEmitter();
  ipc.handlers = new Map();
  ipc.handle = (channel, handler) => { assert.equal(ipc.handlers.has(channel), false); ipc.handlers.set(channel, handler); };
  ipc.invoke = (channel, ...args) => { assert.ok(ipc.handlers.has(channel), `registered ${channel}`); return ipc.handlers.get(channel)(...args); };
  screen = new EventEmitter();
  screen.getAllDisplays = () => screen.displays;
  screen.displays = [mainDisplay, extraDisplay];
  screen.getCursorScreenPoint = () => ({ x: 20, y: 40 });
  screen.getDisplayNearestPoint = (point) => { assert.deepEqual(point, { x: 20, y: 40 }); return mainDisplay; };
  screen.getDisplayMatching = () => mainDisplay;
  powerMonitor = new EventEmitter();
  class Notification extends EventEmitter {
    static isSupported() { return true; }
    constructor(options) { super(); this.options = options; nativeNotifications.push(this); }
    show() { this.shown = true; }
    close() { this.closed = true; }
  }
  const electron = {
    app, screen, BrowserWindow: FakeWindow, ipcMain: ipc, Menu: { buildFromTemplate: (items) => items, setApplicationMenu: (menu) => { applicationMenu = menu; } },
    nativeImage: { createFromPath: () => ({ setTemplateImage: () => {} }) },
    protocol: { registerSchemesAsPrivileged: (items) => { schemes = items; } },
    session: { defaultSession: session }, shell: { openExternal: async (url) => { external = url; } }, Tray: FakeTray,
    Notification, powerMonitor,
    globalShortcut: { register: (key, fn) => { shortcuts.set(key, fn); return true; }, unregister: key => shortcuts.delete(key) },
    powerSaveBlocker: {
      start(type) { const id = powerStarts.length; powerStarts.push(type); activePower.add(id); return id; },
      stop(id) { powerStops.push(id); activePower.delete(id); },
      isStarted: (id) => activePower.has(id),
    },
  };
  const load = Module._load;
  Module._load = function (id, parent, isMain) {
    if (id === 'electron') return electron;
    if (id === 'node:child_process' && parent?.filename.endsWith('/main.cjs')) return {
      execFile: (file, args, done) => {
        const child = { file, args, done, killed: false, kill() { this.killed = true; } };
        nativeProcesses.push(child);
        return child;
      },
    };
    if (id === './native-services.cjs' && parent?.filename.endsWith('/main.cjs')) {
      const native = load.call(this, id, parent, isMain);
      return { ...native, createNativeServices: options => native.createNativeServices({ ...options, now: () => Date.now() }) };
    }
    if (id === './protocol.cjs' && parent?.filename.endsWith('/main.cjs')) return { createAppHandler: async () => () => {} };
    return load.call(this, id, parent, isMain);
  };
  try {
    const vm = require('node:vm');
    const { readFileSync } = require('node:fs');
    const mainPath = require.resolve('../main.cjs');
    vm.runInThisContext(`(function(require, __dirname, performance, setTimeout, clearTimeout) {${readFileSync(mainPath, 'utf8')}\n})`, { filename: mainPath })(
      Module.createRequire(mainPath), require('node:path').dirname(mainPath), { now: () => now },
      (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, at: now + ms }); return id; },
      (id) => timers.delete(id),
    );
  } finally { Module._load = load; }
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(window);
  tray.emit('click');
});
after(() => { if (profileRoot) rmSync(profileRoot, { recursive: true, force: true }); });
const event = () => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
test('registers privileges, strict DNS and the hardened renderer before loading local content', () => {
  assert.deepEqual(schemes[0].privileges, { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true });
  assert.deepEqual(resolver, { secureDnsMode: 'off' });
  assert.equal(app.name, 'Kitestring');
  assert.equal(window.url, 'app://custom-pomodoro/');
  for (const key of ['contextIsolation', 'sandbox', 'webSecurity']) assert.equal(window.options.webPreferences[key], true);
  assert.equal(window.options.webPreferences.nodeIntegration, false);
  assert.equal(window.options.webPreferences.backgroundThrottling, false);
  assert.equal(Object.hasOwn(window.options, 'acceptFirstMouse'), false);
});
test('repeated Dock activation retains exactly the existing main window', () => {
  const original = window;
  app.emit('activate'); app.emit('activate');
  assert.equal(window, original);
});
test('standard menu restores a hidden main window and sends validated commands', () => {
  window.hide();
  applicationMenu[0].submenu.find(item => item.label === 'Settings…').click();
  assert.equal(window.visible, true);
  assert.equal(window.sent, 'desktop:menu-command');
  assert.deepEqual(window.sentArgs, ['settings']);
  ipc.emit('desktop:menu-command', event(), 'home');
  assert.deepEqual(window.sentArgs, ['home']);
  ipc.emit('desktop:menu-command', event(), 'unknown');
  ipc.emit('desktop:menu-command', { sender: window.webContents, senderFrame: { url: window.url } }, 'settings');
  assert.deepEqual(window.sentArgs, ['home']);
  const windowMenu = applicationMenu.find(item => item.label === 'Window').submenu;
  windowMenu.find(item => item.label === 'Close').click();
  assert.equal(window.visible, false);
  assert.equal(window.isDestroyed(), false);
  assert.equal(app.quitCalled, undefined);
  applicationMenu.find(item => item.role === 'help').submenu.find(item => item.label === 'Kitestring on GitHub').click();
  assert.equal(external, 'https://github.com/kitestring-app/kitestring');
});
test('native menu toggles directly without opening the app, with reshow/close, login and verified status IPC', () => {
  const item = (label) => tray.menu.find((entry) => entry.label === label);
  item('Show Kitestring').click();
  assert.equal(window.visible, true);
  let prevented = false;
  window.emit('close', { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(window.visible, false);
  app.emit('activate');
  assert.equal(window.visible, true);
  window.hide();
  item('Start').click();
  assert.equal(window.sent, 'desktop:timer-request');
  assert.equal(window.sentArgs[0].command, 'toggle');
  ipc.emit('desktop:timer-result', event(), window.sentArgs[0].id, { ok: true });
  assert.equal(window.visible, false);
  ipc.emit('desktop:status', event(), '25:00 · Focus');
  assert.equal(tray.title, '25:00 · Focus');
  ipc.emit('desktop:status', { sender: window.webContents, senderFrame: { url: 'https://evil.test' } }, 'evil');
  assert.equal(tray.title, '25:00 · Focus');
  item('Open at login').click({ checked: true });
  assert.deepEqual(app.login, { openAtLogin: true });
});
test('actual tray checkboxes mirror validated preferences and apply to an open mini', () => {
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  assert.equal(ipc.invoke('desktop:floating-preferences', event, { floatingTimer: true, floatingOnTop: false, menuBarTime: false, showMenuBar: true }), true);
  tray.emit('click');
  const labels = ['Floating timer', 'Keep floating timer on top', 'Show time in menu bar'];
  const items = labels.map(label => tray.menu.find(item => item.label === label));
  assert.deepEqual(items.map(item => [item.type, item.checked]), [['checkbox', true], ['checkbox', false], ['checkbox', false]]);
  const mini = miniWindows.at(-1), count = miniWindows.length;
  assert.equal(mini.onTop, false);
  assert.equal(mini.allWorkspaces, true);
  items[1].click({ checked: true });
  assert.equal(mini.onTop, true);
  assert.equal(miniWindows.length, count);
  assert.equal(window.sent, 'desktop:floating-preferences');
  assert.deepEqual(window.sentArgs[0], { floatingTimer: true, floatingOnTop: true, menuBarTime: false, showMenuBar: true });
  ipc.emit('desktop:status', event, 'Focus 20:00');
  assert.equal(tray.title, '');
  items[2].click({ checked: true });
  assert.equal(tray.title, 'Focus 20:00');
  ipc.invoke('desktop:floating-preferences', event, { floatingTimer: false, floatingOnTop: true, menuBarTime: true, showMenuBar: true });
});


test('navigation, popups and permission callbacks enforce the origin boundary', () => {
  let prevented = false;
  window.webContents.emit('will-navigate', { preventDefault: () => { prevented = true; } }, 'https://example.org');
  assert.equal(prevented, true);
  assert.deepEqual(window.openHandler({ url: 'https://example.org' }), { action: 'deny' });
  assert.equal(external, 'https://example.org');
  window.openHandler({ url: 'file:///etc/passwd' });
  assert.equal(external, 'https://example.org');
  for (const [url, type, expected] of [['https://www.youtube.com/', 'mainFrame', true], ['https://www.youtube.com/embed/jfKfPfyJRdk', 'subFrame', false], ['https://example.org/', 'mainFrame', true]]) {
    session.request({ url, resourceType: type }, ({ cancel }) => assert.equal(cancel, expected));
  }
  for (const [origin, expected] of [['app://custom-pomodoro/', true], ['https://www.youtube.com/', false]]) {
    session.permission(window.webContents, 'notifications', (result) => assert.equal(result, expected), { requestingUrl: origin });
    assert.equal(session.check(window.webContents, 'notifications', origin, {}), expected);
  }
});
const advance = (ms) => {
  now += ms;
  for (const [id, timer] of [...timers]) {
    if (timer.at <= now) { timers.delete(id); timer.fn(); }
  }
};

test('test reminder shows only six-second banners without raising or focusing the dashboard', async () => {
  window.hide();
  // Fullscreen toggle answers with the state it is moving to, and ignores untrusted senders.
  assert.equal(ipc.invoke('desktop:toggle-fullscreen', { sender: window.webContents, senderFrame: { url: window.url } }), null);
  assert.equal(window.isFullScreen(), false);
  assert.equal(ipc.invoke('desktop:toggle-fullscreen', event()), true);
  assert.equal(window.isFullScreen(), true);
  window.emit('will-enter-full-screen'); window.emit('enter-full-screen');
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(ipc.invoke('desktop:toggle-fullscreen', event()), false);
  assert.equal(window.isFullScreen(), false);
  window.emit('will-leave-full-screen'); window.emit('leave-full-screen');
  await new Promise(resolve => setTimeout(resolve, 80));
  window.presentationCalls = [];
  const focusCalls = app.focusCalls ?? 0, bounces = app.bounces;
  const onTop = window.onTop;
  const bannerCount = bannerWindows.length, notificationCount = nativeNotifications.length;
  assert.equal(ipc.invoke('desktop:test-reminder', { sender: window.webContents, senderFrame: { url: window.url } }), null);
  assert.equal(bannerWindows.length, bannerCount);
  assert.equal(nativeNotifications.length, notificationCount);
  assert.deepEqual(ipc.invoke('desktop:test-reminder', event()), { supported: true, failed: false, displays: 2 });
  const banner = bannerWindows.at(-1);
  assert.equal(bannerWindows.length, bannerCount + 1);
  assert.deepEqual(nativeNotifications.at(-1).options.actions, []);
  assert.equal(nativeNotifications.at(-1).shown, true);
  advance(5999);
  assert.equal(banner.isDestroyed(), false);
  advance(1);
  assert.equal(banner.isDestroyed(), true);
  assert.equal(window.visible, false);
  assert.equal(window.onTop, onTop);
  assert.deepEqual(window.presentationCalls, []);
  assert.equal(app.focusCalls ?? 0, focusCalls);
  assert.equal(app.bounces, bounces);
  assert.equal(nativeProcesses.length, 0);
});

test('test reminders neither consume the attention rate limit nor replace or release real attention', () => {
  ipc.invoke('desktop:test-reminder', event());
  const preview = bannerWindows.at(-1);
  const bounces = app.bounces;
  ipc.emit('desktop:attention', event(), 'break-over');
  assert.equal(app.bounces, bounces + 1, 'a preview must not consume the real reminder cooldown');
  assert.equal(preview.isDestroyed(), true);
  const realBanner = bannerWindows.at(-1), count = bannerWindows.length;
  advance(5999);
  ipc.invoke('desktop:test-reminder', event());
  assert.equal(bannerWindows.length, count, 'an active reminder keeps its banners');
  advance(1);
  assert.equal(realBanner.isDestroyed(), false, 'the preview timeout cannot release real attention');
  assert.equal(window.onTop, true);
  advance(113999);
  assert.equal(realBanner.isDestroyed(), false);
  advance(1);
  assert.equal(realBanner.isDestroyed(), true, 'tests must not extend the real attention deadline');
  assert.equal(window.onTop, false);
  ipc.emit('desktop:attention', event(), 'focus-done');
  const acceptedBounces = app.bounces;
  ipc.emit('desktop:release', event());
  advance(10000);
  ipc.invoke('desktop:test-reminder', event());
  advance(34999);
  ipc.emit('desktop:attention', event(), 'break-over');
  assert.equal(app.bounces, acceptedBounces, 'a preview cannot clear an existing cooldown');
  advance(1);
  ipc.emit('desktop:attention', event(), 'break-over');
  assert.equal(app.bounces, acceptedBounces + 1, 'a preview cannot restart an existing cooldown');
  ipc.emit('desktop:release', event());
  advance(45000);
});

test('attention restores and floats only for trusted main-frame requests without stealing keyboard focus, then releases', () => {
  window.hide();
  window.minimized = true;
  window.presentationCalls = [];
  const focusCalls = app.focusCalls ?? 0;
  const foreign = { sender: window.webContents, senderFrame: { url: 'app://custom-pomodoro/' } };
  ipc.emit('desktop:attention', foreign, 'focus-done');
  ipc.emit('desktop:attention', event(), 'bogus');
  assert.equal(window.visible, false);
  assert.deepEqual(window.presentationCalls, []);
  ipc.emit('desktop:attention', event(), 'focus-done');
  assert.equal(window.visible, true);
  assert.equal(window.minimized, false);
  assert.deepEqual(window.bounds, { x: 80, y: 52, width: 1280, height: 820 });
  assert.equal(bannerWindows.filter((banner) => !banner.isDestroyed()).length, 1);
  const firstBanner = bannerWindows.at(-1);
  assert.equal(window.onTop, true);
  assert.equal(window.level, 'floating');
  assert.equal(window.allWorkspaces, true);
  assert.deepEqual(window.workspaceOptions, { visibleOnFullScreen: true, skipTransformProcessType: true });
  assert.deepEqual(window.presentationCalls, ['restore', 'showInactive', 'moveTop']);
  assert.equal(app.focusCalls ?? 0, focusCalls);
  assert.equal(window.movedTop, true);
  assert.equal(app.bounceKind, 'critical');
  const bounce = app.bounces;
  ipc.emit('desktop:attention', event(), 'break-over');
  assert.equal(app.bounces, bounce);
  ipc.emit('desktop:release', foreign);
  assert.equal(window.onTop, true);
  ipc.emit('desktop:release', event());
  assert.equal(window.onTop, false);
  assert.equal(window.allWorkspaces, false);
  assert.equal(firstBanner.isDestroyed(), true);
  assert.equal(app.cancelledBounce, bounce);
  advance(44999);
  ipc.emit('desktop:attention', event(), 'break-over');
  assert.equal(window.onTop, false, 'Release must not reset the cooldown');
  advance(1);
  window.presentationCalls = [];
  ipc.emit('desktop:attention', event(), 'break-over');
  assert.equal(window.onTop, true);
  assert.deepEqual(window.presentationCalls, ['moveTop'], 'Visible windows are raised without showing or focusing again');
  assert.equal(app.focusCalls ?? 0, focusCalls);
  const refreshedBanner = bannerWindows.at(-1);
  advance(60000);
  ipc.emit('desktop:attention', event(), 'focus-done');
  assert.equal(app.bounces, bounce + 2, 'The next eligible segment refreshes attention');
  assert.equal(refreshedBanner.isDestroyed(), true, 'New attention replaces banners');
  const hiddenBanner = bannerWindows.at(-1);
  window.hide();
  assert.equal(hiddenBanner.isDestroyed(), true);
  assert.equal(window.onTop, false);
  assert.equal(window.allWorkspaces, false);
  advance(45000);
  window.presentationCalls = [];
  ipc.emit('desktop:attention', event(), 'focus-done');
  assert.equal(window.visible, true, 'The next eligible segment can raise a hidden window');
  assert.deepEqual(window.presentationCalls, ['showInactive', 'moveTop']);
  assert.equal(app.focusCalls ?? 0, focusCalls);
  const timedBanner = bannerWindows.at(-1);
  advance(120000);
  assert.equal(timedBanner.isDestroyed(), true);
  assert.equal(window.onTop, false);
  assert.equal(window.allWorkspaces, false);
});

test('a banner click moves and focuses the dashboard on that banner display and destroys all banners', () => {
  ipc.emit('desktop:attention', event(), 'break-over');
  const banner = bannerWindows.at(-1);
  banner.emit('ready-to-show');
  ipc.emit('desktop:banner-open', { sender: window.webContents, senderFrame: window.webContents.mainFrame });
  assert.equal(banner.isDestroyed(), false, 'The main renderer cannot impersonate a banner');
  ipc.emit('desktop:banner-open', { sender: banner.webContents, senderFrame: banner.webContents.mainFrame });
  assert.deepEqual(window.bounds, { x: -1600, y: -970, width: 1280, height: 820 });
  assert.equal(window.visible, true);
  assert.equal(banner.isDestroyed(), true);
  assert.equal(screen.listenerCount('display-added'), 0);
  ipc.emit('desktop:release', event());
});

test('tray controls dispatch each action directly without simulated Space or focus changes', () => {
  const toggle = tray.menu.find(entry => entry.label === 'Start').click;
  window.hide();
  toggle(); toggle();
  assert.equal(window.sent, 'desktop:timer-request');
  assert.equal(window.sentArgs[0].command, 'toggle');
  ipc.emit('desktop:timer-result', event(), window.sentArgs[0].id, { ok: true });
  assert.equal(window.keys, undefined);
  assert.equal(window.visible, false);
});

test('a timeout that fires slightly early is rescheduled until the release deadline', () => {
  advance(45000);
  ipc.emit('desktop:attention', event(), 'focus-done');
  const [id, timer] = [...timers].find(([, value]) => value.at === now + 120000);
  timers.delete(id);
  now = timer.at - 0.5;
  timer.fn();
  assert.equal(window.onTop, true);
  assert.ok(timers.size > 0, 'The release must still have a scheduled timer');
  advance(1);
  assert.equal(window.onTop, false);
});

test('attention waits for full-screen exit before showing and cannot reshow after release', () => {
  for (const releaseBeforeExit of [false, true]) {
    advance(45000);
    window.fullscreen = true;
    window.visible = false;
    window.presentationCalls = [];
    const focusCalls = app.focusCalls ?? 0;
    ipc.emit('desktop:attention', event(), 'focus-done');
    assert.equal(window.fullscreen, false);
    assert.equal(window.visible, false);
    assert.deepEqual(window.presentationCalls, []);
    assert.equal(app.focusCalls ?? 0, focusCalls);
    assert.equal(bannerWindows.filter((banner) => !banner.isDestroyed()).length, 0);
    if (releaseBeforeExit) ipc.emit('desktop:release', event());
    window.emit('leave-full-screen');
    assert.equal(window.visible, !releaseBeforeExit);
    assert.deepEqual(window.presentationCalls, releaseBeforeExit ? [] : ['showInactive', 'moveTop']);
    assert.equal(app.focusCalls ?? 0, focusCalls);
    assert.equal(bannerWindows.filter((banner) => !banner.isDestroyed()).length, releaseBeforeExit ? 0 : 1);
    ipc.emit('desktop:release', event());
  }
});

test('refreshes login state when either tray menu opens', () => {
  for (const event of ['click', 'right-click']) {
    loginAtStartup = !loginAtStartup;
    tray.emit(event);
    assert.equal(tray.menu.find((entry) => entry.label === 'Open at login').checked, loginAtStartup);
  }
});

test('empty permission URLs fall back to the requesting origin, never an embedding origin', () => {
  assert.equal(session.check(window.webContents, 'notifications', 'app://custom-pomodoro', { requestingUrl: '' }), true);
  assert.equal(session.check(window.webContents, 'notifications', 'https://evil.test', { requestingUrl: '', embeddingOrigin: 'app://custom-pomodoro' }), false);
  assert.equal(session.check(window.webContents, 'notifications', 'app://custom-pomodoro', { requestingUrl: 'https://evil.test' }), false);
  assert.equal(session.check({}, 'notifications', 'app://custom-pomodoro', { requestingUrl: '' }), false);
  assert.equal(ipc.listenerCount('desktop:smoke-state'), 0, 'Normal launches have no debug IPC');
  assert.equal(ipc.listenerCount('desktop:smoke-close'), 0, 'Normal launches cannot use smoke close IPC');
});

test('login approval state overrides registration and is rebuilt before every popup', () => {
  const checkbox = () => tray.menu.find((entry) => entry.label === 'Open at login');
  for (const status of ['enabled', 'requires-approval', 'not-registered', 'not-found']) {
    loginStatus = status;
    loginAtStartup = status !== 'enabled';
    const previous = tray.menu;
    const popups = tray.popups;
    tray.emit('right-click');
    assert.notEqual(tray.menu, previous);
    assert.equal(tray.popups, popups + 1);
    assert.equal(checkbox().checked, status === 'enabled');
    const explanation = tray.menu.find((entry) => entry.label === 'Approve in System Settings → General → Login Items');
    const open = tray.menu.find((entry) => entry.label === 'Open Login Items Settings');
    if (status === 'requires-approval') {
      assert.equal(explanation.enabled, false);
      open.click();
      assert.equal(external, 'x-apple.systempreferences:com.apple.LoginItems-Settings.extension');
    } else {
      assert.equal(explanation, undefined);
      assert.equal(open, undefined);
    }
  }
  loginStatus = undefined;
});

test('native alarm and speech handlers require the exact trusted main frame', () => {
  const input = { at: Date.now() + 120_000, kind: 'focus-done', volume: 0, speak: false, notify: false, attention: false };
  const foreign = [
    { sender: {}, senderFrame: window.webContents.mainFrame },
    { sender: window.webContents, senderFrame: { url: 'app://custom-pomodoro/' } },
    { sender: window.webContents, senderFrame: { url: 'https://evil.test/' } },
  ];
  const savedAlarm = () => JSON.parse(readFileSync(path.join(userData, 'pending-alarm.json'), 'utf8'));
  for (const sender of foreign) {
    assert.equal(ipc.invoke('desktop:arm-alarm', sender, input), false);
    assert.equal(ipc.invoke('desktop:speak', sender, { kind: 'focus-done' }), false);
    assert.equal(ipc.invoke('desktop:notification-status', sender), null);
  }
  assert.equal(nativeProcesses.length, 0);
  assert.equal(savedAlarm(), null);
  assert.equal(ipc.invoke('desktop:arm-alarm', event(), { ...input, kind: '../escape' }), false);
  assert.equal(ipc.invoke('desktop:arm-alarm', event(), input), true);
  for (const sender of foreign) ipc.emit('desktop:disarm-alarm', sender);
  assert.equal(savedAlarm().at, input.at);
  assert.deepEqual(ipc.invoke('desktop:notification-status', event()), { supported: true, failed: false });
  assert.equal(ipc.invoke('desktop:speak', event(), { kind: 'focus-done' }), true);
  const spoken = nativeProcesses.at(-1);
  assert.deepEqual([spoken.file, spoken.args], ['/usr/bin/say', ['Focus session done. Time for a break.']]);
  for (const sender of foreign) ipc.emit('desktop:cancel-speech', sender);
  assert.equal(spoken.killed, false);
  ipc.emit('desktop:cancel-speech', event());
  assert.equal(spoken.killed, true);
  ipc.emit('desktop:disarm-alarm', event());
  assert.equal(savedAlarm(), null);
});

test('prevent sleep rejects foreign senders and releases on main-frame navigation', () => {
  const initialStarts = powerStarts.length;
  ipc.emit('desktop:prevent-sleep', { sender: window.webContents, senderFrame: { url: 'app://custom-pomodoro/' } }, true);
  ipc.emit('desktop:prevent-sleep', event(), 'true');
  assert.equal(powerStarts.length, initialStarts);
  ipc.emit('desktop:prevent-sleep', event(), true);
  ipc.emit('desktop:prevent-sleep', event(), true);
  assert.equal(powerStarts.length, initialStarts + 1);
  assert.equal(powerStarts.at(-1), 'prevent-display-sleep');
  assert.equal(activePower.size, 1);
  window.webContents.emit('did-start-navigation', {}, 'app://custom-pomodoro/', false, false);
  assert.equal(activePower.size, 1, 'Subframe activity must not release the main renderer blocker');
  window.webContents.emit('did-start-navigation', {}, 'app://custom-pomodoro/', false, true);
  assert.equal(activePower.size, 0);
  ipc.emit('desktop:prevent-sleep', event(), false);
  assert.equal(powerStops.length, initialStarts + 1);
  assert.equal(powerMonitor.listenerCount('resume'), 1);
});

test('floating IPC isolates mini controls from native powers and permits only its own close', () => {
  const count = miniWindows.length;
  const foreign = { sender: window.webContents, senderFrame: { url: 'app://custom-pomodoro/' } };
  assert.equal(ipc.invoke('desktop:float-timer', foreign, true), false);
  assert.equal(ipc.invoke('desktop:float-timer', event(), 'true'), false);
  assert.equal(miniWindows.length, count);
  assert.equal(ipc.invoke('desktop:float-timer', event(), true), true);
  const mini = miniWindows.at(-1);
  const miniEvent = { sender: mini.webContents, senderFrame: mini.webContents.mainFrame };
  assert.equal(ipc.invoke('desktop:float-timer', event(), true), true);
  assert.equal(miniWindows.length, count + 1);
  assert.equal(mini.url, 'app://custom-pomodoro/?mini=1');
  assert.equal(mini.options.webPreferences.sandbox, true);
  assert.equal(mini.options.webPreferences.contextIsolation, true);
  assert.equal(mini.options.webPreferences.nodeIntegration, false);
  assert.deepEqual(mini.workspaceOptions, { visibleOnFullScreen: true, skipTransformProcessType: true });
  assert.equal(ipc.invoke('desktop:arm-alarm', miniEvent, { at: Date.now() + 120_000, kind: 'focus-done', volume: 0, speak: false }), false);
  assert.equal(ipc.invoke('desktop:speak', miniEvent, { kind: 'focus-done' }), false);
  assert.equal(ipc.invoke('desktop:notification-status', miniEvent), null);
  assert.equal(ipc.invoke('desktop:float-timer', miniEvent, true), false);
  const title = tray.title;
  const starts = powerStarts.length;
  ipc.emit('desktop:status', miniEvent, 'Impersonating main');
  ipc.emit('desktop:prevent-sleep', miniEvent, true);
  assert.equal(tray.title, title);
  assert.equal(powerStarts.length, starts);
  window.hide();
  ipc.emit('desktop:show-main', event());
  assert.equal(window.visible, false);
  ipc.emit('desktop:show-main', miniEvent);
  assert.equal(window.visible, true);
  window.sent = 'unchanged';
  ipc.invoke('desktop:timer-control', event(), 'toggle');
  ipc.invoke('desktop:timer-control', miniEvent, 'invalid');
  assert.equal(window.sent, 'unchanged');
  for (const action of ['toggle', 'skip', 'stopSound', 'stopAndPause', 'stop']) {
    ipc.invoke('desktop:timer-control', miniEvent, action);
    assert.equal(window.sent, 'desktop:timer-request');
    assert.equal(window.sentArgs[0].command, action);
    ipc.emit('desktop:timer-result', event(), window.sentArgs[0].id, { ok: true });
  }
  assert.equal(ipc.invoke('desktop:float-timer', foreign, false), false);
  assert.equal(mini.isDestroyed(), false);
  assert.equal(ipc.invoke('desktop:float-timer', miniEvent, false), false);
  assert.equal(mini.isDestroyed(), true);
  assert.equal(screen.listenerCount('display-metrics-changed'), 0);
});

test('a renderer crash replaces the window, clears attention, and retains the tray', () => {
  advance(60000);
  ipc.emit('desktop:attention', event(), 'focus-done');
  assert.equal(window.onTop, true);
  tray.menu.find((entry) => entry.label === 'Start').click();
  const previous = window;
  const originalTray = tray;
  ipc.emit('desktop:prevent-sleep', event(), true);
  ipc.invoke('desktop:float-timer', event(), true);
  const mini = miniWindows.at(-1);
  previous.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.equal(activePower.size, 0);
  assert.equal(mini.isDestroyed(), true);
  assert.equal(previous.isDestroyed(), true);
  assert.notEqual(window, previous);
  assert.equal(tray, originalTray);
  assert.equal(previous.onTop, false);
  assert.equal(previous.allWorkspaces, false);
  assert.equal(window.url, 'app://custom-pomodoro/');
  window.emit('ready-to-show');
  assert.equal(window.visible, true);
  tray.menu.find((entry) => entry.label === 'Start').click();
  assert.equal(ipc.listenerCount('desktop:toggle-ready'), 0);
  assert.equal(window.sent, 'desktop:timer-request');
  assert.equal(window.sentArgs[0].command, 'toggle');
  ipc.emit('desktop:timer-result', event(), window.sentArgs[0].id, { ok: true });
  assert.equal(window.keys, undefined);
  previous.webContents.emit('render-process-gone');
  previous.emit('closed');
  assert.equal(window.isDestroyed(), false, 'Stale events must not affect the replacement');
  ipc.emit('desktop:status', event(), 'Recovered');
  assert.equal(tray.title, 'Recovered');
});

const menuBarItem = () => applicationMenu[0].submenu.find(item => item.label === 'Show in Menu Bar');
test('hiding the tray waits for the Dock, stays alive, and restores saved title preferences', async () => {
  const preferences = { floatingTimer: false, floatingOnTop: true, menuBarTime: false, showMenuBar: true };
  ipc.invoke('desktop:floating-preferences', event(), preferences);
  const originalTray = tray;
  assert.equal(menuBarItem().checked, true);
  assert.equal(originalTray.menu.some(item => item.label === 'Show in Menu Bar'), false);
  window.hide();
  app.dockVisible = false;
  let dockReady;
  finishDockShow = () => new Promise(resolve => { dockReady = () => { app.dockVisible = true; resolve(); }; });
  menuBarItem().click({ checked: false });
  assert.equal(originalTray.destroyed, undefined, 'Keep tray until the Dock has appeared');
  assert.equal(menuBarItem().checked, false);
  dockReady();
  await Promise.resolve();
  finishDockShow = null;
  assert.equal(originalTray.destroyed, true);
  assert.equal(app.quitCalled, undefined);
  assert.deepEqual(JSON.parse(readFileSync(path.join(userData, 'menu-bar.json'))), { showMenuBar: false });
  ipc.emit('desktop:status', event(), '12:34 · Focus');
  app.emit('activate');
  assert.equal(window.visible, true);
  const previous = window;
  previous.destroy();
  app.emit('activate');
  assert.notEqual(window, previous, 'Dock recreates a missing main window even without a tray');
  window.emit('ready-to-show');
  assert.equal(window.visible, true);
  menuBarItem().click({ checked: true });
  assert.notEqual(tray, originalTray);
  assert.equal(tray.title, '');
  assert.equal(tray.tooltip, '12:34 · Focus');
  tray.emit('click');
  assert.equal(tray.menu.find(item => item.label === 'Show time in menu bar').checked, false);
  ipc.invoke('desktop:floating-preferences', event(), { ...preferences, menuBarTime: true });
  assert.equal(tray.title, '12:34 · Focus');
});
test('rapid hide/show does not let a late Dock promise destroy the recreated tray', async () => {
  let dockReady;
  finishDockShow = () => new Promise(resolve => { dockReady = resolve; });
  const currentTray = tray;
  menuBarItem().click({ checked: false });
  menuBarItem().click({ checked: true });
  dockReady();
  await Promise.resolve();
  finishDockShow = null;
  assert.equal(tray, currentTray);
  assert.equal(tray.destroyed, undefined);
  assert.equal(menuBarItem().checked, true);
});

test('Dock activation creates and shows a replacement for a closed window', () => {
  const previous = window;
  previous.destroyed = true;
  previous.emit('closed');
  app.emit('activate');
  assert.notEqual(window, previous);
  window.emit('ready-to-show');
  assert.equal(window.visible, true);
});

test('break menu state, floating Stop Sound and the sound-window global shortcut stay synchronized', () => {
  const base = { segment: 'short', running: true, hasProgress: true, ringing: false, sounding: false };
  window.hide();
  ipc.emit('desktop:timer-state', event(), base);
  tray.emit('click');
  const timerMenu = () => applicationMenu.find(item => item.label === 'Timer').submenu;
  assert.ok(tray.menu.some(item => item.label === 'Pause Break'));
  assert.ok(timerMenu().some(item => item.label === 'Pause Break'));
  tray.menu.find(item => item.label === 'Pause Break').click();
  assert.equal(window.sentArgs[0].command, 'toggle'); assert.equal(window.visible, false);
  ipc.emit('desktop:timer-result', event(), window.sentArgs[0].id, { ok: true });
  ipc.emit('desktop:timer-state', event(), { ...base, running: false });
  tray.emit('click');
  assert.ok(tray.menu.some(item => item.label === 'Resume Break'));
  ipc.emit('desktop:timer-state', event(), { ...base, ringing: true, sounding: true });
  assert.equal(shortcuts.has('Command+.'), true);
  tray.emit('click'); assert.equal(tray.menu[0].label, 'Stop Sound');
  shortcuts.get('Command+.')();
  assert.equal(window.sent, 'desktop:timer-request'); assert.equal(window.sentArgs[0].command, 'stopSound');
  ipc.emit('desktop:timer-result', event(), window.sentArgs[0].id, { ok: true });
  assert.equal(shortcuts.has('Command+.'), false);
  assert.equal(window.visible, false);
  assert.equal(timerMenu().find(item => item.label === 'Stop Sound').enabled, false);
  ipc.invoke('desktop:float-timer', event(), true);
  const mini = miniWindows.at(-1), miniEvent = { sender: mini.webContents, senderFrame: mini.webContents.mainFrame };
  ipc.emit('desktop:timer-state', miniEvent, { ...base, ringing: true, sounding: true });
  assert.equal(shortcuts.has('Command+.'), false, 'A mini cannot publish privileged timer state');
  ipc.emit('desktop:timer-state-request', miniEvent);
  assert.equal(mini.sent, 'desktop:timer-state'); assert.equal(mini.sentArgs[0].ringing, false);
  ipc.emit('desktop:timer-state', event(), { ...base, segment: 'long', ringing: true, sounding: true });
  assert.equal(mini.sentArgs[0].ringing, true);
  ipc.invoke('desktop:timer-control', miniEvent, 'stopSound');
  assert.equal(window.sentArgs[0].command, 'stopSound');
  ipc.emit('desktop:timer-result', event(), window.sentArgs[0].id, { ok: true });
  assert.equal(shortcuts.has('Command+.'), false);
  ipc.invoke('desktop:float-timer', event(), false);
  ipc.emit('desktop:timer-state', event(), { segment: 'focus', running: false, hasProgress: false, ringing: false, sounding: false });
});

test('global Stop Sound releases between chimes while the focused menu retains its accelerator', () => {
  const state = { segment: 'short', running: true, hasProgress: true, ringing: true, sounding: true };
  const stopItem = () => applicationMenu.find(item => item.label === 'Timer').submenu.find(item => item.label === 'Stop Sound');
  ipc.emit('desktop:timer-state', event(), state);
  assert.equal(shortcuts.has('Command+.'), true);
  advance(12_000);
  assert.equal(shortcuts.has('Command+.'), false);
  assert.equal(stopItem().enabled, true);
  assert.equal(stopItem().accelerator, 'Command+.');
  assert.equal(stopItem().registerAccelerator, true);
  ipc.emit('desktop:timer-state', event(), { ...state, sounding: false });
  ipc.emit('desktop:timer-state', event(), state); // A later re-chime.
  assert.equal(shortcuts.has('Command+.'), true);
  ipc.emit('desktop:disarm-alarm', event());
  assert.equal(shortcuts.has('Command+.'), false);
  ipc.emit('desktop:timer-state', event(), { ...state, sounding: false, ringing: false });
});

test('a native silent boundary never claims Cmd+., while audible native alarms have a bounded shortcut window', () => {
  const at = Date.now();
  const alarm = { at, kind: 'focus-done', alertSound: 'none', volume: 0, speak: false, notify: false, attention: false };
  assert.equal(ipc.invoke('desktop:arm-alarm', event(), alarm), true);
  assert.equal(shortcuts.has('Command+.'), false);
  assert.equal(ipc.invoke('desktop:arm-alarm', event(), { ...alarm, kind: 'break-over', alertSound: 'bell', volume: 0.5 }), true);
  assert.equal(shortcuts.has('Command+.'), true);
  advance(12_000);
  assert.equal(shortcuts.has('Command+.'), false);
  ipc.emit('desktop:disarm-alarm', event());
  ipc.emit('desktop:timer-state', event(), { segment: 'focus', running: false, hasProgress: false, ringing: false, sounding: false });
});

test('native activation and wake notify only the main renderer with bounded lifecycle events', () => {
  const sent = [];
  const send = window.webContents.send;
  window.webContents.send = (channel, ...values) => { sent.push([channel, ...values]); send(channel, ...values); };
  try {
    app.emit('activate'); powerMonitor.emit('resume');
    assert.deepEqual(sent.filter(([channel]) => channel === 'desktop:lifecycle'), [
      ['desktop:lifecycle', 'activate'], ['desktop:lifecycle', 'resume'],
    ]);
  } finally { window.webContents.send = send; }
});

test('round3 native wake clears an expired alarm before renderer delivery and never rings it', () => {
  const originalNow = Date.now, send = window.webContents.send;
  let wall = originalNow();
  const effects = [nativeProcesses.length, nativeNotifications.length, app.bounces];
  const savedAlarm = () => JSON.parse(readFileSync(path.join(userData, 'pending-alarm.json'), 'utf8'));
  try {
    Date.now = () => wall;
    ipc.invoke('desktop:arm-alarm', event(), { at: wall + 1000, kind: 'focus-done', volume: 1, speak: true,
      alertSound: 'signature', notify: true, attention: true, announcement: { phase: 'break', minutes: 5 } });
    powerMonitor.emit('suspend');
    wall += 3600000;
    window.webContents.send = (channel, ...values) => {
      if (channel === 'desktop:lifecycle' && values[0] === 'resume') assert.equal(savedAlarm(), null);
      send(channel, ...values);
    };
    powerMonitor.emit('resume');
    assert.equal(savedAlarm(), null);
    assert.deepEqual([nativeProcesses.length, nativeNotifications.length, app.bounces], effects);
  } finally { Date.now = originalNow; window.webContents.send = send; }
});

test('round4 main holds the suspend latch until a trusted post-wake read, before resume delivery', () => {
  const read = (sender = event()) => { ipc.emit('desktop:consume-suspension', sender); return sender.returnValue; };
  const send = window.webContents.send;
  try {
    read(); // Consume the preceding test's wake.
    assert.equal(read(), false);
    powerMonitor.emit('suspend');
    assert.equal(read(), true);
    assert.equal(read(), true, 'pre-sleep reads cannot consume the latch');
    window.webContents.send = (channel, ...values) => {
      if (channel === 'desktop:lifecycle' && values[0] === 'resume') {
        assert.equal(read({ sender: {}, senderFrame: {} }), false);
        assert.equal(read(), true, 'a tick before resume delivery still sees sleep');
        assert.equal(read(), false, 'post-wake read consumes the latch');
      }
      send(channel, ...values);
    };
    powerMonitor.emit('resume');
  } finally { window.webContents.send = send; }
});

test('native Timer menu and tray carry input origin through main-process dispatch', () => {
  ipc.emit('desktop:timer-state', event(), { segment: 'focus', running: false, hasProgress: false, ringing: true, sounding: false, hardLocked: false });
  const items = applicationMenu.find(item => item.label === 'Timer').submenu;
  for (const [label, command] of [['Start', 'toggle'], ['Skip', 'skip'], ['Reset', 'reset'], ['Stop', 'stop'], ['Stop and Pause', 'stopAndPause'], ['Stop Sound', 'stopSound']]) {
    const item = items.find(item => item.label === label);
    for (const [triggeredByAccelerator, origin] of [[true, 'accelerator'], [false, 'pointer']]) {
      item.click({}, {}, { triggeredByAccelerator });
      assert.equal(window.sent, 'desktop:timer-request');
      const request = window.sentArgs[0];
      assert.equal(request.command, command);
      assert.equal(request.origin, origin);
      ipc.emit('desktop:timer-result', event(), request.id, { ok: false, reason: 'typing-guard' });
    }
  }
  tray.emit('click');
  tray.menu.find(item => item.label === 'Start').click();
  assert.equal(window.sentArgs[0].origin, 'pointer');
  ipc.emit('desktop:timer-result', event(), window.sentArgs[0].id, { ok: true });
});

test('fullscreen snapshot is restricted to the trusted main frame', () => {
  assert.equal(ipc.invoke('desktop:get-fullscreen', { sender: window.webContents, senderFrame: { url: window.url } }), null);
  assert.equal(ipc.invoke('desktop:get-fullscreen', { sender: {}, senderFrame: window.webContents.mainFrame }), null);
  for (const full of [true, false]) {
    window.fullscreen = full;
    assert.equal(ipc.invoke('desktop:get-fullscreen', event()), full);
  }
});

test('Quit waits for a matching trusted renderer flush before allowing termination', () => {
  ipc.emit('desktop:prevent-sleep', event(), true);
  ipc.invoke('desktop:float-timer', event(), true);
  const mini = miniWindows.at(-1);
  tray.menu.find((entry) => entry.label === 'Quit').click();
  assert.equal(app.lastQuitPrevented, true);
  assert.equal(app.quitCalled, undefined);
  assert.equal(window.sent, 'desktop:flush');
  const request = window.sentArgs[0];
  assert.ok(Number.isInteger(request));
  assert.equal(activePower.size, 0);
  assert.equal(mini.isDestroyed(), true);
  ipc.emit('desktop:flushed', { sender: window.webContents, senderFrame: { url: 'app://custom-pomodoro/' } }, request);
  ipc.emit('desktop:flushed', { sender: mini.webContents, senderFrame: mini.webContents.mainFrame }, request);
  ipc.emit('desktop:flushed', event(), request + 1);
  assert.equal(app.quitCalled, undefined);
  ipc.emit('desktop:flushed', event(), request);
  assert.equal(app.quitCalled, true);
  assert.equal(app.lastQuitPrevented, false);
  assert.equal(app.quitAttempts, 2);
  window.emit('close', { preventDefault: () => assert.fail('Quit must not be prevented') });
});

test('a renderer exit during Quit does not recreate the window', () => {
  const previous = window;
  previous.webContents.emit('render-process-gone', {}, { reason: 'clean-exit' });
  assert.equal(previous.isDestroyed(), true);
  assert.equal(window, previous);
});
