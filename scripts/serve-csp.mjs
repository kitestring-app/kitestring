// Preview the built SPA with the deployment's headers: node scripts/serve-csp.mjs [port].
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = await realpath(resolve(project, 'dist'));
const config = JSON.parse(await readFile(resolve(project, 'vercel.json'), 'utf8'));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.webp': 'image/webp', '.json': 'application/json' };

const server = createServer(async (request, response) => {
  for (const header of config.headers[0].headers) response.setHeader(header.key, header.value);
  response.setHeader('Cache-Control', 'no-cache');
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let path = resolve(root, `.${pathname}`), body;
    if (!path.startsWith(root + sep) && path !== root) { response.writeHead(403).end(); return; }
    try {
      path = await realpath(path);
      if (!path.startsWith(root + sep) && path !== root) { response.writeHead(403).end(); return; }
      body = await readFile(path);
    } catch { path = resolve(root, 'index.html'); body = await readFile(path); }
    const served = '/' + path.slice(root.length + 1).split(sep).join('/');
    for (const rule of config.headers.slice(1)) {
      const pattern = rule.source.split('(.*)').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
      if (new RegExp(`^${pattern}$`).test(served)) {
        for (const header of rule.headers) response.setHeader(header.key, header.value);
      }
    }
    response.setHeader('Content-Type', types[extname(path)] ?? 'application/octet-stream');
    response.writeHead(200);
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch { response.writeHead(400).end(); }
});
server.listen(Number(process.argv[2] ?? 4748), '127.0.0.1', () => console.log(`CSP preview: http://127.0.0.1:${server.address().port}`));
