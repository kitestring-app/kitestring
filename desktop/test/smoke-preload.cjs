const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('native smoke probes exist only on the main renderer under the smoke switch', async () => {
  for (const smoke of [false, true]) {
    for (const mini of [false, true]) {
      const globals = {};
      const requests = [];
      vm.runInNewContext(readFileSync(path.join(__dirname, '..', 'preload.cjs'), 'utf8'), {
        require: () => ({
          contextBridge: { exposeInMainWorld: (key, value) => { globals[key] = value; } },
          ipcRenderer: {
            on() {},
            invoke: (name) => { requests.push(name); return Promise.resolve({ cooldownRemainingMs: 123 }); },
            send: (name) => requests.push(name),
            sendSync: (name) => { requests.push(name); return { visible: false }; },
          },
        }),
        process: { argv: [...(smoke ? ['--smoke-test'] : []), ...(mini ? ['--mini-timer'] : [])] },
      });
      const enabled = smoke && !mini;
      for (const name of ['__desktopSmokeQuit', '__desktopSmokeState', '__desktopSmokeClose', '__desktopSmokeFocus', '__desktopSmokePark', '__desktopSmokeDiagnostics']) {
        assert.equal(typeof globals[name], enabled ? 'function' : 'undefined');
        assert.equal(globals.desktop[name], undefined);
      }
      assert.equal(Object.isFrozen(globals.desktop), true);
      if (enabled) {
        globals.__desktopSmokeClose();
        assert.deepEqual(globals.__desktopSmokeState('ignored'), { visible: false });
        assert.deepEqual(await globals.__desktopSmokeDiagnostics(), { cooldownRemainingMs: 123 });
        globals.__desktopSmokeQuit();
        assert.deepEqual(requests, ['desktop:smoke-close', 'desktop:smoke-state', 'desktop:smoke-diagnostics', 'desktop:smoke-quit']);
      } else {
        assert.deepEqual(Object.keys(globals), ['desktop']);
        assert.deepEqual(requests, []);
      }
    }
  }
});
