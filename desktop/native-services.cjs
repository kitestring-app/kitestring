const path = require('node:path');
const fs = require('node:fs');
const { alertFile, validAlertSound } = require('./alert-files.cjs');

function readJSON(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
}
const kinds = ['focus-done', 'break-over'];
function announcement(input) {
  if (!input || !kinds.includes(input.kind)) return null;
  const a = input.announcement ?? input;
  if (a.phase === 'cycle') return 'Cycle complete. Nice work.';
  if (a.phase === 'focus' || a.phase === 'break') {
    if (!Number.isFinite(a.minutes) || a.minutes <= 0 || a.minutes > 600) return null;
    return `${a.phase === 'focus' ? 'Focus' : 'Break'} started. ${a.minutes} ${a.minutes === 1 ? 'minute' : 'minutes'}.`;
  }
  if (a.phase !== undefined) return null;
  return input.kind === 'focus-done' ? 'Focus session done. Time for a break.' : 'Break is over. Time to focus.';
}
function createNativeServices({ Notification, powerSaveBlocker, execFile, stateFile, alertsDir, attention, showWindow, onRing = () => {}, onStopSound = () => {},
  now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, writeJSON: write = writeJSON }) {
  let pending = null, timer = null, power = null, sound = null, speech = null, activeAnnouncement = null, version = 0;
  let suspended = false;
  let failed = false;
  let lastFired = null;
  let notification = null;
  function save() { write(stateFile, pending); }
  function cancelSpeech() { version++; speech?.kill(); speech = null; activeAnnouncement = null; }
  function stopSound() { sound?.kill(); sound = null; }
  function notificationStatus() { return { supported: !!Notification?.isSupported(), failed }; }
  const delivered = [];
  function notify(kind, test = false) {
    if (!notificationStatus().supported) return;
    const current = new Notification({ title: kind === 'focus-done' ? 'Focus complete' : 'Break over',
      body: kind === 'focus-done' ? 'Time for a break.' : 'Time to focus.', silent: true,
      actions: test ? [] : [{ type: 'button', text: 'Stop Sound' }] });
    // A test reminder never takes over the live alarm's Stop Sound.
    if (!test) notification = current;
    // Keep delivered notifications referenced so they stay in Notification Center (Electron closes collected ones).
    delivered.push(current); if (delivered.length > 12) delivered.shift();
    current.on('failed', () => { failed = true; });
    current.on('show', () => { failed = false; });
    current.on('click', showWindow);
    // Stop Sound only acts while this notification's own alarm is the live one.
    current.on('action', (_event, index) => { if (index === 0 && notification === current) { disarm(); onStopSound(); } });
    try { current.show(); } catch { failed = true; }
  }
  function speak(input) {
    const line = announcement(input);
    if (!line) return false;
    cancelSpeech();
    activeAnnouncement = input;
    try { const child = execFile('/usr/bin/say', [line], () => { if (speech === child) speech = null; }); speech = child; } catch { return false; }
    return true;
  }
  function ring(a) {
    cancelSpeech(); stopSound();
    onRing(a);
    activeAnnouncement = a;
    const token = version;
    const afterSound = () => { if (token !== version) return; sound = null; if (a.speak) speak(a); };
    if (a.notify !== false) notify(a.kind);
    if (a.attention !== false) attention(a.kind);
    const file = alertFile(a.alertSound, a.kind);
    if (file && a.volume > 0) {
      try { sound = execFile('/usr/bin/afplay', ['-v', String(a.volume), path.join(alertsDir, file)], afterSound); }
      catch { afterSound(); }
    } else afterSound();
  }
  function check() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    if (!pending || suspended) return;
    const left = pending.at - now();
    if (left > 0) { timer = setTimer(check, Math.min(60000, left)); timer.unref?.(); return; }
    const a = pending;
    pending = null; save();
    lastFired = `${a.kind}:${a.at}`;
    // A delayed live callback still rings. suspend/resume settles sleep expiry first.
    ring(a);
  }
  function suspend() {
    suspended = true;
    disarm();
  }
  function resume() {
    // Do this before notifying the renderer: IPC cannot settle synchronously.
    disarm();
    suspended = false;
    check();
  }
  function valid(input) {
    return input && typeof input === 'object' && Number.isFinite(input.at) && input.at >= now() - 60000 && input.at <= now() + 48 * 3600000 &&
      kinds.includes(input.kind) && validAlertSound(input.alertSound) && Number.isFinite(input.volume) && typeof input.speak === 'boolean' &&
      (input.genericSpeech === undefined || typeof input.genericSpeech === 'boolean') &&
      (input.notify === undefined || typeof input.notify === 'boolean') && (input.attention === undefined || typeof input.attention === 'boolean') &&
      (input.announcement === undefined || (input.announcement && ['focus', 'break', 'cycle'].includes(input.announcement.phase) && announcement(input) !== null));
  }
  function arm(input) {
    if (!valid(input)) return false;
    if (pending && pending.at <= now()) check();
    // The shared display policy also applies to the boundary already waiting behind its chime.
    if (input.genericSpeech && activeAnnouncement?.announcement) {
      delete activeAnnouncement.announcement;
      if (speech) speak(activeAnnouncement);
    }
    if (`${input.kind}:${input.at}` === lastFired) return true;
    pending = { at: input.at, kind: input.kind, alertSound: input.alertSound ?? 'signature', volume: Math.min(1, Math.max(0, input.volume)), speak: input.speak,
      notify: input.notify !== false, attention: input.attention !== false,
      ...(input.genericSpeech !== undefined ? { genericSpeech: input.genericSpeech } : {}),
      ...(input.announcement ? { announcement: { phase: input.announcement.phase, ...(input.announcement.minutes !== undefined ? { minutes: input.announcement.minutes } : {}) } } : {}) };
    save(); check(); return true;
  }
  function disarm() {
    if (timer !== null) clearTimer(timer);
    timer = null; pending = null; save(); cancelSpeech(); stopSound();
    // Delivered notifications stay in Notification Center; acknowledging in the app only stops the sound.
    notification = null;
  }
  function releasePower() { if (power !== null) powerSaveBlocker.stop(power); power = null; }
  /** Settings > Alerts test: the real notification and attention path, without sound or a timer. */
  function testReminder(kind = 'focus-done') {
    notify(kind, true);
    return notificationStatus();
  }
  return {
    testReminder,
    arm, disarm, check, suspend, resume, cancelSpeech, speak, notificationStatus,
    restore() { disarm(); },
    preventSleep(enabled) { if (enabled === true && power === null) power = powerSaveBlocker.start('prevent-display-sleep'); else if (enabled === false) releasePower(); },
    releasePower,
    dispose() { if (timer !== null) clearTimer(timer); timer = null; cancelSpeech(); stopSound(); releasePower(); notification?.close(); },
    snapshot: () => ({ pending, powerActive: power !== null }),
  };
}
module.exports = { createNativeServices, readJSON, writeJSON };
