const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { createNativeServices } = require('../native-services.cjs');

function harness({ saved = null, supported = true } = {}) {
  let time = 1_000_000;
  let nextTimer = 0;
  let stored = saved === null ? null : structuredClone(saved);
  const timers = new Map();
  const writes = [];
  const processes = [];
  const notifications = [];
  const attention = [];
  const power = new Set();
  const powerStarts = [];
  const powerStops = [];
  const savedAtEffects = [];
  let stopped = 0;
  let shown = 0;
  let reads = 0;
  class Notification extends EventEmitter {
    static isSupported() { return supported; }
    constructor(options) {
      super();
      savedAtEffects.push(structuredClone(stored));
      this.options = options;
      this.shown = 0;
      notifications.push(this);
    }
    show() { this.shown++; }
    close() { this.closed = true; }
  }
  const services = createNativeServices({
    app: Object.assign(new EventEmitter(), { getName: () => 'Kitestring' }),
    Notification,
    powerSaveBlocker: {
      start(type) { const id = powerStarts.length; powerStarts.push(type); power.add(id); return id; },
      stop(id) { powerStops.push(id); power.delete(id); },
      isStarted(id) { return power.has(id); },
    },
    execFile(file, args, options, done) {
      savedAtEffects.push(structuredClone(stored));
      const child = Object.assign(new EventEmitter(), {
        file, args, options: typeof options === 'function' ? undefined : options,
        done: typeof options === 'function' ? options : done,
        killed: false,
        kill() { this.killed = true; },
      });
      processes.push(child);
      return child;
    },
    stateFile: '/test-data/alarm.json',
    alertsDir: '/test-assets/alerts',
    attention: (kind) => { savedAtEffects.push(structuredClone(stored)); attention.push(kind); },
    onStopSound: () => { stopped++; },
    showWindow: () => { shown++; },
    now: () => time,
    setTimer(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimer: (id) => timers.delete(id),
    readJSON(file) { reads++; assert.equal(file, '/test-data/alarm.json'); return structuredClone(stored); },
    writeJSON(file, value) {
      assert.equal(file, '/test-data/alarm.json');
      stored = structuredClone(value);
      writes.push(structuredClone(value));
    },
  });
  return {
    services, timers, writes, processes, notifications, attention, power, powerStarts, powerStops, savedAtEffects, reads: () => reads,
    now: () => time,
    setTime: (next) => { time = next; },
    saved: () => structuredClone(stored),
    shown: () => shown,
    stopped: () => stopped,
    runTimer() {
      assert.ok(timers.size, 'a wall-clock check should be scheduled');
      const [id, { callback }] = timers.entries().next().value;
      timers.delete(id);
      callback();
    },
  };
}

const alarm = (h, patch = {}) => ({ at: h.now() + 1000, kind: 'focus-done', volume: 0.7, speak: true, ...patch });
const fire = (h, patch = {}) => {
  const input = alarm(h, patch);
  assert.equal(h.services.arm(input), true);
  h.setTime(input.at);
  h.services.check();
  return input;
};
const sounds = (h) => h.processes.filter((p) => p.file === '/usr/bin/afplay');
const speech = (h) => h.processes.filter((p) => p.file === '/usr/bin/say');

test('rejects malformed native alarm payloads without replacing a valid alarm', () => {
  const h = harness();
  const valid = alarm(h);
  assert.equal(h.services.arm(valid), true);
  const accepted = structuredClone(h.services.snapshot().pending);
  const invalid = [null, undefined, [], 'alarm',
    ...[NaN, Infinity, -Infinity, '1000', h.now() - 60_001, h.now() + 48 * 3600_000 + 1].map((at) => ({ ...valid, at })),
    ...['bad', '../focus-done', undefined].map((kind) => ({ ...valid, kind })),
    ...['../bell', '/tmp/bell.wav', 'constructor', '__proto__', '', null, 1, {}].map((alertSound) => ({ ...valid, alertSound })),
    ...[NaN, Infinity, '0.5', null].map((volume) => ({ ...valid, volume })),
    ...[undefined, null, 1, 'true'].map((speak) => ({ ...valid, speak })),
    ...[null, 1, 'false'].flatMap((value) => [{ ...valid, notify: value }, { ...valid, attention: value }]),
    ...[null, {}, [], 'text', { phase: 'unknown' }, { phase: 'focus', minutes: Infinity }, { phase: 'break', minutes: -1 }].map((announcement) => ({ ...valid, announcement })),
  ];
  for (const value of invalid) assert.equal(h.services.arm(value), false, `reject ${JSON.stringify(value)}`);
  assert.deepEqual(h.services.snapshot().pending, accepted);
  assert.equal(h.timers.size, 1);
});

test('clamps finite volume and persists a copy rather than the caller object', () => {
  for (const [volume, expected] of [[-10, 0], [10, 1]]) {
    const h = harness();
    const input = alarm(h, { volume });
    assert.equal(h.services.arm(input), true);
    input.kind = 'break-over';
    assert.equal(h.services.snapshot().pending.volume, expected);
    assert.equal(h.saved().volume, expected);
    assert.equal(h.saved().kind, 'focus-done');
  }
});

test('rechecks the wall clock at most every sixty seconds and never rings early', () => {
  const h = harness();
  const input = alarm(h, { at: h.now() + 180_000 });
  h.services.arm(input);
  for (const delta of [60_000, -30_000, 60_000]) {
    assert.ok([...h.timers.values()].every(({ delay }) => delay >= 0 && delay <= 60_000));
    h.setTime(h.now() + delta);
    h.runTimer();
    assert.equal(h.processes.length, 0);
  }
  h.setTime(input.at);
  h.runTimer();
  assert.equal(sounds(h).length, 1);
  assert.equal(h.services.snapshot().pending, null);
  assert.equal(h.timers.size, 0);
});

test('a delayed live alarm rings once on the first wall-clock recheck', () => {
  const h = harness();
  const input = alarm(h);
  h.services.arm(input);
  h.setTime(input.at + 60_001);
  h.runTimer();
  assert.equal(h.services.snapshot().pending, null);
  assert.equal(h.saved(), null);
  assert.equal(sounds(h).length, 1);
  assert.equal(h.notifications.length, 1);
  assert.equal(h.attention.length, 1);
  h.services.check();
  assert.equal(sounds(h).length, 1);
});

test('clears the saved alarm before native effects and fires only once', () => {
  const h = harness();
  fire(h);
  assert.equal(h.saved(), null);
  assert.equal(h.writes.at(-1), null);
  assert.equal(h.services.snapshot().pending, null);
  assert.ok(h.savedAtEffects.every((saved) => saved === null), 'clear saved alarm before sound, notification or attention');
  h.services.check();
  h.services.check();
  assert.equal(sounds(h).length, 1);
  assert.equal(h.notifications.length, 1);
  assert.equal(h.notifications[0].shown, 1);
  assert.deepEqual(h.attention, ['focus-done']);
});

test('native audio uses only fixed executables, bounded volume and bundled alarm paths', () => {
  for (const kind of ['focus-done', 'break-over']) {
    const h = harness();
    fire(h, { kind, volume: 3, speak: false, command: 'untrusted command' });
    assert.equal(sounds(h).length, 1);
    assert.deepEqual(sounds(h)[0].args, ['-v', '1', path.join('/test-assets/alerts', `signature-${kind}.wav`)]);
    assert.equal(sounds(h)[0].options?.shell, undefined);
    assert.equal(h.processes.every((p) => ['/usr/bin/afplay', '/usr/bin/say'].includes(p.file)), true);
  }
});

test('each selected sound and phase uses its fixed bundled file and requires explicit re-arm after restore', () => {
  for (const alertSound of ['signature', 'bell', 'chime', 'digital', 'wood']) {
    for (const kind of ['focus-done', 'break-over']) {
      const h = harness();
      h.services.arm(alarm(h, { alertSound, kind }));
      assert.equal(h.saved().alertSound, alertSound);
      const restored = harness({ saved: h.saved() });
      restored.services.restore();
      assert.equal(restored.services.snapshot().pending, null);
      restored.services.arm(h.saved());
      restored.setTime(h.saved().at);
      restored.services.check();
      assert.deepEqual(sounds(restored)[0].args, ['-v', '0.7', path.join('/test-assets/alerts', `${alertSound}-${kind}.wav`)]);
    }
  }
});

test('none suppresses sound at nonzero volume, keeping speech, notification and attention', () => {
  const h = harness();
  fire(h, { alertSound: 'none', volume: 1 });
  assert.equal(sounds(h).length, 0);
  assert.equal(speech(h).length, 1);
  assert.equal(h.notifications.length, 1);
  assert.equal(h.attention.length, 1);
});

test('speech waits for the chime to finish and uses fixed reminder text', () => {
  for (const [kind, line] of [
    ['focus-done', 'Focus session done. Time for a break.'],
    ['break-over', 'Break is over. Time to focus.'],
  ]) {
    const h = harness();
    fire(h, { kind, spoken: 'Untrusted arbitrary text' });
    assert.equal(speech(h).length, 0);
    sounds(h)[0].done(null);
    assert.deepEqual(speech(h).map((p) => p.args), [[line]]);
  }
});

test('silent alarms can speak immediately and respect speech, notification and attention settings', () => {
  const h = harness();
  fire(h, { volume: 0, notify: false, attention: false });
  assert.equal(sounds(h).length, 0);
  assert.deepEqual(speech(h)[0].args, ['Focus session done. Time for a break.']);
  assert.equal(h.notifications.length, 0);
  assert.equal(h.attention.length, 0);
  const silent = harness();
  fire(silent, { volume: 0, speak: false });
  assert.equal(silent.processes.length, 0);
});

test('auto-run announcements use only phase and duration, after audio', () => {
  for (const [announcement, line] of [
    [{ phase: 'focus', minutes: 25 }, 'Focus started. 25 minutes.'],
    [{ phase: 'break', minutes: 5 }, 'Break started. 5 minutes.'],
    [{ phase: 'cycle' }, 'Cycle complete. Nice work.'],
  ]) {
    const h = harness();
    fire(h, { announcement: { ...announcement, text: 'Untrusted text' } });
    assert.equal(speech(h).length, 0);
    sounds(h)[0].done(null);
    assert.deepEqual(speech(h)[0].args, [line]);
  }
});

test('a shared generic-speech policy refreshes the active chime without losing its reminder or next alarm', () => {
  const h = harness();
  fire(h, { announcement: { phase: 'break', minutes: 5 } });
  const next = alarm(h, { kind: 'break-over', genericSpeech: true });
  h.services.arm(next);
  assert.equal(speech(h).length, 0);
  sounds(h)[0].done(null);
  assert.deepEqual(speech(h)[0].args, ['Focus session done. Time for a break.']);
  assert.equal(h.services.snapshot().pending.at, next.at);
});

test('a shared generic-speech policy replaces an already speaking duration', () => {
  const h = harness();
  fire(h, { volume: 0, announcement: { phase: 'break', minutes: 5 } });
  const active = speech(h)[0];
  h.services.arm(alarm(h, { kind: 'break-over', genericSpeech: true }));
  assert.equal(active.killed, true);
  assert.deepEqual(speech(h).at(-1).args, ['Focus session done. Time for a break.']);
});

test('cancelling speech prevents a delayed chime callback from starting it', () => {
  const h = harness();
  fire(h);
  h.services.cancelSpeech();
  sounds(h)[0].done(null);
  assert.equal(speech(h).length, 0);
  assert.equal(h.notifications.length, 1);
});

test('cancelling current speech preserves the next pending alarm', () => {
  const h = harness();
  fire(h, { volume: 0 });
  const active = speech(h)[0];
  const next = alarm(h, { kind: 'break-over' });
  h.services.arm(next);
  const accepted = structuredClone(h.services.snapshot().pending);
  h.services.cancelSpeech();
  assert.equal(active.killed, true);
  assert.deepEqual(h.services.snapshot().pending, accepted);
  assert.deepEqual(h.saved(), accepted);
});

test('disarm stops active native audio and clears the next persisted alarm', () => {
  const h = harness();
  fire(h);
  const active = sounds(h)[0];
  h.services.arm(alarm(h, { kind: 'break-over' }));
  h.services.disarm();
  assert.equal(active.killed, true);
  active.done(null);
  assert.equal(speech(h).length, 0);
  assert.equal(h.services.snapshot().pending, null);
  assert.equal(h.saved(), null);
  assert.equal(h.timers.size, 0);
});

test('restore drops saved alarms, including valid future alarms, until explicit start', () => {
  const saved = { at: 1_030_000, kind: 'break-over', volume: 0.4, speak: false };
  const h = harness({ saved });
  h.services.restore();
  h.services.restore();
  assert.equal(h.reads(), 0, "restore discards alarms without reading the discarded snapshot");
  assert.equal(h.services.snapshot().pending, null);
  assert.equal(h.timers.size, 0);
  h.setTime(saved.at);
  h.services.check();
  assert.equal(sounds(h).length, 0);
  for (const invalid of [{ ...saved, at: 900_000 }, { ...saved, at: 999_999 }, { ...saved, at: 1_000_000 }, { ...saved, kind: '../../alarm' }, { ...saved, speak: 'yes' }]) {
    const bad = harness({ saved: invalid });
    bad.services.restore();
    assert.equal(bad.services.snapshot().pending, null);
    assert.equal(bad.timers.size, 0);
    assert.equal(bad.processes.length, 0);
  }
});

test('notification delivery is silent, click opens the dashboard, and failures are reported', () => {
  const h = harness();
  assert.deepEqual(h.services.notificationStatus(), { supported: true, failed: false });
  fire(h, { speak: false });
  const notification = h.notifications[0];
  assert.equal(notification.options.silent, true);
  notification.emit('click');
  assert.equal(h.shown(), 1);
  notification.emit('failed', {}, 'Notifications are disabled');
  assert.deepEqual(h.services.notificationStatus(), { supported: true, failed: true });
});

test('unsupported notifications do not block alarms or attention', () => {
  const h = harness({ supported: false });
  assert.deepEqual(h.services.notificationStatus(), { supported: false, failed: false });
  fire(h, { speak: false });
  assert.equal(h.notifications.length, 0);
  assert.equal(sounds(h).length, 1);
  assert.deepEqual(h.attention, ['focus-done']);
});

test('prevent sleep is idempotent, including blocker id zero, and release is safe repeatedly', () => {
  const h = harness();
  h.services.preventSleep(true);
  h.services.preventSleep(true);
  assert.deepEqual(h.powerStarts, ['prevent-display-sleep']);
  assert.equal(h.services.snapshot().powerActive, true);
  h.services.preventSleep(false);
  h.services.releasePower();
  assert.deepEqual(h.powerStops, [0]);
  assert.equal(h.services.snapshot().powerActive, false);
  h.services.preventSleep(true);
  h.services.releasePower();
  assert.deepEqual(h.powerStops, [0, 1]);
});

test('dispose releases timers, native processes and power but preserves the alarm for restart', () => {
  const h = harness();
  fire(h);
  const active = sounds(h)[0];
  const next = alarm(h, { kind: 'break-over' });
  h.services.arm(next);
  const accepted = h.saved();
  h.services.preventSleep(true);
  h.services.dispose();
  h.services.dispose();
  assert.equal(h.timers.size, 0);
  assert.equal(active.killed, true);
  active.done(null);
  assert.equal(speech(h).length, 0);
  assert.equal(h.power.size, 0);
  assert.deepEqual(h.saved(), accepted);
});

test('direct speech accepts only bounded structured announcements and cancellation stops it', () => {
  const h = harness();
  for (const value of [null, 'arbitrary text', {},
    ...[{ phase: 'unknown' }, { phase: 'focus', minutes: NaN }, { phase: 'break', minutes: Infinity }, { phase: 'focus', minutes: -1 }].map((announcement) => ({ kind: 'focus-done', announcement })),
  ]) {
    assert.equal(h.services.speak(value), false);
  }
  assert.equal(h.processes.length, 0);
  assert.equal(h.services.speak({ kind: 'focus-done', announcement: { phase: 'focus', minutes: 25, text: 'Ignore this arbitrary text' } }), true);
  assert.deepEqual(speech(h)[0].args, ['Focus started. 25 minutes.']);
  h.services.cancelSpeech();
  assert.equal(speech(h)[0].killed, true);
});

test('a late callback from replaced audio cannot orphan the current sound', () => {
  const h = harness();
  fire(h);
  const first = sounds(h)[0];
  fire(h, { kind: 'break-over' });
  const second = sounds(h)[1];
  assert.equal(first.killed, true);
  first.done(null);
  assert.equal(speech(h).length, 0);
  h.services.disarm();
  assert.equal(second.killed, true);
  second.done(null);
  assert.equal(speech(h).length, 0);
});

test('a late callback from replaced speech cannot orphan the current announcement', () => {
  const h = harness();
  h.services.speak({ kind: 'focus-done' });
  const first = speech(h)[0];
  h.services.speak({ kind: 'break-over' });
  const second = speech(h)[1];
  assert.equal(first.killed, true);
  first.done(null);
  h.services.cancelSpeech();
  assert.equal(second.killed, true);
});

test('native notification Stop Sound disarms sound and invalidates queued speech', () => {
  const h = harness(); fire(h);
  const active = sounds(h)[0];
  assert.deepEqual(h.notifications[0].options.actions, [{ type: 'button', text: 'Stop Sound' }]);
  h.notifications[0].emit('action', {}, 0);
  assert.equal(active.killed, true);
  active.done(null);
  assert.equal(speech(h).length, 0);
  assert.equal(h.services.snapshot().pending, null);
  assert.equal(h.stopped(), 1);
  assert.notEqual(h.notifications[0].closed, true);
  h.services.disarm(); h.services.disarm();
  h.notifications[0].emit('action', {}, 0);
  assert.equal(h.stopped(), 1, 'an acknowledged notification cannot stop sound again');
});

test('new notifications and acknowledgement retain delivered notifications; stale actions cannot stop the current alarm', () => {
  const h = harness();
  fire(h);
  const first = h.notifications[0];
  fire(h, { kind: 'break-over' });
  const current = h.notifications[1];
  const active = sounds(h).at(-1);
  h.services.arm(alarm(h));
  const pending = h.services.snapshot().pending;
  first.emit('action', {}, 0);
  current.emit('action', {}, 1);
  assert.equal(active.killed, false);
  assert.deepEqual(h.services.snapshot().pending, pending);
  assert.deepEqual(h.saved(), pending);
  assert.equal(h.stopped(), 0);
  assert.ok(h.notifications.every(notification => notification.closed !== true));
  current.emit('action', {}, 0);
  assert.equal(active.killed, true);
  active.done(null);
  assert.equal(speech(h).length, 0);
  assert.equal(h.stopped(), 1);
  assert.equal(h.services.snapshot().pending, null);
  assert.ok(h.notifications.every(notification => notification.closed !== true));
  fire(h);
  const replacement = sounds(h).at(-1);
  first.emit('action', {}, 0); current.emit('action', {}, 0);
  assert.equal(replacement.killed, false);
  assert.equal(h.stopped(), 1);
  h.services.disarm();
  assert.ok(h.notifications.every(notification => notification.closed !== true));
});

test('testReminder delivers a silent notification without actions, attention, sound or alarm changes', () => {
  const h = harness();
  h.services.arm(alarm(h));
  const pending = structuredClone(h.services.snapshot().pending);
  const writes = h.writes.length;
  assert.deepEqual(h.services.testReminder(), { supported: true, failed: false });
  assert.equal(h.notifications.length, 1);
  assert.equal(h.notifications[0].shown, 1);
  assert.equal(h.notifications[0].options.silent, true);
  assert.deepEqual(h.notifications[0].options.actions, []);
  assert.deepEqual(h.attention, []);
  assert.deepEqual(h.processes, []);
  assert.deepEqual(h.services.snapshot().pending, pending);
  assert.deepEqual(h.saved(), pending);
  assert.equal(h.writes.length, writes);
  assert.equal(h.timers.size, 1);
  h.services.testReminder('break-over');
  assert.equal(h.notifications[1].options.title, 'Break over');
  assert.notEqual(h.notifications[0].closed, true);
  h.services.disarm();
  assert.ok(h.notifications.every(notification => notification.closed !== true));
});


test('a test reminder sent while an alarm rings leaves that alarm\'s Stop Sound working', () => {
  const h = harness();
  fire(h);
  const real = h.notifications.at(-1);
  const active = sounds(h).at(-1);
  h.services.testReminder();
  assert.equal(h.notifications.length, 2);
  real.emit('action', {}, 0);
  assert.equal(active.killed, true);
  assert.equal(h.stopped(), 1);
});

test('C7: disarm clears persisted alarms across relaunch/sleep and stops sound, but keeps a delivered notification', () => {
  const h = harness();
  h.services.arm({ at: 1_030_000, kind: 'focus-done', volume: 0.7, speak: true, alertSound: 'signature' });
  h.services.disarm();
  assert.equal(h.saved(), null);
  h.setTime(1_100_000); h.services.check();
  assert.equal(h.processes.length, 0); assert.equal(h.notifications.length, 0); assert.equal(h.attention.length, 0);
  const relaunched = harness({ saved: h.saved() }); relaunched.services.restore();
  relaunched.setTime(1_100_000); relaunched.services.check();
  assert.equal(relaunched.processes.length, 0); assert.equal(relaunched.notifications.length, 0);
  fire(h); h.services.disarm();
  // A delivered notification stays in Notification Center as a record; acknowledging only silences.
  assert.notEqual(h.notifications[0].closed, true);
  sounds(h)[0].done(null); assert.equal(speech(h).length, 0);
});

test('round3 suspend blocks overdue callbacks and resume settles missed alarms without reminders', () => {
  const h = harness();
  const a = alarm(h, { alertSound: 'signature', announcement: { phase: 'break', minutes: 5 } });
  h.services.arm(a);
  const queued = [...h.timers.values()][0].callback;
  h.services.suspend();
  h.setTime(a.at + 3600000);
  queued(); // Even a callback queued before suspend cannot ring before resume.
  h.services.resume();
  h.services.check();
  assert.equal(h.saved(), null);
  assert.equal(h.services.snapshot().pending, null);
  assert.equal(h.timers.size, 0);
  assert.deepEqual(h.processes, []);
  assert.deepEqual(h.notifications, []);
  assert.deepEqual(h.attention, []);
});
test('away wake before the deadline cancels the future native reminder', () => {
  const h = harness();
  const a = alarm(h, { at: h.now() + 60000, alertSound: 'signature' });
  h.services.arm(a); h.services.suspend();
  h.setTime(a.at - 1000); h.services.resume();
  assert.equal(h.services.snapshot().pending, null);
  h.setTime(a.at); h.services.check();
  assert.equal(sounds(h).length, 0);
  assert.equal(h.notifications.length, 0);
});

test('away recovery keeps saved and suspended future alarms silent until an explicit new arm', () => {
  for (const kind of ['startup', 'wake']) {
    const a = { at: 1_030_000, kind: 'break-over', alertSound: 'signature', volume: 0.4, speak: false };
    const h = harness({ saved: a });
    if (kind === 'startup') h.services.restore();
    else { h.services.arm(a); h.services.suspend(); h.setTime(a.at - 1000); h.services.resume(); }
    assert.equal(h.services.snapshot().pending, null);
    h.setTime(a.at + 1); h.services.check();
    assert.equal(sounds(h).length, 0); assert.equal(h.notifications.length, 0);
    const next = alarm(h, { at: h.now() + 1000 }); h.services.arm(next); h.setTime(next.at); h.runTimer();
    assert.equal(sounds(h).length, 1);
  }
});
