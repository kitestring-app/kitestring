const fs = require('node:fs/promises');
const path = require('node:path');
const PAIRS = new Set(['GET /api/me', 'GET /api/sync', 'PUT /api/sync', 'POST /api/auth/logout']);
// Must match the Worker: one entry per synced key (src/lib/sync.ts SYNC_KEYS) and MAX_SYNC_BYTES in worker/index.ts.
const MAX_ENTRIES = 9;
const MAX_BYTES = 2 * 1024 * 1024;
function validRequest(method, route, body) {
  if (!PAIRS.has(`${method} ${route}`)) return false;
  if (method !== 'PUT') return body === undefined;
  try { return body && Array.isArray(body.entries) && body.entries.length <= MAX_ENTRIES && Buffer.byteLength(JSON.stringify(body)) <= MAX_BYTES; } catch { return false; }
}
function createCloud({ origin, fallbackOrigin, userData, safeStorage, fetch: send = globalThis.fetch, now = Date.now }) {
  const file = path.join(userData, 'cloud-session.enc');
  let token;
  let attempts = [];
  let busy = false;
  const available = () => safeStorage?.isEncryptionAvailable?.() && safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
  async function load() {
    if (token) return token;
    if (!available()) return undefined;
    try {
      const saved = safeStorage.decryptString(await fs.readFile(file));
      if (/^[a-f0-9]{64}$/.test(saved)) token = saved;
    } catch { /* Missing file or unavailable Keychain means signed out. */ }
    return token;
  }
  async function clear() { token = undefined; await fs.rm(file, { force: true }); }
  async function call(method, route, body, secret) {
    for (const endpoint of [...new Set([origin, fallbackOrigin].filter(Boolean))]) {
      try {
        const response = await send(endpoint + route, {
          method, redirect: 'error', signal: AbortSignal.timeout(20_000),
          headers: { 'Content-Type': 'application/json', 'X-Custom-Pomodoro': '1', 'X-Client': 'desktop', ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        // An unavailable new Worker can use the existing sync service. Auth
        // refusals and rate limits remain authoritative and never trigger retry.
        if (endpoint !== fallbackOrigin && fallbackOrigin && (response.status === 404 || response.status >= 500)) continue;
        const data = await response.json().catch(error => {
          if ([401, 403, 429].includes(response.status)) return { ok: false };
          throw error;
        });
        return { status: response.status, data, retryAfter: response.headers.get('Retry-After') };
      } catch { /* Try the fixed legacy origin on transport/invalid-response failure. */ }
    }
    return { status: 503, data: { ok: false, error: 'Could not reach cloud sync. Try again.' } };
  }
  function publicReply(reply) {
    const { data, status, retryAfter } = reply;
    return { status, retryAfter, data: { ok: data.ok === true, ...(typeof data.email === 'string' ? { email: data.email } : {}), ...(Array.isArray(data.entries) ? { entries: data.entries } : {}), ...(typeof data.error === 'string' ? { error: data.error } : {}) } };
  }
  return {
    async signIn(email, password) {
      if (typeof email !== 'string' || email.length > 254 || typeof password !== 'string' || password.length > 1024) return publicReply({ status: 400, data: { error: 'Enter your email and password.' } });
      attempts = attempts.filter(t => t > now() - 900_000);
      if (busy || attempts.length >= 5) return publicReply({ status: 429, retryAfter: '900', data: { error: 'Too many sign-in attempts. Try again later.' } });
      if (!available()) return publicReply({ status: 503, data: { error: 'Unlock your Mac Keychain to sign in.' } });
      busy = true;
      attempts.push(now());
      try {
        const reply = await call('POST', '/api/auth/login', { email, password });
        if (reply.status === 200 && /^[a-f0-9]{64}$/.test(reply.data.token)) {
          try {
            const encrypted = safeStorage.encryptString(reply.data.token);
            await fs.mkdir(userData, { recursive: true });
            await fs.writeFile(file + '.tmp', encrypted, { mode: 0o600 });
            await fs.rename(file + '.tmp', file);
            token = reply.data.token;
            attempts = [];
          } catch {
            await call('POST', '/api/auth/logout', undefined, reply.data.token);
            return publicReply({ status: 503, data: { error: 'Could not save the sign-in in your Mac Keychain.' } });
          }
        }
        return publicReply(reply);
      } finally { busy = false; }
    },
    async request(method, route, body) {
      if (!validRequest(method, route, body)) return publicReply({ status: 400, data: { error: 'Unsupported cloud request.' } });
      const secret = await load();
      if (!secret) return publicReply({ status: 401, data: { ok: false } });
      const reply = await call(method, route, body, secret);
      if (reply.status === 401 || (route === '/api/auth/logout' && reply.status === 200)) await clear();
      return publicReply(reply);
    },
    async status() { return this.request('GET', '/api/me'); },
    async signOut() {
      const secret = await load();
      if (!secret) { await clear(); return publicReply({ status: 200, data: { ok: true } }); }
      const reply = await call('POST', '/api/auth/logout', undefined, secret);
      // Keep the encrypted credential on transient failure so revocation can be retried.
      if (reply.status === 200 || reply.status === 401) await clear();
      return publicReply(reply);
    },
  };
}
function registerCloud(ipcMain, trusted, cloud, openReset) {
  for (const action of ['signIn', 'signOut', 'status', 'request']) {
    ipcMain.handle('desktop:cloud-' + action, (event, ...args) => trusted(event) ? cloud[action](...args) : { status: 403, data: { ok: false } });
  }
  ipcMain.handle('desktop:cloud-reset', event => trusted(event) ? openReset() : false);
}
module.exports = { MAX_ENTRIES, MAX_BYTES, createCloud, validRequest, registerCloud };
