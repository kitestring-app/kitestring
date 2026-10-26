/** Device-local return policy. No calendar dates, statistics, or presentation dependencies. */
export const GAP_MS = 24 * 60 * 60_000;
export interface SessionContext {
  actionId: string;
  actionRevision: number;
  action: string;
  why: string;
  cue?: string;
  taskId?: string;
  taskTitle: string;
  spentMs: number;
}
export interface RecoveryBoundary { id: string; ended: "focus" | "short" | "long"; at: number; missed: boolean }
export interface ReturnActivity {
  version: 1;
  lastPurposefulAt: number | null;
  pendingGap: string | null;
  acknowledgedGap: string | null;
  uncertain: boolean;
}
export const EMPTY_ACTIVITY: ReturnActivity = { version: 1, lastPurposefulAt: null, pendingGap: null, acknowledgedGap: null, uncertain: false };
export interface ClockSample { wall: number; mono: number }
export function clockDiscontinuous(before: ClockSample | null, after: ClockSample, woke = false): boolean {
  if (!Number.isFinite(after.wall) || after.wall < 0 || !Number.isFinite(after.mono)) return true;
  if (!before) return false;
  const wall = after.wall - before.wall, mono = after.mono - before.mono;
  // Some platforms stop performance.now during sleep. Only an explicit native wake may explain it.
  return wall < 0 || mono < 0 || (!woke && Math.abs(wall - mono) > 120_000);
}
export function evaluateGap(state: ReturnActivity, now: number, discontinuous = false): ReturnActivity {
  const last = state.lastPurposefulAt;
  if (discontinuous || !Number.isFinite(now) || now < 0 || (last !== null && (last > now || last < 0 || !Number.isFinite(last)))) {
    return { ...state, uncertain: true, pendingGap: null };
  }
  if (state.uncertain || last === null || now - last <= GAP_MS) return state;
  const token = `gap:${last}`;
  return state.acknowledgedGap === token || state.pendingGap === token ? state : { ...state, pendingGap: token };
}
export type RecoveryOffer = "missed-end" | "re-entry" | "gap-return" | "parking-review" | null;
export function selectRecovery(pending: { boundary: boolean; reentry: boolean; gap: boolean; review: boolean; runningFocus?: boolean }): RecoveryOffer {
  if (pending.boundary) return "missed-end";
  if (pending.reentry) return "re-entry";
  if (pending.runningFocus) return null;
  if (pending.gap) return "gap-return";
  return pending.review ? "parking-review" : null;
}
export function continueDuration(override: number | undefined, taskEta: number | null, configured: number | null): number | null {
  if (override !== undefined) {
    if (!Number.isFinite(override) || override < 1000 || override > GAP_MS) throw new Error("Choose a block between one second and 24 hours.");
    return override;
  }
  return taskEta !== null && taskEta > 0 ? taskEta * 60_000 : configured;
}
export function isSessionContext(value: unknown): value is SessionContext {
  if (!value || typeof value !== "object") return false;
  const c = value as SessionContext;
  return [c.actionId, c.action, c.why, c.taskTitle].every(s => typeof s === "string" && s.length <= 500 && !/[\r\n]/.test(s)) &&
    Number.isSafeInteger(c.actionRevision) && c.actionRevision >= 0 && Number.isFinite(c.spentMs) && c.spentMs >= 0 &&
    (c.taskId === undefined || typeof c.taskId === "string" && c.taskId.length <= 64) &&
    (c.cue === undefined || typeof c.cue === "string" && c.cue.length <= 500 && !/[\r\n]/.test(c.cue));
}
export function isRecoveryBoundary(value: unknown): value is RecoveryBoundary {
  if (!value || typeof value !== "object") return false;
  const b = value as RecoveryBoundary;
  return typeof b.id === "string" && b.id.length > 0 && b.id.length <= 64 && ["focus", "short", "long"].includes(b.ended) &&
    Number.isFinite(b.at) && b.at >= 0 && typeof b.missed === "boolean";
}
