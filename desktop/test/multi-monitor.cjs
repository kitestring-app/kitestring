const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { centeredRect, bannerRects, isBannerURL, moveMainToDisplay, createBanners } = require('../multi-monitor.cjs');
const display = (id, x = 0, y = 30, width = 1440, height = 850) => ({ id, workArea: { x, y, width, height } });

test('centers within the work area, including negative coordinates and smaller displays', () => {
  assert.deepEqual(centeredRect(display(1).workArea, { width: 1280, height: 820 }), { x: 80, y: 45, width: 1280, height: 820 });
  assert.deepEqual(centeredRect(display(2, -1920, -1080, 1920, 1040).workArea, { width: 1280, height: 820 }), { x: -1600, y: -970, width: 1280, height: 820 });
  assert.deepEqual(centeredRect(display(3, 0, 0, 640, 480).workArea, { width: 1280, height: 820 }), { x: 0, y: 0, width: 640, height: 480 });
});
test('only other displays receive full-width 64px banners at the work-area top', () => {
  const displays = [display(1), display(2, -1920, -1080, 1920, 1040), display(3, 1440, 70, 900, 40)];
  assert.deepEqual(bannerRects([displays[0]], 1), []);
  assert.deepEqual(bannerRects(displays, 1), [
    { displayId: 2, x: -1920, y: -1080, width: 1920, height: 64 },
    { displayId: 3, x: 1440, y: 70, width: 900, height: 40 },
  ]);
});
test('banner URLs require the exact local document and one valid kind', () => {
  for (const kind of ['focus-done', 'break-over']) assert.equal(isBannerURL(`app://custom-pomodoro/banner.html?kind=${kind}`), true);
  for (const url of [undefined, 'https://custom-pomodoro/banner.html?kind=focus-done',
    'app://evil/banner.html?kind=focus-done', 'app://custom-pomodoro/banner.html',
    'app://custom-pomodoro/?kind=focus-done', 'app://custom-pomodoro/banner.html?kind=bogus',
    'app://custom-pomodoro/banner.html?kind=focus-done&kind=break-over',
    'app://custom-pomodoro/banner.html?kind=focus-done&extra=1',
    'app://custom-pomodoro/banner.html?kind=focus-done#hash',
    'app://user@custom-pomodoro/banner.html?kind=focus-done']) assert.equal(isBannerURL(url), false, url);
});

function fixture(onAction) {
  const created = [];
  const opened = [];
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.bounds = options; this.calls = [];
      this.webContents = new EventEmitter();
      this.webContents.mainFrame = {};
      this.webContents.setWindowOpenHandler = (handler) => { this.openHandler = handler; };
      created.push(this);
    }
    setBounds(bounds) { this.bounds = bounds; }
    setAlwaysOnTop(...args) { this.top = args; this.calls.push('level'); }
    setVisibleOnAllWorkspaces(...args) { this.workspaces = args; this.calls.push('workspaces'); }
    loadURL(url) { this.url = url; this.webContents.mainFrame.url = url; return Promise.resolve(); }
    isDestroyed() { return !!this.destroyed; }
    isVisible() { return !!this.visible; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    showInactive() { this.visible = true; this.calls.push('showInactive'); }
  }
  const screen = new EventEmitter();
  screen.displays = [display(1), display(2, 1440)];
  screen.getAllDisplays = () => screen.displays;
  screen.getCursorScreenPoint = () => ({ x: 15, y: 50 });
  screen.getDisplayNearestPoint = () => screen.displays[0];
  const banners = createBanners({ BrowserWindow: Window, screen, onAction, onOpen: (display) => opened.push(display) });
  return { created, opened, screen, banners };
}
const sender = (window) => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });

