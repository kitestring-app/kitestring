const LOGIN_ITEMS_URL = 'x-apple.systempreferences:com.apple.LoginItems-Settings.extension';
const APP_ORIGIN = 'app://custom-pomodoro';
function isAppURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'app:' && url.host === 'custom-pomodoro' && !url.username && !url.password;
  } catch { return false; }
}
function isExternalURL(value) {
  if (value === LOGIN_ITEMS_URL) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
}
function mayGrant(permission, origin) {
  return ['notifications', 'media'].includes(permission) && isAppURL(origin);
}
function statusText(value) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, 64) : null;
}
module.exports = { APP_ORIGIN, LOGIN_ITEMS_URL, isAppURL, isExternalURL, mayGrant, statusText };
