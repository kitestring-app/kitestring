const { readFileSync, writeFileSync, renameSync, mkdirSync } = require('node:fs');
const path = require('node:path');

function validDnsUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  if (value === '') return true;
  try {
    const url = new URL(value);
    return value === value.trim() && url.protocol === 'https:' && !!url.hostname && !url.username && !url.password && !url.hash;
  } catch { return false; }
}
const resolverOptions = url => url ? { secureDnsMode: 'secure', secureDnsServers: [url] } : { secureDnsMode: 'off' };

function createDns({ app, userData }) {
  const file = path.join(userData, 'secure-dns.json');
  let url = '';
  let busy = false;
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    if (validDnsUrl(saved.url)) url = saved.url;
  } catch { /* System DNS unless this device explicitly saved a valid endpoint. */ }
  return {
    get: () => url,
    apply: () => app.configureHostResolver(resolverOptions(url)),
    async set(value) {
      if (busy || !validDnsUrl(value)) return false;
      busy = true;
      try {
        await app.configureHostResolver(resolverOptions(value));
        mkdirSync(userData, { recursive: true });
        writeFileSync(file + '.tmp', JSON.stringify({ url: value }), { mode: 0o600 });
        renameSync(file + '.tmp', file);
        url = value;
        return true;
      } catch {
        await app.configureHostResolver(resolverOptions(url));
        return false;
      } finally { busy = false; }
    },
  };
}
function registerDns(ipcMain, trusted, dns) {
  ipcMain.handle('desktop:dns-get', event => trusted(event) ? dns.get() : null);
  ipcMain.handle('desktop:dns-set', (event, value) => trusted(event) ? dns.set(value) : false);
}
module.exports = { createDns, registerDns, validDnsUrl };