test('fullscreen attention uses inactive panels on EVERY display, including a single main display', () => {
  const { banners, created, screen } = fixture();
  banners.start('focus-done', 1, { allDisplays: true });
  assert.equal(created.length, 2);
  for (const window of created) {
    assert.equal(window.options.type, 'panel');
    assert.equal(window.options.focusable, false);
    assert.deepEqual(window.top, [true, 'screen-saver']);
    assert.deepEqual(window.workspaces, [true, { visibleOnFullScreen: true, skipTransformProcessType: true }]);
    window.emit('ready-to-show');
    assert.equal(window.visible, true);
    assert.deepEqual(window.calls, ['level', 'workspaces', 'showInactive']);
  }
  banners.stop();
  screen.displays.pop();
  banners.start('break-over', 1, { allDisplays: true });
  assert.equal(banners.snapshot().length, 1);
  banners.stop();
});

test('banner actions are trusted, single-flight and cannot dismiss a replacement alert', async () => {
  let finish;
  const actions = [];
  const { banners, created } = fixture(action => {
    actions.push(action); return new Promise(resolve => { finish = resolve; });
  });
  banners.start('focus-done', 1, { allDisplays: true });
  const old = created[0];
  await banners.open({ sender: {}, senderFrame: old.webContents.mainFrame }, 'stop');
  assert.deepEqual(actions, []);
  const pending = banners.open(sender(old), 'continue');
  await banners.open(sender(old), 'stop');
  assert.deepEqual(actions, ['continue']);
  banners.start('break-over', 1, { allDisplays: true });
  finish(true); await pending;
  assert.equal(banners.snapshot().length, 2);
  const refused = banners.open(sender(created.at(-1)), 'stop');
  finish(false); await refused;
  assert.equal(banners.snapshot().length, 2, 'Hard mode or unavailable renderer keeps the alert');
  const accepted = banners.open(sender(created.at(-1)), 'dismiss');
  finish(true); await accepted;
  assert.deepEqual(banners.snapshot(), []);
});

test('all-display panels survive unplug without opening or focusing the dashboard', () => {
  const { banners, screen, opened } = fixture();
  banners.start('focus-done', 1, { allDisplays: true });
  screen.displays.shift(); screen.emit('display-removed');
  assert.deepEqual(opened, []);
  assert.deepEqual(banners.snapshot().map(item => item.displayId), [2]);
  banners.stop();
});

test('creates hardened, silent, unfocusable windows and shows them without stealing focus', () => {
  const { banners, created } = fixture();
  assert.equal(created.length, 0);
  banners.start('focus-done', 1);
  const window = created[0];
  for (const key of ['frame', 'transparent', 'focusable', 'show', 'resizable', 'maximizable', 'fullscreenable']) assert.equal(window.options[key], false, key);
  for (const key of ['skipTaskbar', 'hasShadow']) assert.equal(window.options[key], true, key);
  assert.deepEqual(window.top, [true, 'screen-saver']);
  assert.deepEqual(window.workspaces, [true, { visibleOnFullScreen: true, skipTransformProcessType: true }]);
  assert.equal(window.options.webPreferences.nodeIntegration, false);
  for (const key of ['sandbox', 'contextIsolation', 'webSecurity']) assert.equal(window.options.webPreferences[key], true);
  assert.equal(path.basename(window.options.webPreferences.preload), 'banner-preload.cjs');
  assert.equal(window.url, 'app://custom-pomodoro/banner.html?kind=focus-done');
  assert.equal(window.visible, undefined);
  window.emit('ready-to-show');
  assert.equal(window.visible, true);
  banners.stop();
});

