const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { EventEmitter } = require('node:events');

function loadBridge(argv = []) {
  const globals = {};
  const sent = [];
  const invoked = [];
  const events = new EventEmitter();
  const focus = [];
  vm.runInNewContext(readFileSync(path.join(__dirname, '..', 'preload.cjs'), 'utf8'), {
    require: () => ({
      contextBridge: { exposeInMainWorld: (name, value) => { globals[name] = value; } },
      ipcRenderer: {
        send: (...args) => sent.push(args),
        sendSync: (...args) => { sent.push(args); return true; },
        invoke: (...args) => { invoked.push(args); return Promise.resolve(args[1] ?? true); },
        on: (channel, listener) => events.on(channel, listener),
        removeListener: (channel, listener) => events.removeListener(channel, listener),
      },
    }),
    process: { argv },
    window: { focus: () => focus.push('focus') },
    document: { activeElement: { blur: () => focus.push('blur') } },
  });
  return { bridge: globals.desktop, globals, sent, invoked, events, focus };
}

test('main bridge is frozen and routes the supported native methods', async () => {
  const { bridge, sent, invoked } = loadBridge();
  assert.deepEqual(Object.keys(bridge).sort(), [
    'armAlarm', 'attention', 'cancelSpeech', 'cloud', 'consumeSuspension', 'disarmAlarm', 'floatTimer',
    'getSecureDns', 'notificationStatus', 'onAudioAction', 'onAudioRequest', 'onFloatTimer', 'onFloatingPreferences', 'onFlush', 'onFullScreenTransition', 'onLifecycle', 'onMenuCommand', 'onParked', 'onTimerAction', 'onTimerRequest', 'parkingStatus', 'preventSleep', 'publishAudioState', 'publishTimerState', 'release',
    'setFloatingPreferences', 'setSecureDns', 'setStatus', 'speak', 'testReminder', 'toggleFullScreen',
  ]);
  assert.equal(Object.isFrozen(bridge), true);
  bridge.setStatus(42);
  bridge.attention('bogus');
  bridge.preventSleep('true');
  assert.equal(await bridge.floatTimer('true'), false);
  assert.deepEqual(sent, []);
  assert.deepEqual(invoked, []);

  bridge.setStatus('x'.repeat(100));
  bridge.attention('focus-done');
  bridge.attention('break-over');
  bridge.release();
  bridge.disarmAlarm();
  bridge.cancelSpeech();
  bridge.preventSleep(true);
  bridge.preventSleep(false);
  assert.deepEqual(sent, [
    ['desktop:status', 'x'.repeat(64)], ['desktop:attention', 'focus-done'],
    ['desktop:attention', 'break-over'], ['desktop:release'],
    ['desktop:disarm-alarm'], ['desktop:cancel-speech'],
    ['desktop:prevent-sleep', true], ['desktop:prevent-sleep', false],
  ]);

  const alarm = { at: 1000, title: 'Break time' };
  const speech = { text: 'Break time' };
  assert.equal(await bridge.floatTimer(true), true);
  assert.equal(await bridge.floatTimer(false), false);
  await bridge.armAlarm(alarm);
  await bridge.speak(speech);
  await bridge.notificationStatus();
  assert.deepEqual(invoked, [
    ['desktop:float-timer', true], ['desktop:float-timer', false],
    ['desktop:arm-alarm', alarm], ['desktop:speak', speech],
    ['desktop:notification-status'],
  ]);
});

test('removed prepare-toggle channel cannot focus the page or send an acknowledgement', () => {
  const { events, sent, focus } = loadBridge();
  events.emit('desktop:prepare-toggle', {}, 7);
  assert.deepEqual(focus, []);
  assert.deepEqual(sent, []);
  assert.equal(events.listenerCount('desktop:prepare-toggle'), 0);
});

test('timer action subscriptions omit the IPC event and unsubscribe cleanly', () => {
  const { bridge, events } = loadBridge();
  const actions = [];
  const unsubscribe = bridge.onTimerAction((action) => actions.push(action));
  events.emit('desktop:timer-action', { private: true }, 'toggle');
  assert.deepEqual(actions, ['toggle']);
  unsubscribe();
  events.emit('desktop:timer-action', {}, 'skip');
  assert.deepEqual(actions, ['toggle']);
  assert.equal(events.listenerCount('desktop:timer-action'), 0);
});

