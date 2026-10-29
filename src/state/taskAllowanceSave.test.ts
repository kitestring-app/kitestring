import 'fake-indexeddb/auto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
vi.hoisted(() => { vi.stubGlobal('navigator', {}); vi.stubGlobal('BroadcastChannel', undefined); });
beforeEach(async () => {
  vi.resetModules(); vi.stubGlobal('BroadcastChannel', undefined);
  const db = await import('../lib/db'); await db.dbSetMany([], await db.dbKeys());
});
afterEach(() => vi.restoreAllMocks());
async function setup() {
  const m = await import('./tasks'), store = await import('../lib/store'), db = await import('../lib/db');
  await m.tasks.ready; await (await import('./settings')).calmFoundationReady;
  m.tasks.set([{ id: 'a', title: 'Draft', done: false, etaMin: 20, createdAt: Date.now() }]);
  await store.flushReadyStores(); return { ...m, db, store, expected: m.tasks.get()[0] };
}
it.each([0, 10, 240, null])('durably saves allowance %j while leaving work and history intact', async value => {
  const m = await setup(); const { stats } = await import('./stats'); await stats.ready;
  const history = stats.get();
  await m.saveTaskAllowance('a', value, m.expected);
  expect(m.tasks.get()[0]).toEqual({ ...m.expected, transitionAllowanceMin: value });
  expect(await m.db.dbGet('tasks')).toEqual(m.tasks.get());
  expect(m.remainingMinutes(m.tasks.get())).toBe(20); expect(stats.get()).toBe(history);
});
it.each([-1, 241, 1.5, NaN])('rejects invalid allowance %j without changing the task', async value => {
  const m = await setup(); await expect(m.saveTaskAllowance('a', value, m.expected)).rejects.toThrow(/whole number/);
  expect(m.tasks.get()[0]).toBe(m.expected);
});
it('rejects a stale task or a task that has become a parent', async () => {
  const m = await setup(); m.updateTask('a', { title: 'Edited elsewhere' });
  await expect(m.saveTaskAllowance('a', 10, m.expected)).rejects.toThrow(/changed/);
  expect(m.tasks.get()[0].title).toBe('Edited elsewhere');
  const parent = m.tasks.get()[0]; m.addSubtask('a');
  await expect(m.saveTaskAllowance('a', 10, parent)).rejects.toThrow(/changed|leaf/);
  expect(m.tasks.get()[0].transitionAllowanceMin).toBeNull();
  await expect(m.saveTaskAllowance('a', 10, m.tasks.get()[0])).rejects.toThrow(/leaf/);
});
it.each(['QuotaExceededError', 'AbortError', 'UnknownError'])('keeps prior live and disk values on %s', async name => {
  const m = await setup(); const before = await m.db.dbGet('tasks');
  vi.spyOn(m.db, 'dbSetMany').mockRejectedValueOnce(new DOMException('Could not write', name));
  await expect(m.saveTaskAllowance('a', 10, m.expected)).rejects.toThrow();
  expect(m.tasks.get()[0]).toBe(m.expected); expect(await m.db.dbGet('tasks')).toEqual(before);
});
it('rejects a write overtaken by a task edit without losing that edit on disk', async () => {
  const m = await setup();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const write = m.db.dbSetMany;
  vi.spyOn(m.db, 'dbSetMany').mockImplementationOnce(async entries => { entered(); await gate; await write(entries); });
  const saving = m.saveTaskAllowance('a', 10, m.expected); await started;
  m.updateTask('a', { title: 'Newer title' }); release();
  await expect(saving).rejects.toThrow(/changed/); await m.store.flushReadyStores();
  expect(m.tasks.get()[0]).toEqual({ ...m.expected, title: 'Newer title' });
  expect(await m.db.dbGet('tasks')).toEqual(m.tasks.get());
});

it('refuses volatile storage without publishing a saved-looking value', async () => {
  const m = await setup(); vi.spyOn(m.db, 'storageMode').mockReturnValue('memory');
  await expect(m.saveTaskAllowance('a', 10, m.expected)).rejects.toThrow(/unavailable/);
  expect(m.tasks.get()[0]).toBe(m.expected);
});
it('cannot recreate a task deleted while its editor was open', async () => {
  const m = await setup(); m.deleteTask('a');
  await expect(m.saveTaskAllowance('a', 10, m.expected)).rejects.toThrow(/changed/);
  await m.store.flushReadyStores(); expect(m.tasks.get()).toEqual([]); expect(await m.db.dbGet('tasks')).toEqual([]);
});
