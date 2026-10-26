import { hashPassword } from '../worker/password.mjs';
import { pathToFileURL } from 'node:url';

export async function passwordSQL(email, password) {
  email = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Provide a valid email');
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw new Error('Use 12 to 1024 characters');
  const row = await hashPassword(password);
  const quote = s => "'" + s.replaceAll("'", "''") + "'";
  return `INSERT OR REPLACE INTO users (email, pw_hash, salt, iterations, updated_at) VALUES (${quote(email)}, ${quote(row.pw_hash)}, ${quote(row.salt)}, ${row.iterations}, ${Date.now()});`;
}
async function readSecret() {
  if (!process.stdin.isTTY) {
    if (process.env.CP_PASSWORD !== undefined) return process.env.CP_PASSWORD;
    let input = '';
    for await (const chunk of process.stdin) { input += chunk; if (input.length > 2048) throw new Error('Input too long'); }
    return input.replace(/\r?\n$/, '');
  }
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  try {
    return await new Promise((resolve, reject) => {
      let secret = '';
      const onData = chunk => {
        for (const c of chunk) {
          if (c === '\u0003') { done(); reject(new Error('Cancelled')); return; }
          if (c === '\r' || c === '\n') { done(); resolve(secret); return; }
          if (c === '\u007f' || c === '\b') secret = secret.slice(0, -1);
          else if (c >= ' ') secret += c;
          if (secret.length > 1024) { done(); reject(new Error('Input too long')); return; }
        }
      };
      const done = () => process.stdin.off('data', onData);
      process.stdin.on('data', onData);
    });
  } finally { process.stdin.setRawMode(false); process.stdin.pause(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.stdout.write(await passwordSQL(process.argv[2] ?? '', await readSecret()) + '\n'); }
  catch { process.stderr.write('Could not create password SQL. Supply an email and a password of 12–1024 characters through stdin.\n'); process.exitCode = 1; }
}
