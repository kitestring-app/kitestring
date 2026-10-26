import { canWriteClockStore, createStore, storeReadFailed } from "../lib/store";
import { clockDiscontinuous, EMPTY_ACTIVITY, evaluateGap } from "./recoveryPolicy";
import type { ClockSample, ReturnActivity } from "./recoveryPolicy";

/** Not synced or restored from backups: another device's/old backup's activity is not this device's activity. */
export const returnActivity = createStore<ReturnActivity>("returnActivity", EMPTY_ACTIVITY, value => {
  const s = value as ReturnActivity | null;
  return s?.version === 1 && (s.lastPurposefulAt === null || Number.isFinite(s.lastPurposefulAt)) &&
    [s.pendingGap, s.acknowledgedGap].every(t => t === null || typeof t === "string" && t.length <= 64) && typeof s.uncertain === "boolean" ? s : { ...EMPTY_ACTIVITY, uncertain: true };
});
let ownsActivity = () => canWriteClockStore("returnActivity");
let forwardActivity: (at: number) => void = () => {};
/** The clock owner evaluates gaps; followers send only purposeful timestamps. */
export function registerActivityOwner(owns: () => boolean, forward: (at: number) => void) {
  ownsActivity = owns;
  forwardActivity = forward;
}
let sample: ClockSample | null = null;
// Keep the last trusted sample until a native wake can explain a stopped monotonic clock.
// Backwards clocks, failed reads and uncertainty that predates suspension remain latched.
let suspension: ClockSample | null = null;
export function checkReturnActivity(woke = false, now = Date.now(), mono = performance.now()) {
  if (!ownsActivity()) return;
  const current = { wall: now, mono }, state = returnActivity.get();
  const failed = storeReadFailed("returnActivity");
  const discontinuous = clockDiscontinuous(sample, current, woke);
  const backwards = clockDiscontinuous(sample, current, true);
  if (failed || backwards) suspension = null;
  else if (!woke && discontinuous && !state.uncertain) suspension = sample;
  const reconciled = woke && suspension !== null && !failed && !clockDiscontinuous(suspension, current, true);
  const next = evaluateGap(reconciled ? { ...state, uncertain: false } : state, now, failed || discontinuous);
  if (woke) suspension = null;
  sample = current;
  if (next !== state) returnActivity.set(latest => latest === state ? next : latest);
}
/** Evaluate the previous activity before replacing it. A pending gap keeps its identity until answered. */
export function purposefulAction(at = Date.now()) {
  if (!ownsActivity()) { forwardActivity(at); return; }
  checkReturnActivity();
  suspension = null;
  returnActivity.set(s => ({ ...s, lastPurposefulAt: s.uncertain ? Date.now() : Math.max(s.lastPurposefulAt ?? at, at), uncertain: false }));
}
export function acknowledgeGap(token: string): boolean {
  if (!ownsActivity() || returnActivity.get().pendingGap !== token) return false;
  returnActivity.set(s => ({ ...s, acknowledgedGap: token, pendingGap: null }));
  return true;
}
