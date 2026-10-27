const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Exercise the real main-window factory with no Electron process or user data.
const source = readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
const factory = source.slice(source.indexOf('function createWindow()'), source.indexOf('function createTray()'));
for (const platform of ['darwin', 'linux', 'win32']) for (const smokeTest of [false, true]) {
  test(`main window title bar on ${platform}, smoke=${smokeTest}`, () => {
    let options;
    const contents = { on() {}, setWindowOpenHandler() {} };
    const context = {
      process: { platform }, smokeTest, quitting: false, path, __dirname: '/test',
      APP_ORIGIN: 'app://custom-pomodoro', attachFullscreen() {},
      BrowserWindow: class {
        constructor(value) { options = value; this.webContents = contents; }
        on() {} once() {} loadURL() { return Promise.resolve(); }
      },
    };
    vm.runInNewContext(`let window; let fullscreen; ${factory}; createWindow();`, context);
    assert.equal(options.title, 'Kitestring');
    assert.equal(options.titleBarStyle, platform === 'darwin' ? 'hiddenInset' : undefined);
    assert.equal(options.minWidth, 720);
    assert.equal(options.minHeight, 540);
    assert.equal(options.webPreferences.additionalArguments.includes('--smoke-test'), smokeTest);
  });
}