test('flush acknowledgement waits for persistence and stops after unsubscribe', async () => {
  const { bridge, events, sent } = loadBridge();
  let finish;
  let calls = 0;
  const pending = new Promise((resolve) => { finish = resolve; });
  const unsubscribe = bridge.onFlush(() => { calls++; return pending; });
  events.emit('desktop:flush', {}, 'flush-1');
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  assert.deepEqual(sent, []);
  finish();
  await new Promise(setImmediate);
  assert.deepEqual(sent, [['desktop:flushed', 'flush-1']]);
  unsubscribe();
  events.emit('desktop:flush', {}, 'flush-2');
  await new Promise(setImmediate);
  assert.equal(calls, 1);
  assert.equal(events.listenerCount('desktop:flush'), 0);
  assert.deepEqual(sent, [['desktop:flushed', 'flush-1']]);
});

test('failed persistence does not acknowledge a flush', async () => {
  const { bridge, events, sent } = loadBridge();
  bridge.onFlush(async () => { throw new Error('storage unavailable'); });
  events.emit('desktop:flush', {}, 'failed-flush');
  await new Promise(setImmediate);
  assert.deepEqual(sent, []);
});

test('mini bridge exposes only restricted timer controls and cannot open windows', async () => {
  const { bridge, globals, sent, invoked, events } = loadBridge(['--mini-timer']);
  assert.deepEqual(Object.keys(globals), ['desktop']);
  assert.deepEqual(Object.keys(bridge).sort(), ['audioControl', 'floatTimer', 'mini', 'onAudioState', 'onTimerState', 'requestAudioState', 'requestTimerState', 'showMain', 'timerControl']);
  assert.equal(Object.isFrozen(bridge), true);
  assert.equal(bridge.mini, true);
  for (const forbidden of ['setStatus', 'armAlarm', 'attention', 'release', 'speak', 'preventSleep', 'onFlush', 'onTimerAction']) {
    assert.equal(bridge[forbidden], undefined);
  }
  for (const input of [true, undefined, null, 0, 'false']) {
    assert.equal(await bridge.floatTimer(input), false);
  }
  assert.deepEqual(invoked, []);
  assert.equal(await bridge.floatTimer(false), false);
  assert.deepEqual(invoked, [['desktop:float-timer', false]]);
  bridge.showMain();
  bridge.timerControl('toggle');
  bridge.timerControl('skip');
  bridge.timerControl('invalid');
  bridge.timerControl({ action: 'toggle' });
  assert.deepEqual(sent, [['desktop:show-main']]);
  assert.deepEqual(invoked.slice(1), [['desktop:timer-control', 'toggle'], ['desktop:timer-control', 'skip']]);
  assert.equal(events.listenerCount('desktop:prepare-toggle'), 0);
});

test('floating state subscriptions keep a mini close synchronized without exposing the IPC event', () => {
  const { bridge, events } = loadBridge();
  const values = [];
  const off = bridge.onFloatTimer(value => values.push(value));
  events.emit('desktop:floating-state', { private: true }, false);
  assert.deepEqual(values, [false]);
  off();
  events.emit('desktop:floating-state', {}, true);
  assert.deepEqual(values, [false]);
  assert.equal(events.listenerCount('desktop:floating-state'), 0);
});


