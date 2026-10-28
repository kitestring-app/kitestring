const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { timerMenuItems, applicationMenu, registerMenuCommands, validMenuCommand, MENU_COMMANDS } = require('../menu.cjs');
function fixture() {
  const calls = [];
  const controls = {
    appMenuItem: () => ({ label: 'Show in Menu Bar', type: 'checkbox', checked: true }),
    menu: () => ['Floating timer', 'Keep floating timer on top', 'Show time in menu bar'].map(label => ({ label, type: 'checkbox', checked: false, click: item => calls.push(item.checked) })),
  };
  const menu = applicationMenu({ command: value => calls.push(value), showWindow: () => calls.push('show'), closeWindow: () => calls.push('close'),
    toggleTimer: () => calls.push('toggle'), floatingControls: controls, park: () => calls.push('park'), openGitHub: () => calls.push('github') });
  return { menu, calls };
}
test('standard Mac menus follow HIG order, roles and accelerators with no dev tools', () => {
  const { menu } = fixture();
  assert.deepEqual(menu.map(item => item.label || item.role), ['Kitestring', 'editMenu', 'View', 'Timer', 'Window', 'help']);
  assert.deepEqual(menu[0].submenu.map(item => item.label || item.role || item.type), [
    'about', 'Settings…', 'separator', 'Show in Menu Bar', 'Floating timer', 'Keep floating timer on top', 'Show time in menu bar',
    'separator', 'services', 'separator', 'hide', 'hideOthers', 'unhide', 'separator', 'quit',
  ]);
  const all = menu.flatMap(item => item.submenu || [item]);
  const accelerators = {
    'Settings…': 'Command+,', togglefullscreen: 'Control+Command+F', Home: 'Command+1', Focus: 'Command+2', Ambient: 'Command+3',
    'Show Tasks': 'Command+Shift+T', 'Sounds & music': 'Command+Shift+M', Notepad: 'Command+Shift+N', 'Start/Pause': 'Command+Return',
    Skip: 'Command+]', Reset: 'Command+Shift+R', 'Floating Timer': 'Command+Shift+F', 'Park a Thought': 'Alt+Command+P',
    minimize: 'Command+M', Close: 'Command+W', hide: 'Command+H', hideOthers: 'Alt+Command+H', quit: 'Command+Q',
  };
  for (const [key, value] of Object.entries(accelerators)) assert.equal(all.find(item => (item.label || item.role) === key)?.accelerator, value, key);
  assert.deepEqual(menu[4].submenu.map(item => item.label || item.role || item.type), ['minimize', 'zoom', 'Close', 'separator', 'front', 'Show Kitestring']);
  assert.deepEqual(menu[5].submenu.map(item => item.label), ['Keyboard Shortcuts', 'Kitestring on GitHub']);
  assert.equal(all.find(item => item.label === 'Park a Thought').registerAccelerator, false);
  const registered = all.filter(item => item.accelerator && item.registerAccelerator !== false).map(item => item.accelerator);
  assert.equal(new Set(registered).size, registered.length);
  assert.equal(all.some(item => /reload|devtools/i.test(item.role || item.label || '')), false);
});
test('renderer items dispatch fixed commands and native actions stay native', () => {
  const { menu, calls } = fixture();
  const all = menu.flatMap(item => item.submenu || [item]);
  for (const [label, expected] of Object.entries({ 'Settings…': 'settings', Home: 'home', Focus: 'focus', Ambient: 'ambient',
    'Show Tasks': 'tasks', 'Sounds & music': 'sounds', Notepad: 'notes', 'Start/Pause': 'toggle', Skip: 'skip', Reset: 'reset',
    'Keyboard Shortcuts': 'shortcuts', Close: 'close', 'Show Kitestring': 'show', 'Park a Thought': 'park', 'Kitestring on GitHub': 'github' })) {
    all.find(item => item.label === label).click(); assert.equal(calls.at(-1), expected);
  }
  all.find(item => item.label === 'Floating Timer').click({ checked: true });
  assert.equal(calls.at(-1), true);
});
test('one command channel rejects unknown values and untrusted main, mini and subframe senders', () => {
  const ipc = new EventEmitter(), calls = [], trusted = {};
  registerMenuCommands(ipc, event => event === trusted, command => calls.push(command));
  for (const command of [...MENU_COMMANDS, 'reload', 'devtools', null, {}, ['settings'], 0, undefined]) {
    for (const sender of [{}, { sender: 'mini' }, { senderFrame: 'subframe' }]) ipc.emit('desktop:menu-command', sender, command);
  }
  assert.deepEqual(calls, []);
  for (const command of ['unknown', null, {}, [], 1]) { assert.equal(validMenuCommand(command), false); ipc.emit('desktop:menu-command', trusted, command); }
  assert.deepEqual(calls, []);
  for (const command of MENU_COMMANDS) ipc.emit('desktop:menu-command', trusted, command);
  assert.deepEqual(calls, MENU_COMMANDS);
});

test('timer menus describe focus, every break type, pause state and ringing consistently', () => {
  const { timerMenuItems, validTimerState } = require('../menu.cjs');
  for (const segment of ['focus', 'short', 'long']) for (const running of [true, false]) {
    const calls = [];
    const state = { segment, running, hasProgress: true, ringing: false, sounding: false };
    assert.equal(validTimerState(state), true);
    const items = timerMenuItems(state, value => calls.push(value));
    const labels = segment === 'focus' ? [running ? 'Pause' : 'Resume', 'Skip', 'Stop'] : [running ? 'Pause Break' : 'Resume Break', 'Skip Break', 'End Break and Stop'];
    assert.deepEqual(items.map(item => item.label), labels);
    items.forEach(item => item.click());
    assert.deepEqual(calls, ['toggle', 'skip', 'stop']);
    const ringing = timerMenuItems({ ...state, ringing: true, sounding: true }, value => calls.push(value));
    assert.equal(ringing[0].label, 'Stop Sound'); ringing[0].click();
    assert.equal(calls.at(-1), 'stopSound');
    ringing[1].click(); assert.equal(calls.at(-1), 'stopAndPause');
    const nativeMenu = timerMenuItems({ ...state, ringing: true, sounding: true }, () => {}, true, true);
    assert.equal(nativeMenu[0].accelerator, 'Command+.');
    assert.equal(nativeMenu[0].registerAccelerator, false);
  }
  for (const value of [null, {}, [], { segment: 'other', running: true, hasProgress: true, ringing: true, sounding: true }]) assert.ok(!validTimerState(value));
});

test('unstarted breaks say Start Break, and focused Stop Sound keeps Cmd+. between chimes', () => {
  const { timerMenuItems } = require('../menu.cjs');
  for (const segment of ['short', 'long']) {
    const state = { segment, running: false, hasProgress: false, ringing: false, sounding: false };
    assert.equal(timerMenuItems(state, () => {})[0].label, 'Start Break');
    const items = timerMenuItems({ ...state, ringing: true }, () => {}, true);
    assert.equal(items[0].accelerator, 'Command+.');
    assert.equal(items[0].registerAccelerator, true);
    assert.equal(items[0].enabled, true);
  }
});

test('paused Hard recovery offers Resume in native menus while retaining skip and stop locks', () => {
  const items = timerMenuItems({ segment: 'focus', running: false, hasProgress: true, ringing: false, sounding: false, hardLocked: true }, () => {});
  const resume = items.find(item => item.label.includes('Resume'));
  assert.notEqual(resume.enabled, false);
  for (const item of items.filter(item => /Skip|Stop/.test(item.label))) assert.equal(item.enabled, false);
});
