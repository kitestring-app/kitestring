const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAttentionLog } = require('../attention-log.cjs');

function memoryFs(initial) {
  const files = new Map(initial ? [['log', initial]] : []);
  return { files, readFileSync: f => { if (!files.has(f)) throw new Error('ENOENT'); return files.get(f); }, writeFileSync: (f, data) => files.set(f, data) };
}

test('records outcomes as JSON lines and keeps only the newest entries', () => {
  const fs = memoryFs('{"old":1}\n');
  let n = 0;
  const log = createAttentionLog({ file: 'log', fs, limit: 3, clock: () => new Date(Date.UTC(2026, 10, 1, 12, 0, n++)) });
  for (const outcome of ['shown', 'rate-limited', 'released']) log.record({ type: 'attention', kind: 'break-over', outcome });
  const rows = fs.files.get('log').trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(r => r.outcome), ['shown', 'rate-limited', 'released']);
  assert.equal(rows[0].at, '2026-11-01T12:00:00.000Z');
});

test('a write failure never throws into the reminder path', () => {
  const log = createAttentionLog({ file: 'log', fs: { readFileSync: () => { throw new Error('x'); }, writeFileSync: () => { throw new Error('disk full'); } } });
  assert.doesNotThrow(() => log.record({ type: 'attention', kind: 'focus-done', outcome: 'shown' }));
});