test('only a live banner main frame may open its own display; arguments cannot pick another one', () => {
  const { banners, created, opened } = fixture();
  banners.start('focus-done', 1);
  const window = created[0];
  for (const event of [{ sender: {}, senderFrame: window.webContents.mainFrame },
    { sender: window.webContents, senderFrame: { url: window.url } }]) banners.open(event);
  const validURL = window.webContents.mainFrame.url;
  for (const url of ['https://evil.test', 'app://custom-pomodoro/', 'app://custom-pomodoro/banner.html?kind=bogus']) {
    window.webContents.mainFrame.url = url;
    banners.open(sender(window));
  }
  assert.equal(opened.length, 0);
  window.webContents.mainFrame.url = validURL;
  banners.open(sender(window), 1);
  assert.equal(opened.length, 0, 'Unknown actions cannot select a display');
  banners.open(sender(window));
  assert.equal(opened[0].id, 2);
  assert.equal(window.destroyed, true);
  assert.deepEqual(banners.snapshot(), []);
  banners.open(sender(window));
  assert.equal(opened.length, 1);
});

test('replaces rather than stacks banners and revokes old IPC and delayed show callbacks', () => {
  const { banners, created, opened, screen } = fixture();
  banners.start('focus-done', 1);
  const previous = created[0];
  banners.start('break-over', 1);
  assert.equal(previous.destroyed, true);
  previous.emit('ready-to-show');
  assert.equal(previous.visible, undefined);
  banners.open(sender(previous));
  assert.equal(opened.length, 0);
  assert.equal(created[1].url, 'app://custom-pomodoro/banner.html?kind=break-over');
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) assert.equal(screen.listenerCount(event), 1);
  banners.stop(); banners.stop();
  assert.equal(created[1].destroyed, true);
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) assert.equal(screen.listenerCount(event), 0);
  screen.emit('display-added');
  assert.equal(created.length, 2);
});

test('handles display addition, removal, changed work areas, and loss of the main display', () => {
  const { banners, created, screen, opened } = fixture();
  banners.start('focus-done', 1);
  screen.displays.push(display(3, -1920)); screen.emit('display-added');
  assert.equal(created.length, 2);
  screen.displays[1] = display(2, 1440, 60, 1024); screen.emit('display-metrics-changed');
  assert.deepEqual(created[0].bounds, { x: 1440, y: 60, width: 1024, height: 64 });
  screen.displays = screen.displays.filter((display) => display.id !== 2); screen.emit('display-removed');
  assert.equal(created[0].destroyed, true);
  assert.deepEqual(banners.snapshot().map((item) => item.displayId), [3]);
  screen.displays = screen.displays.filter((display) => display.id !== 1); screen.emit('display-removed');
  assert.equal(opened[0].id, 3);
  assert.equal(created[1].destroyed, true);
  assert.deepEqual(banners.snapshot(), []);
  banners.stop();
});

test('one display creates no renderer; invalid kinds create nothing; crashes destroy banners', () => {
  const { banners, screen, created } = fixture();
  banners.start('invalid', 1);
  assert.equal(screen.listenerCount('display-added'), 0);
  screen.displays.pop(); banners.start('focus-done', 1);
  assert.equal(created.length, 0);
  screen.displays.push(display(2)); screen.emit('display-added');
  created[0].webContents.emit('render-process-gone');
  assert.equal(created[0].destroyed, true);
  assert.deepEqual(banners.snapshot(), []);
  banners.stop();
});

