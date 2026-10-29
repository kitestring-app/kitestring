import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
vi.mock('../audio/core', () => ({ cancelAllChimes: vi.fn(), playTimerTick: vi.fn(), cancelChime: vi.fn(), cancelEnd: vi.fn(), releaseChime: vi.fn(), scheduleChime: vi.fn(), scheduleEnd: vi.fn() }));
vi.mock('../audio/companion', () => ({ armCompanionWithSpeech: vi.fn().mockResolvedValue(false), companionAvailable: vi.fn().mockResolvedValue(false), companionKnownUp: vi.fn(() => false), disarmCompanion: vi.fn() }));
async function setup() {
  const [t, o, s, d, f, tasks, pin, stats, e] = await Promise.all([import('./timer'), import('./stopOutcomes'), import('./settings'), import('../lib/db'), import('../lib/store'), import('./tasks'), import('./intent'), import('./stats'), import('./timerEngine')]);
  await t.timerHydrationReady;
  s.settingsUpdate('timer', { ...s.CALM_PATCH, startChime: false, hardMode: false });
  tasks.tasks.set([{ id: 'task', title: 'Original task', done: false, createdAt: Date.now() }]); tasks.focusPick.set('task');
  pin.updateIntent({ action: 'Draft the opening' });
  return { ...t, ...o, ...s, ...d, ...f, ...tasks, ...pin, ...stats, ...e };
}
let m: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  vi.resetModules(); vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('BroadcastChannel', undefined); vi.stubGlobal('navigator', {});
  vi.stubGlobal('window', { addEventListener: vi.fn(), desktop: { release: vi.fn(), disarmAlarm: vi.fn(), cancelSpeech: vi.fn() } });
  vi.stubGlobal('document', { addEventListener: vi.fn(), visibilityState: 'visible' });
  m = await setup(); vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }); vi.setSystemTime(1_800_000_000_000);
  const mono = performance.now(), wall = Date.now(); vi.spyOn(performance, 'now').mockImplementation(() => mono + Date.now() - wall);
});
afterEach(async () => { vi.restoreAllMocks(); await m.flushReadyStores(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const stop = () => { m.timerActions.start(); vi.setSystemTime(Date.now() + 5000); const id = m.timer.get().segId; m.timerActions.stop(); return id; };
it('captures only an authorized Stop; repeated label and Undo never change time, task or pin', async () => {
  const id = stop(), before = structuredClone({ stats: m.stats.get(), tasks: m.tasks.get(), pin: m.intent.get() });
  expect(m.stopAttempt.get()).toMatchObject({ id, action: 'Draft the opening', taskId: 'task' });
  expect(before.stats.chunks.reduce((n, c) => n + c.ms, 0)).toBe(5000);
  const pending = m.stopAttempt.get(); m.timerActions.stop(); expect(m.stopAttempt.get()).toEqual(pending);
  m.updateIntent({ action: 'A later pin' });
  expect(await m.recordStopLabel(id)).toEqual({ ok: true }); expect(await m.recordStopLabel(id)).toEqual({ ok: true });
  expect(Object.keys(m.stopOutcomes.get())).toEqual([id]); expect(m.stopOutcomes.get()[id].action).toBe('Draft the opening');
  expect(await m.dbGet('stopOutcomes')).toEqual(m.stopOutcomes.get());
  const record = m.stopOutcomes.get()[id]; expect(await m.removeStopLabel(record)).toEqual({ ok: true });
  expect(await m.removeStopLabel(record)).toEqual({ ok: true }); expect(m.stopOutcomes.get()).toEqual({});
  expect(m.stats.get()).toEqual(before.stats); expect(m.tasks.get()).toEqual(before.tasks); expect(m.intent.get().action).toBe('A later pin');
});
it('rejects a stale attempt after a new Start and never invents one on reset, expiry or task completion', async () => {
  const id = stop(); m.timerActions.start(); expect(m.stopAttempt.get()).toBeNull();
  expect(await m.recordStopLabel(id)).toEqual({ ok: false }); m.timerActions.reset(); expect(m.stopAttempt.get()).toBeNull();
  m.timerActions.start(); vi.setSystemTime(Date.now() + m.totalMs()!); m.timerActions.complete(m.timer.get().segId);
  expect(m.stopAttempt.get()).toBeNull(); m.toggleTask('task'); expect(m.stopOutcomes.get()).toEqual({});
});
it('refused Hard Stop creates nothing; the existing held end path may offer a label', () => {
  m.settingsUpdate('timer', { hardMode: true }); m.timerActions.start(); vi.setSystemTime(Date.now() + 5000);
  const before = m.timer.get(); expect(m.timerActions.stop()).toMatchObject({ ok: false }); expect(m.stopAttempt.get()).toBeNull();
  expect(m.timer.get()).toBe(before); expect(m.timerActions.endHardSession('Need to leave')).toMatchObject({ ok: false });
  m.timerActions.beginEndHold(); vi.setSystemTime(Date.now() + 10000);
  expect(m.timerActions.endHardSession('Need to leave')).toEqual({ ok: true }); expect(m.stopAttempt.get()?.id).toBe(before.segId);
});
it.each(['QuotaExceededError', 'AbortError', 'UnknownError'])('failed %s save retains pending and prior bytes for retry', async name => {
  const id = stop(); await m.flushReadyStores(); const old = await m.dbGet('stopOutcomes');
  const db = await import('../lib/db'); vi.spyOn(db, 'dbSetMany').mockRejectedValueOnce(new DOMException('Rejected', name));
  await expect(m.recordStopLabel(id)).rejects.toThrow(); expect(m.stopOutcomes.get()).toEqual({}); expect(await m.dbGet('stopOutcomes')).toEqual(old);
  expect(m.stopAttempt.get()?.id).toBe(id); expect(await m.recordStopLabel(id)).toEqual({ ok: true });
});
it('rejects an in-flight label overtaken by Start without overwriting its pending state', async () => {
  const id = stop(); await m.flushReadyStores(); const db = await import('../lib/db'), write = db.dbSetMany;
  let unblock!: () => void; const gate = new Promise<void>(resolve => { unblock = resolve; });
  const spy = vi.spyOn(db, 'dbSetMany').mockImplementationOnce(async entries => { await gate; await write(entries); });
  const saving = m.recordStopLabel(id); await vi.waitFor(() => expect(spy).toHaveBeenCalled());
  m.timerActions.start(); unblock(); expect(await saving).toEqual({ ok: false }); expect(m.stopOutcomes.get()).toEqual({}); expect(m.stopAttempt.get()).toBeNull();
});
it('failed removal retains the label; stale replacement cannot delete an imported record', async () => {
  const id = stop(); await m.recordStopLabel(id); const record = m.stopOutcomes.get()[id], db = await import('../lib/db');
  vi.spyOn(db, 'dbSetMany').mockRejectedValueOnce(new DOMException('Rejected', 'AbortError'));
  await expect(m.removeStopLabel(record)).rejects.toThrow(); expect(m.stopOutcomes.get()[id]).toEqual(record);
  m.stopOutcomes.set({ [id]: { ...record, at: record.at + 1 } });
  expect(await m.removeStopLabel(record)).toEqual({ ok: false }); expect(m.stopOutcomes.get()[id].at).toBe(record.at + 1);
});
it('rejects unavailable durable storage and malformed dictionaries', async () => {
  const id = stop(); const db = await import('../lib/db'); vi.spyOn(db, 'storageMode').mockReturnValue('memory');
  await expect(m.recordStopLabel(id)).rejects.toThrow(); expect(m.stopOutcomes.get()).toEqual({});
  for (const bad of [null, [], { wrong: { id: 'different', at: 1, action: '' } }, JSON.parse('{"__proto__":{"id":"__proto__","at":1,"action":""}}')]) expect(m.validStopOutcomes(bad)).toBe(false);
});
it('reload retains the same offer and label; all Stop accounting partners share one transaction', async () => {
  const db = await import('../lib/db'), write = vi.spyOn(db, 'dbSetMany'); const id = stop(); await m.flushReadyStores();
  expect(write.mock.calls.some(([entries]) => ['timer', 'stats', 'stopAttempt'].every(key => entries.some(([k]) => k === key)))).toBe(true);
  await m.recordStopLabel(id); const expected = m.stopOutcomes.get();
  vi.resetModules(); m = await setup(); expect(m.stopAttempt.get()?.id).toBe(id); expect(m.stopOutcomes.get()).toEqual(expected);
  expect(await m.recordStopLabel(id)).toEqual({ ok: true }); expect(m.stats.get().chunks.reduce((n, c) => n + c.ms, 0)).toBe(5000);
});
it.each([1000, 10000])('validates and reloads %s indexed labels without per-tick history scans', async count => {
  const labels = Object.fromEntries(Array.from({ length: count }, (_, i) => [`attempt-${i}`, { id: `attempt-${i}`, at: i, action: 'Earlier action', taskId: 'task' }]));
  expect(m.validStopOutcomes(labels)).toBe(true); m.stopOutcomes.set(labels); await m.flushReadyStores();
  const before = m.stopOutcomes.get(); m.timerActions.start(); vi.setSystemTime(Date.now() + 5000); m.timerActions.pause();
  expect(m.stopOutcomes.get()).toBe(before); expect(await m.dbGet('stopOutcomes')).toEqual(labels);
});
it('overlapping removal retries both succeed without changing raw credit', async () => {
  const id = stop(); await m.recordStopLabel(id); const before = m.stats.get();
  const record = m.stopOutcomes.get()[id]; expect(await Promise.all([m.removeStopLabel(record), m.removeStopLabel(record)])).toEqual([{ ok: true }, { ok: true }]);
  expect(m.stopOutcomes.get()).toEqual({}); expect(m.stats.get()).toBe(before);
});
it('rejects timestamps outside the JavaScript date range before a record can reach a renderer', () => {
  expect(m.validStopOutcomes({ later: { id: 'later', action: '', at: Number.MAX_SAFE_INTEGER } })).toBe(false);
});
