// Opt-in browser checks use only disposable Chrome profiles and a private temp root.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const chrome = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(path => path && existsSync(path));
if (!chrome) throw new Error('Chrome not found. Set CHROME_BIN to a Chrome/Chromium executable.');
const flags = ['AMBIENT', 'CALM', 'CATALOG', 'HARD_MODE', 'LOG', 'NOTEPAD', 'PARKING', 'RETURN', 'START_CUES', 'TOOLTIP', 'FIT', 'BACKUP', 'TYPING_GUARD', 'PHONE'];
const temp = await mkdtemp(join(tmpdir(), 'pomodoro-browser-'));
try {
  const child = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--no-file-parallelism', ...process.argv.slice(2), '.browser.test.ts'], {
    stdio: 'inherit',
    env: { ...process.env, CHROME_BIN: chrome, TMPDIR: temp, TMP: temp, TEMP: temp, ...Object.fromEntries(flags.map(flag => [`${flag}_BROWSER`, '1'])) },
  });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
} finally {
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