test('cloud bridge exposes fixed operations without exposing a credential getter, and mini has none', async () => {
  const { bridge, invoked } = loadBridge();
  assert.deepEqual(Object.keys(bridge.cloud).sort(), ['openReset', 'request', 'signIn', 'signOut', 'status']);
  assert.equal(Object.isFrozen(bridge.cloud), true);
  const password = require('node:crypto').randomBytes(20).toString('hex');
  await bridge.cloud.signIn('test@example.invalid', password);
  await bridge.cloud.status();
  await bridge.cloud.request('GET', '/api/sync');
  await bridge.cloud.signOut();
  await bridge.cloud.openReset();
  assert.deepEqual(invoked, [
    ['desktop:cloud-signIn', 'test@example.invalid', password],
    ['desktop:cloud-status'], ['desktop:cloud-request', 'GET', '/api/sync', undefined],
    ['desktop:cloud-signOut'], ['desktop:cloud-reset'],
  ]);
  assert.equal(loadBridge(['--mini-timer']).bridge.cloud, undefined);
});

 test('parking subscription strips the IPC event and supports unsubscribe', async () => {
  const { bridge, events, invoked } = loadBridge();
  const texts = [];
  const off = bridge.onParked(text => texts.push(text));
  events.emit('desktop:parked', { private: true }, 'Read later');
  off();
  events.emit('desktop:parked', {}, 'Ignored');
  assert.deepEqual(texts, ['Read later']);
  assert.equal(events.listenerCount('desktop:parked'), 0);
  await bridge.parkingStatus();
  assert.deepEqual(invoked, [['desktop:parking-status']]);
  assert.equal(loadBridge(['--mini-timer']).bridge.onParked, undefined);
});

test('menu subscription validates commands, strips IPC events and cleans up; mini cannot subscribe', () => {
  const { bridge, events } = loadBridge();
  const commands = [];
  const off = bridge.onMenuCommand(command => commands.push(command));
  for (const value of ['unknown', null, {}, ['settings'], 1]) events.emit('desktop:menu-command', {}, value);
  events.emit('desktop:menu-command', { private: true }, 'settings');
  assert.deepEqual(commands, ['settings']);
  off();
  events.emit('desktop:menu-command', {}, 'home');
  assert.deepEqual(commands, ['settings']);
  assert.equal(loadBridge(['--mini-timer']).bridge.onMenuCommand, undefined);
});

test('timer request callbacks return typed refusals over IPC without errors or exposing the event', async () => {
  const { bridge, events, sent } = loadBridge();
  const refusal = { ok: false, reason: 'hard-mode', message: 'Hard mode: this block runs to the end' };
  const received = [];
  const off = bridge.onTimerRequest(async command => { received.push(command); return refusal; });
  events.emit('desktop:timer-request', { private: true }, { id: 42, command: 'stop' });
  await new Promise(setImmediate);
  assert.deepEqual(received, ['stop']);
  assert.deepEqual(sent, [['desktop:timer-result', 42, refusal]]);
  events.emit('desktop:timer-request', {}, { id: 43, command: 'quit' });
  await new Promise(setImmediate); assert.equal(sent.length, 1);
  off(); assert.equal(events.listenerCount('desktop:timer-request'), 0);
});
test('timer request callbacks receive the validated native input origin', async () => {
  const { bridge, events, sent } = loadBridge();
  const received = [];
  bridge.onTimerRequest(async (...args) => { received.push(args); return { ok: false, reason: 'typing-guard' }; });
  events.emit('desktop:timer-request', { private: true }, { id: 65, command: 'skip', origin: 'accelerator' });
  events.emit('desktop:timer-request', {}, { id: 66, command: 'skip', origin: 'pointer' });
  events.emit('desktop:timer-request', {}, { id: 67, command: 'skip', origin: 'invalid' });
  await new Promise(setImmediate);
  assert.deepEqual(received, [['skip', 'accelerator'], ['skip', 'pointer']]);
  assert.equal(sent.length, 2);
});


test('lifecycle subscription validates payloads, omits IPC details, and stays out of mini windows', () => {
  const { bridge, events } = loadBridge();
  const calls = [];
  const off = bridge.onLifecycle(value => calls.push(value));
  for (const value of ['resume', 'activate', 'bogus', null, { resume: true }]) events.emit('desktop:lifecycle', { secret: true }, value);
  assert.deepEqual(calls, ['resume', 'activate']);
  off();
  events.emit('desktop:lifecycle', {}, 'resume');
  assert.deepEqual(calls, ['resume', 'activate']);
  assert.equal(loadBridge(['--mini-timer']).bridge.onLifecycle, undefined);
});


test('round4 the main preload exposes a synchronous bounded suspend latch read', () => {
  const { bridge, sent } = loadBridge();
  assert.equal(bridge.consumeSuspension(), true);
  assert.deepEqual(sent, [['desktop:consume-suspension']]);
  assert.equal(loadBridge(['--mini-timer']).bridge.consumeSuspension, undefined);
});
