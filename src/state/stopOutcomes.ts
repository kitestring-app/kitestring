import { storageMode } from '../lib/db';
import { canWriteClockStore, commitStoreEntries, createStore, flushReadyStores, registerClockAction, requestClockAction, storeReadFailed } from '../lib/store';
import type { Store } from '../lib/store';
import { elapsed } from './timerEngine';
import type { TimerState } from './timerEngine';

export interface StopLabel { id: string; at: number; action: string; taskId?: string }
export interface StopAttempt extends StopLabel { nextSegId: string }
const validId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64 && !['__proto__', 'constructor', 'prototype'].includes(v);
const validLabel = (v: unknown): v is StopLabel => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const r = v as StopLabel;
  return validId(r.id) && Number.isSafeInteger(r.at) && r.at >= 0 && r.at <= 8_640_000_000_000_000 && typeof r.action === 'string' && r.action.length <= 500 && !/[\r\n]/.test(r.action) && (r.taskId === undefined || validId(r.taskId));
};
export const validStopOutcomes = (v: unknown): v is Record<string, StopLabel> => !!v && typeof v === 'object' && !Array.isArray(v) &&
  Object.entries(v).every(([id, label]) => validLabel(label) && id === label.id);
export const stopOutcomes = createStore<Record<string, StopLabel>>('stopOutcomes', {}, v => validStopOutcomes(v) ? v : {});
export const stopAttempt = createStore<StopAttempt | null>('stopAttempt', null, v => validLabel(v) && validId((v as StopAttempt).nextSegId) ? v as StopAttempt : null);
let clock: Store<TimerState> | undefined;
export function registerStopClock(timer: Store<TimerState>) {
  clock = timer;
  let ready = false;
  const clearStale = () => {
    const pending = stopAttempt.get(), s = timer.get();
    if (ready && pending && canWriteClockStore('stopAttempt') && (s.segId !== pending.nextSegId || s.startedAt !== null || s.elapsedBefore > 0)) stopAttempt.set(null);
  };
  timer.subscribe(clearStale);
  void Promise.all([timer.ready, stopAttempt.ready]).then(() => { ready = true; clearStale(); });
}
/** Called only after a successful Stop, never by expiry, Finish or task completion. */
export function captureStoppedAttempt(before: TimerState, after: TimerState, at: number) {
  const boundary = before.boundary;
  if (boundary ? boundary.ended !== 'focus' : before.segment !== 'focus' || elapsed(before, at) <= 0) return;
  const context = before.context;
  const attempt: StopAttempt = { id: boundary?.id ?? before.segId, nextSegId: after.segId, at,
    action: context?.action || context?.taskTitle || '', ...(context?.taskId ? { taskId: context.taskId } : {}) };
  if (validLabel(attempt) && validId(attempt.nextSegId)) stopAttempt.set(attempt);
}
const eligible = (id: string) => {
  const p = stopAttempt.get(), s = clock?.get();
  return p?.id === id && s?.segId === p.nextSegId && s.startedAt === null && s.elapsedBefore === 0 ? p : null;
};
async function readyToSave() {
  await Promise.all([stopOutcomes.ready, stopAttempt.ready]);
  if (storageMode() !== 'indexeddb' || ['stopOutcomes', 'stopAttempt'].some(storeReadFailed)) throw new Error('Labels need available local storage. Try again.');
  // Raw time and the authorized stop must be durable before adding a label.
  await flushReadyStores();
}
registerClockAction('stop-label', async id => {
  if (!validId(id)) return { ok: false };
  await readyToSave();
  if (Object.hasOwn(stopOutcomes.get(), id)) return { ok: true };
  if (!eligible(id)) return { ok: false };
  return { ok: await commitStoreEntries(() => {
    const p = eligible(id);
    if (!p) throw new Error('This stop has changed.');
    const { nextSegId: _next, ...label } = p;
    return [['stopAttempt', p], ['stopOutcomes', { ...stopOutcomes.get(), [id]: label }]];
  }) };
});
registerClockAction('remove-stop-label', async expected => {
  if (!validLabel(expected)) return { ok: false };
  await readyToSave();
  const current = stopOutcomes.get()[expected.id];
  if (!current) return { ok: true };
  const matches = (r: StopLabel | undefined) => r?.at === expected.at && r.action === expected.action && r.taskId === expected.taskId;
  if (!matches(current)) return { ok: false };
  return { ok: await commitStoreEntries(() => {
    if (!Object.hasOwn(stopOutcomes.get(), expected.id)) return [];
    if (!matches(stopOutcomes.get()[expected.id])) throw new Error('This label has changed.');
    const next = { ...stopOutcomes.get() }; delete next[expected.id];
    return [['stopOutcomes', next]];
  }) };
});
export const recordStopLabel = (id: string) => requestClockAction('stop-label', id);
/** Undo and later deletion remove only the annotation, never its raw time. */
export const removeStopLabel = (label: StopLabel) => requestClockAction('remove-stop-label', label);
