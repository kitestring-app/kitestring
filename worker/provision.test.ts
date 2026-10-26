import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { verifyPassword, ITERATIONS } from './password.mjs';

it('provisions exactly one SQL statement from env or stdin, with no password in its output', async () => {
  for (const fromEnv of [true, false]) {
    const password = crypto.randomUUID();
    const env = { ...process.env };
    delete env.CP_PASSWORD;
    if (fromEnv) env.CP_PASSWORD = password;
    const result = spawnSync(process.execPath, ['scripts/set-password.mjs', "test'quoted@example.invalid"], { env, input: fromEnv ? '' : password + '\n', encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
    expect(result.stdout).not.toContain(password);
    const db = new DatabaseSync(':memory:');
    db.exec(readFileSync('deploy/migrations/0001_accounts.sql', 'utf8'));
    db.exec(result.stdout);
    const row = db.prepare('SELECT * FROM users').get() as { email: string; pw_hash: string; salt: string; iterations: number };
    expect(row.email).toBe("test'quoted@example.invalid");
    expect(row.iterations).toBe(ITERATIONS);
    expect(await verifyPassword(password, row)).toBe(true);
    db.close();
  }
});
it('rejects short input without emitting SQL or echoing the input', () => {
  const result = spawnSync(process.execPath, ['scripts/set-password.mjs', 'test@example.invalid'], { env: { ...process.env, CP_PASSWORD: 'tiny' }, input: '', encoding: 'utf8' });
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).not.toContain('tiny');
});
