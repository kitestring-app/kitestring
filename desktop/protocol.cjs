const { readFile, realpath, stat } = require('node:fs/promises');
const path = require('node:path');
const { isAppURL } = require('./security.cjs');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};
const inside = (root, file) => file === root || file.startsWith(root + path.sep);

async function createAppHandler(webRoot) {
  const root = await realpath(webRoot);
  const sourceHeaders = await readFile(path.join(root, '_headers'), 'utf8');
  const csp = sourceHeaders.match(/^\s*Content-Security-Policy:\s*(.+)$/mi)?.[1];
  if (!csp) throw new Error('Packaged web app is missing its Content-Security-Policy');
  const baseHeaders = { 'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff' };
  for (const name of ['X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy', 'Cross-Origin-Opener-Policy']) {
    const value = sourceHeaders.match(new RegExp(`^\\s*${name}:\\s*(.+)$`, 'mi'))?.[1];
    if (value) baseHeaders[name] = value;
  }
  const respond = (body, status, headers = {}) => new Response(body, { status, headers: { ...baseHeaders, ...headers } });

  return async (request) => {
    if (!isAppURL(request.url)) return respond('Forbidden', 403);
    if (!['GET', 'HEAD'].includes(request.method)) return respond('Method not allowed', 405, { Allow: 'GET, HEAD' });
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url).pathname); } catch { return respond('Bad path', 400); }
    if (pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').includes('..')) return respond('Forbidden', 403);
    let file = path.resolve(root, `.${pathname}`);
    if (!inside(root, file)) return respond('Forbidden', 403);
    try {
      try {
        if (!(await stat(file)).isFile()) file = path.join(root, 'index.html');
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
        if (path.extname(pathname)) return respond('Not found', 404);
        file = path.join(root, 'index.html');
      }
      if (!inside(root, await realpath(file))) return respond('Forbidden', 403);
      const data = await readFile(file);
      const headers = {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': String(data.length), 'Accept-Ranges': 'bytes',
      };
      const range = request.headers.get('Range');
      if (range) {
        const match = range.match(/^bytes=(\d*)-(\d*)$/);
        // Check the original numbers before clamping; otherwise an overflowed
        // suffix/end can silently turn into a successful whole-file response.
        const first = match?.[1] ? Number(match[1]) : null;
        const last = match?.[2] ? Number(match[2]) : null;
        const start = first ?? Math.max(0, data.length - last);
        const end = first !== null && last !== null ? Math.min(last, data.length - 1) : data.length - 1;
        if (!match || (first === null && last === null) ||
            (first !== null && !Number.isSafeInteger(first)) || (last !== null && !Number.isSafeInteger(last)) ||
            (first === null && last === 0) || start > end || start >= data.length) {
          return respond(null, 416, { 'Content-Range': `bytes */${data.length}` });
        }
        headers['Content-Range'] = `bytes ${start}-${end}/${data.length}`;
        headers['Content-Length'] = String(end - start + 1);
        return respond(request.method === 'HEAD' ? null : data.subarray(start, end + 1), 206, headers);
      }
      return respond(request.method === 'HEAD' ? null : data, 200, headers);
    } catch {
      return respond('Unable to read app resource', 500);
    }
  };
}
module.exports = { createAppHandler };
