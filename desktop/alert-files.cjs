// Renderer values are enum keys, never paths. Keep filenames literal and allowlisted.
const ALERT_FILES = Object.freeze({
  signature: Object.freeze({ 'focus-done': 'signature-focus-done.wav', 'break-over': 'signature-break-over.wav' }),
  bell: Object.freeze({ 'focus-done': 'bell-focus-done.wav', 'break-over': 'bell-break-over.wav' }),
  chime: Object.freeze({ 'focus-done': 'chime-focus-done.wav', 'break-over': 'chime-break-over.wav' }),
  digital: Object.freeze({ 'focus-done': 'digital-focus-done.wav', 'break-over': 'digital-break-over.wav' }),
  wood: Object.freeze({ 'focus-done': 'wood-focus-done.wav', 'break-over': 'wood-break-over.wav' }),
  none: Object.freeze({ 'focus-done': null, 'break-over': null }),
});

// Missing choices in alarms saved by older versions retain the signature sound.
function validAlertSound(sound) { return sound === undefined || (typeof sound === 'string' && Object.hasOwn(ALERT_FILES, sound)); }
function alertFile(sound, kind) {
  if (!validAlertSound(sound)) return null;
  const phases = ALERT_FILES[sound === undefined ? 'signature' : sound];
  return Object.hasOwn(phases, kind) ? phases[kind] : null;
}

// Custom reminder text is passed to /usr/bin/say and the notifier as one argument. The renderer
// cleans it (src/audio/alertText.ts); this re-checks it: one trimmed line, no control characters,
// no leading dash (read as an option), at most 140 characters. undefined means the default text.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
function validAlertText(text) {
  return text === undefined || (typeof text === 'string' && text.length > 0 && text.length <= 140 &&
    text === text.trim() && !text.startsWith('-') && !CONTROL.test(text));
}

module.exports = { alertFile, validAlertSound, validAlertText };
