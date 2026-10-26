const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { prepareIdentity } = require('../identity.cjs');

for (const oldPresent of [true, false]) test(`startup pins the correct profile, old folder present: ${oldPresent}`, () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kitestring-identity-'));
  const legacy = path.join(root, 'Custom Pomodoro');
  const current = path.join(root, 'Kitestring');
  const calls = [];
  const app = {
    setName: name => calls.push(['name', name]),
    getPath: name => name === 'appData' ? root : current,
    setPath: (name, value) => calls.push([name, value]),
    commandLine: { hasSwitch: () => false },
  };
  try {
    if (oldPresent) { mkdirSync(legacy); writeFileSync(path.join(legacy, 'cloud-session.enc'), 'encrypted fixture'); }
    prepareIdentity(app);
    assert.deepEqual(calls, [['name', 'Kitestring'], ['userData', oldPresent ? legacy : current], ['name', 'custom-pomodoro-desktop']]);
    if (oldPresent) assert.equal(readFileSync(path.join(legacy, 'cloud-session.enc'), 'utf8'), 'encrypted fixture');
    const main = readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
    assert.ok(main.indexOf('prepareIdentity(app)') < main.indexOf('app.requestSingleInstanceLock()'));
    assert.match(main, /app\.whenReady\(\)\.then\(async \(\) => \{\s+app\.setName\('Kitestring'\)/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('an explicit disposable profile always wins over a legacy profile', () => {
  let selected;
  prepareIdentity({
    setName() {}, getPath: () => tmpdir(), setPath: (_name, value) => { selected = value; },
    commandLine: { hasSwitch: () => true, getSwitchValue: () => './throwaway-profile' },
  });
  assert.equal(selected, path.resolve('./throwaway-profile'));
});

test('preserves the package-name profile used by earlier installed builds', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kitestring-package-profile-'));
  const legacy = path.join(root, 'custom-pomodoro-desktop');
  let selected, name;
  try {
    mkdirSync(legacy); mkdirSync(path.join(root, 'Kitestring'));
    prepareIdentity({setName: value => {name = value;}, getPath: () => root, setPath: (_key,value) => {selected=value;}, commandLine:{hasSwitch:()=>false}});
    assert.equal(selected, legacy);
    assert.equal(name, 'custom-pomodoro-desktop');
  } finally { rmSync(root,{recursive:true,force:true}); }
});
