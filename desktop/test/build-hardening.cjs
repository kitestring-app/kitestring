const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { build } = require('../package.json');

test('build hardens all five fuses and runs the sealing hook after ad-hoc signing', () => {
  assert.deepEqual(build.electronFuses, {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    onlyLoadAppFromAsar: true,
    enableEmbeddedAsarIntegrityValidation: true,
  });
  assert.equal(build.asar, true);
  assert.equal(build.mac.identity, '-');
  assert.equal(build.afterSign, 'scripts/after-sign.cjs');
});

test('the signing hook seals the full bundle under appId and verifies it strictly', async () => {
  const calls = [];
  const module = { exports: {} };
  const signingProcess = { env: {} };
  vm.runInNewContext(readFileSync(path.join(__dirname, '..', build.afterSign), 'utf8'), {
    module,
    process: signingProcess,
    require: (name) => name === 'node:child_process'
      ? { execFileSync: (...args) => calls.push(args) } : require(name),
  });
  const context = { appOutDir: '/tmp/package output', electronPlatformName: 'darwin',
    packager: { appInfo: { productFilename: build.productName, id: build.appId } } };
  await module.exports(context);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['codesign', ['--force', '--deep', '--sign', '-', '--identifier', build.appId, '/tmp/package output/Kitestring.app'], { stdio: 'inherit' }],
    ['codesign', ['--verify', '--deep', '--strict', '/tmp/package output/Kitestring.app'], { stdio: 'inherit' }],
  ]);
  signingProcess.env.CP_SIGN_IDENTITY = 'test-stable-signing-identity';
  calls.length = 0;
  await module.exports(context);
  assert.equal(calls[0][1][3], 'test-stable-signing-identity');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1])),
    ['codesign', ['--verify', '--deep', '--strict', '/tmp/package output/Kitestring.app'], { stdio: 'inherit' }]);
  calls.length = 0;
  await module.exports({ ...context, electronPlatformName: 'linux' });
  assert.equal(calls.length, 0);
});

test('a codesign failure stops the build hook', async () => {
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(path.join(__dirname, '..', build.afterSign), 'utf8'), {
    module,
    process: { env: {} },
    require: (name) => name === 'node:child_process'
      ? { execFileSync: () => { throw new Error('codesign failed'); } } : require(name),
  });
  await assert.rejects(module.exports({ appOutDir: '/tmp/output', electronPlatformName: 'darwin',
    packager: { appInfo: { productFilename: build.productName, id: build.appId } } }), /codesign failed/);
});