test('banner navigation, redirects, subframes, popups and webviews stay locked', () => {
  const { banners, created } = fixture(); banners.start('focus-done', 1);
  const window = created[0];
  for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect']) {
    for (const url of ['https://evil.test', 'app://custom-pomodoro/', 'app://custom-pomodoro/banner.html?kind=break-over']) {
      let prevented = false;
      window.webContents.emit(name, { url, preventDefault: () => { prevented = true; } });
      assert.equal(prevented, true, name + url);
    }
    window.webContents.emit(name, { url: window.url, preventDefault: () => assert.fail('Own URL must load') });
  }
  assert.deepEqual(window.openHandler({ url: 'https://example.org' }), { action: 'deny' });
  let prevented = false;
  window.webContents.emit('will-attach-webview', { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  banners.stop();
});

test('moving the main window restores it and exits full screen before centering', () => {
  const window = new EventEmitter();
  const calls = [];
  Object.assign(window, { isDestroyed: () => false, isMinimized: () => true, restore: () => calls.push('restore'),
    isMaximized: () => true, unmaximize: () => calls.push('unmaximize'), isFullScreen: () => true,
    setFullScreen: (value) => calls.push(value), setMinimumSize: (...size) => calls.push(size),
    getNormalBounds: () => ({ width: 1280, height: 820 }), setBounds: (bounds) => calls.push(bounds) });
  moveMainToDisplay(window, display(2, -1000, 20, 640, 480), () => calls.push('placed'));
  assert.deepEqual(calls, ['restore', 'unmaximize', false]);
  window.emit('leave-full-screen');
  assert.deepEqual(calls.slice(3), [[640, 480], { x: -1000, y: 20, width: 640, height: 480 }, 'placed']);
});

test('the banner preload exposes only frozen banner.open and no payload', () => {
  let bridge; const sent = [];
  vm.runInNewContext(readFileSync(path.join(__dirname, '..', 'banner-preload.cjs'), 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld: (key, value) => { assert.equal(key, 'banner'); bridge = value; } },
      ipcRenderer: { send: (...args) => sent.push(args) } }),
  });
  assert.deepEqual(Object.keys(bridge), ['open']); assert.equal(Object.isFrozen(bridge), true);
  bridge.open('arbitrary display'); assert.deepEqual(sent, []);
  bridge.open(); assert.deepEqual(sent, [['desktop:banner-open', 'open']]);
});

test('the static page labels the boundary and exposes pointer actions only', () => {
  for (const kind of ['focus-done', 'break-over']) {
    const buttons = Object.fromEntries(['label', 'continue', 'stop', 'open', 'dismiss'].map(id => [id, {}]));
    const actions = [];
    for (const id of ['continue', 'stop', 'open', 'dismiss']) buttons[id].addEventListener = (name, callback) => {
      assert.equal(name, 'click'); buttons[id].click = callback;
    };
    vm.runInNewContext(readFileSync(path.join(__dirname, '..', '..', 'public', 'banner.js'), 'utf8'), {
      document: { getElementById: id => buttons[id] }, URLSearchParams, location: { search: `?kind=${kind}` },
      window: { banner: { open: action => actions.push(action) } },
    });
    assert.equal(buttons.label.textContent, kind === 'focus-done' ? 'Focus complete' : 'Break over');
    assert.equal(buttons.continue.textContent, 'Continue');
    for (const id of ['continue', 'stop', 'open', 'dismiss']) buttons[id].click();
    assert.deepEqual(actions, ['continue', 'stop', 'open', 'dismiss']);
  }
});

test('banner readiness survives native occlusion after its first paint and show request', () => {
  const { banners, created } = fixture();
  banners.start('break-over', 1);
  const window = created[0];
  window.isVisible = () => false; // macOS also returns false for a fully occluded window.
  assert.equal(banners.snapshot()[0].shown, false);
  window.emit('ready-to-show');
  assert.equal(banners.snapshot()[0].shown, true);
  assert.equal(banners.snapshot()[0].visible, false);
  banners.stop();
  assert.deepEqual(banners.snapshot(), []);
});

test('banner action copy never promises a break when Continue may restart single-session focus', () => {
  for (const kind of ['focus-done', 'break-over']) {
    const actions = [];
    const elements = Object.fromEntries(['label', 'continue', 'stop', 'open', 'dismiss'].map(id => [id, {
      textContent: '', listeners: {}, addEventListener(name, listener) { this.listeners[name] = listener; },
    }]));
    vm.runInNewContext(readFileSync(path.join(__dirname, '../../public/banner.js'), 'utf8'), {
      URLSearchParams, location: { search: `?kind=${kind}` },
      document: { getElementById: id => elements[id] }, window: { banner: { open: action => actions.push(action) } },
    });
    assert.equal(elements.continue.textContent, 'Continue');
    elements.continue.listeners.click();
    assert.deepEqual(actions, ['continue']);
  }
});
