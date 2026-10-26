const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isAppURL, isExternalURL, LOGIN_ITEMS_URL, mayGrant, statusText } = require('../security.cjs');

test('trusts only the exact local application origin', () => {
  assert.equal(isAppURL('app://custom-pomodoro/path?q=1'), true);
  for (const url of ['app://custom-pomodoro.evil/', 'app://custom-pomodoro:123/', 'app://user@custom-pomodoro/', 'https://custom-pomodoro/', 'file:///index.html', 'null', undefined]) assert.equal(isAppURL(url), false);
});
test('grants only media and notifications to our own origin', () => {
  for (const permission of ['media', 'notifications']) {
    assert.equal(mayGrant(permission, 'app://custom-pomodoro/'), true);
    assert.equal(mayGrant(permission, 'https://www.youtube.com/'), false);
  }
  for (const permission of ['geolocation', 'fullscreen', 'openExternal', 'display-capture', 'camera', 'unknown']) assert.equal(mayGrant(permission, 'app://custom-pomodoro/'), false);
});
test('external links must be valid HTTPS without embedded credentials', () => {
  assert.equal(isExternalURL('https://example.org/path'), true);
  for (const url of ['http://example.org', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'https://' + 'user:pass@example.org', 'app://custom-pomodoro/', 'app://custom-pomodoro.evil/', 'garbage']) assert.equal(isExternalURL(url), false);
});
test('tray status rejects nonstrings, caps length and strips control characters', () => {
  assert.equal(statusText('☕ 05:00 · Break\n\u202e'), '☕ 05:00 · Break');
  assert.equal(statusText('🎯 25:00 · Focus\u0000'), '🎯 25:00 · Focus');
  assert.equal(statusText(42), null);
  assert.equal(statusText({ text: 'hello' }), null);
  assert.equal(statusText('x'.repeat(100)).length, 64);
  assert.equal(statusText('25:00 · Focus\n\u0000\u202e'), '25:00 · Focus');
});

test('the exact Login Items pane is the only allowed non-HTTPS external URL', () => {
  assert.equal(isExternalURL(LOGIN_ITEMS_URL), true);
  for (const url of [
    LOGIN_ITEMS_URL + '?anything', LOGIN_ITEMS_URL + '#anything', LOGIN_ITEMS_URL + '/',
    'x-apple.systempreferences:com.apple.preference.security',
    'x-apple.systempreferences://com.apple.LoginItems-Settings.extension',
    'X-APPLE.SYSTEMPREFERENCES:com.apple.LoginItems-Settings.extension',
    'mailto:someone@example.org',
  ]) assert.equal(isExternalURL(url), false, url);
});
